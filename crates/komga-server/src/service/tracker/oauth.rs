//! Per-user OAuth for native trackers, persisted in `kmrs.sqlite`.

use super::{Provider, TrackerError};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use komga_core::time_codec;
use komga_db::dao::tracker_oauth::{TrackerOAuthDao, TrackerOAuthToken};
use komga_db::pool::Database;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Arc;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

pub const OAUTH_RELAY_ROOT: &str = "https://kmworks.date/oauth";
pub const NATIVE_OAUTH_CALLBACK_ROOT: &str = "/api/v1/trackers/oauth";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OAuthStatus {
    pub logged_in: bool,
    pub username: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PkceMethod {
    None,
    Plain,
    S256,
}

#[derive(Debug, Clone)]
pub(crate) struct OAuthApp {
    pub(crate) provider: Provider,
    pub(crate) client_id: Option<String>,
    pub(crate) client_secret: Option<String>,
    pub(crate) authorize_url: String,
    pub(crate) token_url: String,
    pub(crate) userinfo_url: String,
    pub(crate) pkce: PkceMethod,
    pub(crate) scope: Option<&'static str>,
    pub(crate) refresh_with_redirect: bool,
    pub(crate) client_id_env: &'static str,
    pub(crate) client_secret_env: &'static str,
}

fn env_value(value: Option<&'static str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

impl OAuthApp {
    pub(crate) fn for_provider(provider: Provider) -> Self {
        match provider {
            Provider::Anilist => Self {
                provider,
                client_id: env_value(option_env!("KMRS_OAUTH_ANILIST_CLIENT_ID")),
                client_secret: env_value(option_env!("KMRS_OAUTH_ANILIST_CLIENT_SECRET")),
                authorize_url: "https://anilist.co/api/v2/oauth/authorize".into(),
                token_url: "https://anilist.co/api/v2/oauth/token".into(),
                userinfo_url: "https://graphql.anilist.co/".into(),
                pkce: PkceMethod::S256,
                scope: None,
                refresh_with_redirect: false,
                client_id_env: "KMRS_OAUTH_ANILIST_CLIENT_ID",
                client_secret_env: "KMRS_OAUTH_ANILIST_CLIENT_SECRET",
            },
            Provider::Mal => Self {
                provider,
                client_id: env_value(option_env!("KMRS_OAUTH_MAL_CLIENT_ID")),
                client_secret: env_value(option_env!("KMRS_OAUTH_MAL_CLIENT_SECRET")),
                authorize_url: "https://myanimelist.net/v1/oauth2/authorize".into(),
                token_url: "https://myanimelist.net/v1/oauth2/token".into(),
                userinfo_url: "https://api.myanimelist.net/v2/users/@me".into(),
                pkce: PkceMethod::Plain,
                scope: None,
                refresh_with_redirect: false,
                client_id_env: "KMRS_OAUTH_MAL_CLIENT_ID",
                client_secret_env: "KMRS_OAUTH_MAL_CLIENT_SECRET",
            },
            Provider::Bangumi => Self {
                provider,
                client_id: env_value(option_env!("KMRS_OAUTH_BANGUMI_CLIENT_ID")),
                client_secret: env_value(option_env!("KMRS_OAUTH_BANGUMI_CLIENT_SECRET")),
                authorize_url: "https://bgm.tv/oauth/authorize".into(),
                token_url: "https://bgm.tv/oauth/access_token".into(),
                userinfo_url: "https://next.bgm.tv/p1/me".into(),
                pkce: PkceMethod::None,
                scope: None,
                refresh_with_redirect: true,
                client_id_env: "KMRS_OAUTH_BANGUMI_CLIENT_ID",
                client_secret_env: "KMRS_OAUTH_BANGUMI_CLIENT_SECRET",
            },
            Provider::Mangabaka => Self {
                provider,
                client_id: env_value(option_env!("KMRS_OAUTH_MANGABAKA_CLIENT_ID")),
                client_secret: env_value(option_env!("KMRS_OAUTH_MANGABAKA_CLIENT_SECRET")),
                authorize_url: "https://mangabaka.org/auth/oauth2/authorize".into(),
                token_url: "https://mangabaka.org/auth/oauth2/token".into(),
                userinfo_url: "https://api.mangabaka.org/v1/my/profile".into(),
                pkce: PkceMethod::S256,
                scope: Some("library.read library.write profile offline_access openid"),
                refresh_with_redirect: true,
                client_id_env: "KMRS_OAUTH_MANGABAKA_CLIENT_ID",
                client_secret_env: "KMRS_OAUTH_MANGABAKA_CLIENT_SECRET",
            },
        }
    }

    fn credentials(&self) -> Result<(&str, &str), TrackerError> {
        let client_id = self
            .client_id
            .as_deref()
            .ok_or(TrackerError::MissingClientId {
                provider: self.provider,
                variable: self.client_id_env,
            })?;
        let client_secret =
            self.client_secret
                .as_deref()
                .ok_or(TrackerError::MissingClientSecret {
                    provider: self.provider,
                    variable: self.client_secret_env,
                })?;
        Ok((client_id, client_secret))
    }
}

pub fn relay_callback_url(provider: Provider) -> String {
    format!("{OAUTH_RELAY_ROOT}/{}/callback/", provider.as_str())
}

pub fn native_callback_url(instance_origin: &str, provider: Provider) -> String {
    format!(
        "{}{NATIVE_OAUTH_CALLBACK_ROOT}/{}/callback",
        instance_origin.trim_end_matches('/'),
        provider.as_str()
    )
}

pub struct OAuthManager {
    http: reqwest::Client,
    dao: TrackerOAuthDao,
    apps: HashMap<Provider, OAuthApp>,
    refresh_lock: tokio::sync::Mutex<()>,
}

#[derive(Serialize)]
struct AuthorizeState<'a> {
    #[serde(rename = "redirectUrl")]
    redirect_url: &'a str,
    nonce: &'a str,
}

#[derive(Deserialize)]
struct CallbackState {
    nonce: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    token_type: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
}

impl OAuthManager {
    pub fn new(db: Database, http: reqwest::Client) -> Arc<Self> {
        let apps = Provider::ALL
            .into_iter()
            .map(|provider| (provider, OAuthApp::for_provider(provider)))
            .collect();
        Arc::new(Self {
            http,
            dao: TrackerOAuthDao::new(db),
            apps,
            refresh_lock: tokio::sync::Mutex::new(()),
        })
    }

    #[cfg(test)]
    pub(crate) fn with_apps(
        db: Database,
        http: reqwest::Client,
        apps: HashMap<Provider, OAuthApp>,
    ) -> Arc<Self> {
        Arc::new(Self {
            http,
            dao: TrackerOAuthDao::new(db),
            apps,
            refresh_lock: tokio::sync::Mutex::new(()),
        })
    }

    fn app(&self, provider: Provider) -> &OAuthApp {
        self.apps
            .get(&provider)
            .expect("every native provider has an OAuth application")
    }

    fn new_verifier() -> String {
        format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
    }

    fn code_challenge(verifier: &str, method: PkceMethod) -> Option<String> {
        match method {
            PkceMethod::None => None,
            PkceMethod::Plain => Some(verifier.to_string()),
            PkceMethod::S256 => Some(URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))),
        }
    }

    pub fn start(
        &self,
        provider: Provider,
        user_id: &str,
        instance_origin: &str,
    ) -> Result<String, TrackerError> {
        let app = self.app(provider);
        let (client_id, _) = app.credentials()?;
        let verifier = Self::new_verifier();
        let nonce = Uuid::new_v4().simple().to_string();
        let callback_url = native_callback_url(instance_origin, provider);
        let state = serde_json::to_string(&AuthorizeState {
            redirect_url: &callback_url,
            nonce: &nonce,
        })
        .map_err(|error| TrackerError::Provider {
            provider,
            message: format!("could not encode OAuth state: {error}"),
        })?;
        let challenge = Self::code_challenge(&verifier, app.pkce);
        let mut url = Url::parse(&app.authorize_url).map_err(|error| TrackerError::Provider {
            provider,
            message: format!("invalid OAuth authorize URL: {error}"),
        })?;
        url.query_pairs_mut()
            .append_pair("client_id", client_id)
            .append_pair("response_type", "code")
            .append_pair("redirect_uri", &relay_callback_url(provider))
            .append_pair("state", &state);
        if let Some(scope) = app.scope {
            url.query_pairs_mut().append_pair("scope", scope);
        }
        if let Some(challenge) = challenge {
            url.query_pairs_mut()
                .append_pair("code_challenge", &challenge)
                .append_pair(
                    "code_challenge_method",
                    match app.pkce {
                        PkceMethod::S256 => "S256",
                        PkceMethod::Plain => "plain",
                        PkceMethod::None => unreachable!(),
                    },
                );
        }
        self.dao.insert_pending(
            provider.as_str(),
            &nonce,
            user_id,
            &verifier,
            time_codec::now_utc(),
        )?;
        Ok(url.to_string())
    }

    pub fn has_pending(&self, provider: Provider, nonce: &str) -> Result<bool, TrackerError> {
        Ok(self
            .dao
            .get_pending(provider.as_str(), nonce, time_codec::now_utc())?
            .is_some())
    }

    pub fn status(&self, provider: Provider, user_id: &str) -> Result<OAuthStatus, TrackerError> {
        let token = self.dao.get_token(provider.as_str(), user_id)?;
        Ok(OAuthStatus {
            logged_in: token.is_some(),
            username: token.and_then(|token| token.username),
        })
    }

    pub async fn status_with_backfill(
        &self,
        provider: Provider,
        user_id: &str,
    ) -> Result<OAuthStatus, TrackerError> {
        let status = self.status(provider, user_id)?;
        if !status.logged_in {
            return Ok(status);
        }
        // MangaBaka display names are profile data, not stable login handles.
        if provider != Provider::Mangabaka && status.username.is_some() {
            return Ok(status);
        }
        let Some(access_token) = self.access_token(provider, user_id).await? else {
            return self.status(provider, user_id);
        };
        let Some(username) = self.fetch_username(provider, &access_token).await else {
            return self.status(provider, user_id);
        };
        self.dao
            .update_username(provider.as_str(), user_id, &username)?;
        self.status(provider, user_id)
    }

    pub fn logout(&self, provider: Provider, user_id: &str) -> Result<(), TrackerError> {
        self.dao.delete_token(provider.as_str(), user_id)?;
        self.dao
            .delete_pending_for_user(provider.as_str(), user_id)?;
        Ok(())
    }

    pub fn logout_if_current(
        &self,
        provider: Provider,
        user_id: &str,
        expected_access_token: &str,
    ) -> Result<bool, TrackerError> {
        let deleted =
            self.dao
                .delete_token_if_current(provider.as_str(), user_id, expected_access_token)?;
        if deleted {
            self.dao
                .delete_pending_for_user(provider.as_str(), user_id)?;
        }
        Ok(deleted)
    }

    pub async fn handle_callback(
        &self,
        provider: Provider,
        user_id: &str,
        code: &str,
        state_raw: &str,
    ) -> Result<(), TrackerError> {
        let state: CallbackState =
            serde_json::from_str(state_raw).map_err(|_| TrackerError::InvalidState)?;
        let pending = self
            .dao
            .consume_pending(provider.as_str(), &state.nonce, time_codec::now_utc())?
            .ok_or(TrackerError::PendingExpired)?;
        if pending.user_id != user_id {
            return Err(TrackerError::InvalidState);
        }
        let app = self.app(provider);
        let (client_id, client_secret) = app.credentials()?;
        let mut form = vec![
            ("grant_type", "authorization_code".to_string()),
            ("code", code.to_string()),
            ("redirect_uri", relay_callback_url(provider)),
            ("client_id", client_id.to_string()),
            ("client_secret", client_secret.to_string()),
        ];
        if app.pkce != PkceMethod::None {
            form.push(("code_verifier", pending.verifier));
        }
        let mut token = self.exchange(provider, &form).await?;
        token.username = self.fetch_username(provider, &token.access_token).await;
        self.dao
            .upsert_token(provider.as_str(), &pending.user_id, &token)?;
        Ok(())
    }

    async fn exchange(
        &self,
        provider: Provider,
        form: &[(&str, String)],
    ) -> Result<TrackerOAuthToken, TrackerError> {
        let app = self.app(provider);
        let response = self
            .http
            .post(&app.token_url)
            .header(
                reqwest::header::USER_AGENT,
                concat!("kmrs/", env!("CARGO_PKG_VERSION")),
            )
            .form(form)
            .send()
            .await
            .map_err(|error| TrackerError::Provider {
                provider,
                message: format!("OAuth token request failed: {error}"),
            })?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| TrackerError::Provider {
                provider,
                message: format!("OAuth token response could not be read: {error}"),
            })?;
        if !status.is_success() {
            return Err(TrackerError::Upstream {
                provider,
                status,
                message: body,
            });
        }
        let parsed: TokenResponse =
            serde_json::from_str(&body).map_err(|error| TrackerError::Provider {
                provider,
                message: format!("OAuth token response is invalid: {error}"),
            })?;
        if parsed.access_token.is_empty() {
            return Err(TrackerError::Provider {
                provider,
                message: "OAuth token response has an empty access token".into(),
            });
        }
        Ok(TrackerOAuthToken {
            access_token: parsed.access_token,
            refresh_token: parsed.refresh_token,
            token_type: parsed.token_type,
            expires_at: parsed
                .expires_in
                .map(|seconds| time_codec::now_utc() + Duration::seconds(seconds)),
            username: None,
        })
    }

    async fn fetch_username(&self, provider: Provider, access_token: &str) -> Option<String> {
        let app = self.app(provider);
        let bearer = format!("Bearer {access_token}");
        let response = match provider {
            Provider::Anilist => self
                .http
                .post(&app.userinfo_url)
                .header(reqwest::header::AUTHORIZATION, bearer)
                .json(&serde_json::json!({ "query": "query { Viewer { name } }" }))
                .send()
                .await
                .ok()?,
            Provider::Mal | Provider::Mangabaka => self
                .http
                .get(&app.userinfo_url)
                .header(reqwest::header::AUTHORIZATION, bearer)
                .send()
                .await
                .ok()?,
            Provider::Bangumi => self
                .http
                .get(&app.userinfo_url)
                .header(reqwest::header::AUTHORIZATION, bearer)
                .header(
                    reqwest::header::USER_AGENT,
                    concat!("kmrs/", env!("CARGO_PKG_VERSION")),
                )
                .send()
                .await
                .ok()?,
        };
        if !response.status().is_success() {
            return None;
        }
        let value = response.json::<serde_json::Value>().await.ok()?;
        match provider {
            Provider::Anilist => value
                .pointer("/data/Viewer/name")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            Provider::Mal => value
                .get("name")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            Provider::Bangumi => value
                .get("username")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            Provider::Mangabaka => ["/data/nickname", "/data/preferred_username"]
                .into_iter()
                .find_map(|pointer| value.pointer(pointer).and_then(|value| value.as_str()))
                .map(str::to_string),
        }
    }

    pub async fn access_token(
        &self,
        provider: Provider,
        user_id: &str,
    ) -> Result<Option<String>, TrackerError> {
        let Some(token) = self.dao.get_token(provider.as_str(), user_id)? else {
            return Ok(None);
        };
        if !expired(&token, time_codec::now_utc()) {
            return Ok(Some(token.access_token));
        }
        if token.refresh_token.is_none() {
            self.logout_if_current(provider, user_id, &token.access_token)?;
            return Ok(None);
        }

        let _guard = self.refresh_lock.lock().await;
        let Some(token) = self.dao.get_token(provider.as_str(), user_id)? else {
            return Ok(None);
        };
        if !expired(&token, time_codec::now_utc()) {
            return Ok(Some(token.access_token));
        }
        let expected_access_token = token.access_token.clone();
        match self.do_refresh(provider, user_id).await? {
            Some(access_token) => Ok(Some(access_token)),
            None => {
                self.logout_if_current(provider, user_id, &expected_access_token)?;
                Ok(None)
            }
        }
    }

    pub async fn refresh_now(
        &self,
        provider: Provider,
        user_id: &str,
    ) -> Result<Option<String>, TrackerError> {
        let seen = self
            .dao
            .get_token(provider.as_str(), user_id)?
            .map(|token| token.access_token);
        let _guard = self.refresh_lock.lock().await;
        let Some(token) = self.dao.get_token(provider.as_str(), user_id)? else {
            return Ok(None);
        };
        if Some(token.access_token.as_str()) != seen.as_deref() {
            return Ok(Some(token.access_token));
        }
        self.do_refresh(provider, user_id).await
    }

    async fn do_refresh(
        &self,
        provider: Provider,
        user_id: &str,
    ) -> Result<Option<String>, TrackerError> {
        let Some(token) = self.dao.get_token(provider.as_str(), user_id)? else {
            return Ok(None);
        };
        let Some(refresh_token) = token.refresh_token.clone() else {
            return Ok(None);
        };
        let app = self.app(provider);
        let (client_id, client_secret) = app.credentials()?;
        let mut form = vec![
            ("grant_type", "refresh_token".to_string()),
            ("refresh_token", refresh_token.clone()),
            ("client_id", client_id.to_string()),
            ("client_secret", client_secret.to_string()),
        ];
        if app.refresh_with_redirect {
            form.push(("redirect_uri", relay_callback_url(provider)));
        }
        let expected_access_token = token.access_token.clone();
        let mut fresh = match self.exchange(provider, &form).await {
            Ok(token) => token,
            Err(TrackerError::Upstream {
                status:
                    reqwest::StatusCode::BAD_REQUEST
                    | reqwest::StatusCode::UNAUTHORIZED
                    | reqwest::StatusCode::FORBIDDEN,
                ..
            }) => {
                tracing::warn!("OAuth refresh was rejected for {provider}");
                return Ok(None);
            }
            Err(error) => return Err(error),
        };
        if fresh.refresh_token.is_none() {
            fresh.refresh_token = Some(refresh_token);
        }
        fresh.username = token.username;
        if !self.dao.update_token_if_current(
            provider.as_str(),
            user_id,
            &expected_access_token,
            &fresh,
        )? {
            return Ok(None);
        }
        Ok(Some(fresh.access_token))
    }
}

fn expired(token: &TrackerOAuthToken, now: OffsetDateTime) -> bool {
    token.expires_at.is_some_and(|expires_at| expires_at <= now)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::{Request, State};
    use axum::http::{HeaderMap, Method, StatusCode};
    use axum::response::{IntoResponse, Response};
    use axum::{Json, Router};
    use komga_db::{Migrator, Placeholders};
    use std::sync::Mutex;
    use std::time::Duration as StdDuration;

    #[derive(Debug, Clone)]
    struct CapturedRequest {
        method: Method,
        path: String,
        authorization: Option<String>,
        user_agent: Option<String>,
        form: HashMap<String, String>,
        json: Option<serde_json::Value>,
    }

    #[derive(Clone)]
    struct MockOAuth {
        requests: Arc<Mutex<Vec<CapturedRequest>>>,
        token_response: Arc<Mutex<(StatusCode, serde_json::Value)>>,
        user_response: Arc<Mutex<(StatusCode, serde_json::Value)>>,
        token_delay: StdDuration,
    }

    impl MockOAuth {
        fn new(user_body: serde_json::Value) -> Self {
            Self {
                requests: Arc::new(Mutex::new(Vec::new())),
                token_response: Arc::new(Mutex::new((
                    StatusCode::OK,
                    serde_json::json!({"access_token": "access", "expires_in": 3600}),
                ))),
                user_response: Arc::new(Mutex::new((StatusCode::OK, user_body))),
                token_delay: StdDuration::ZERO,
            }
        }

        fn set_token_response(&self, status: StatusCode, body: serde_json::Value) {
            *self.token_response.lock().unwrap() = (status, body);
        }

        fn requests(&self) -> Vec<CapturedRequest> {
            self.requests.lock().unwrap().clone()
        }

        fn token_requests(&self) -> Vec<CapturedRequest> {
            self.requests()
                .into_iter()
                .filter(|request| request.path == "/token")
                .collect()
        }
    }

    async fn capture(request: Request) -> CapturedRequest {
        let (parts, body) = request.into_parts();
        let bytes = axum::body::to_bytes(body, 1024 * 1024).await.unwrap();
        CapturedRequest {
            method: parts.method,
            path: parts.uri.path().to_string(),
            authorization: authorization(&parts.headers),
            user_agent: parts
                .headers
                .get(reqwest::header::USER_AGENT)
                .and_then(|value| value.to_str().ok())
                .map(str::to_string),
            form: form_urlencoded::parse(&bytes).into_owned().collect(),
            json: serde_json::from_slice(&bytes).ok(),
        }
    }

    fn authorization(headers: &HeaderMap) -> Option<String> {
        headers
            .get(reqwest::header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
    }

    async fn token_endpoint(State(mock): State<MockOAuth>, request: Request) -> Response {
        let captured = capture(request).await;
        mock.requests.lock().unwrap().push(captured);
        if !mock.token_delay.is_zero() {
            tokio::time::sleep(mock.token_delay).await;
        }
        let (status, body) = mock.token_response.lock().unwrap().clone();
        (status, Json(body)).into_response()
    }

    async fn user_endpoint(State(mock): State<MockOAuth>, request: Request) -> Response {
        let captured = capture(request).await;
        mock.requests.lock().unwrap().push(captured);
        let (status, body) = mock.user_response.lock().unwrap().clone();
        (status, Json(body)).into_response()
    }

    async fn serve(mock: MockOAuth) -> String {
        let app = Router::new()
            .route("/token", axum::routing::any(token_endpoint))
            .route("/user", axum::routing::any(user_endpoint))
            .with_state(mock);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        format!("http://{address}")
    }

    fn test_app(provider: Provider, base_url: &str) -> OAuthApp {
        let mut app = OAuthApp::for_provider(provider);
        app.client_id = Some(format!("{}-test-id", provider.as_str()));
        app.client_secret = Some(format!("{}-test-secret", provider.as_str()));
        app.authorize_url = format!("{base_url}/authorize");
        app.token_url = format!("{base_url}/token");
        app.userinfo_url = format!("{base_url}/user");
        app
    }

    fn test_manager(apps: Vec<OAuthApp>) -> (Arc<OAuthManager>, TrackerOAuthDao) {
        let db = Database::open_in_memory(false).unwrap();
        let db = migrate(db);
        let dao = TrackerOAuthDao::new(db.clone());
        let apps = apps.into_iter().map(|app| (app.provider, app)).collect();
        let manager = OAuthManager::with_apps(db, reqwest::Client::new(), apps);
        (manager, dao)
    }

    fn migrate(db: Database) -> Database {
        Migrator::new(&komga_db::kmrs_migrations(), Placeholders::default())
            .migrate(&db.rw().unwrap())
            .unwrap();
        db
    }

    fn query(url: &Url, key: &str) -> Option<String> {
        url.query_pairs()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.into_owned())
    }

    fn state(url: &Url) -> (String, serde_json::Value) {
        let raw = query(url, "state").unwrap();
        let value = serde_json::from_str(&raw).unwrap();
        (raw, value)
    }

    fn stored_token(access_token: &str) -> TrackerOAuthToken {
        TrackerOAuthToken {
            access_token: access_token.into(),
            refresh_token: Some("refresh-old".into()),
            token_type: Some("Bearer".into()),
            expires_at: Some(time_codec::now_utc() - Duration::seconds(1)),
            username: Some("existing-user".into()),
        }
    }

    #[test]
    fn production_apps_read_only_the_eight_kmrs_build_variables() {
        let cases = [
            (
                Provider::Anilist,
                "KMRS_OAUTH_ANILIST_CLIENT_ID",
                "KMRS_OAUTH_ANILIST_CLIENT_SECRET",
                option_env!("KMRS_OAUTH_ANILIST_CLIENT_ID"),
                option_env!("KMRS_OAUTH_ANILIST_CLIENT_SECRET"),
            ),
            (
                Provider::Mal,
                "KMRS_OAUTH_MAL_CLIENT_ID",
                "KMRS_OAUTH_MAL_CLIENT_SECRET",
                option_env!("KMRS_OAUTH_MAL_CLIENT_ID"),
                option_env!("KMRS_OAUTH_MAL_CLIENT_SECRET"),
            ),
            (
                Provider::Bangumi,
                "KMRS_OAUTH_BANGUMI_CLIENT_ID",
                "KMRS_OAUTH_BANGUMI_CLIENT_SECRET",
                option_env!("KMRS_OAUTH_BANGUMI_CLIENT_ID"),
                option_env!("KMRS_OAUTH_BANGUMI_CLIENT_SECRET"),
            ),
            (
                Provider::Mangabaka,
                "KMRS_OAUTH_MANGABAKA_CLIENT_ID",
                "KMRS_OAUTH_MANGABAKA_CLIENT_SECRET",
                option_env!("KMRS_OAUTH_MANGABAKA_CLIENT_ID"),
                option_env!("KMRS_OAUTH_MANGABAKA_CLIENT_SECRET"),
            ),
        ];
        for (provider, id_name, secret_name, id, secret) in cases {
            let app = OAuthApp::for_provider(provider);
            assert_eq!(app.client_id_env, id_name);
            assert_eq!(app.client_secret_env, secret_name);
            assert_eq!(app.client_id, env_value(id));
            assert_eq!(app.client_secret, env_value(secret));
        }
        let bangumi = OAuthApp::for_provider(Provider::Bangumi);
        assert_eq!(bangumi.authorize_url, "https://bgm.tv/oauth/authorize");
        assert_eq!(bangumi.token_url, "https://bgm.tv/oauth/access_token");
        assert_eq!(bangumi.userinfo_url, "https://next.bgm.tv/p1/me");

        let db = migrate(Database::open_in_memory(false).unwrap());
        let manager = OAuthManager::new(db, reqwest::Client::new());
        for provider in Provider::ALL {
            assert!(!manager.status(provider, "alice").unwrap().logged_in);
        }
    }

    #[tokio::test]
    async fn missing_client_id_and_secret_are_specific_errors() {
        let mut missing_id = test_app(Provider::Anilist, "http://oauth.test");
        missing_id.client_id = None;
        let (manager, _) = test_manager(vec![missing_id]);
        assert!(matches!(
            manager.start(Provider::Anilist, "alice", "http://kmrs.test"),
            Err(TrackerError::MissingClientId {
                variable: "KMRS_OAUTH_ANILIST_CLIENT_ID",
                ..
            })
        ));

        let mut missing_secret = test_app(Provider::Bangumi, "http://oauth.test");
        missing_secret.client_secret = None;
        let (manager, dao) = test_manager(vec![missing_secret]);
        assert!(matches!(
            manager.start(Provider::Bangumi, "alice", "http://kmrs.test"),
            Err(TrackerError::MissingClientSecret {
                variable: "KMRS_OAUTH_BANGUMI_CLIENT_SECRET",
                ..
            })
        ));
        let mut token = stored_token("expired");
        token.expires_at = Some(time_codec::now_utc() - Duration::seconds(1));
        dao.upsert_token("bangumi", "alice", &token).unwrap();
        assert!(matches!(
            manager.access_token(Provider::Bangumi, "alice").await,
            Err(TrackerError::MissingClientSecret { .. })
        ));
    }

    #[test]
    fn start_builds_native_callback_state_and_provider_pkce() {
        let apps = Provider::ALL
            .into_iter()
            .map(|provider| test_app(provider, "http://oauth.test"))
            .collect();
        let (manager, dao) = test_manager(apps);
        for provider in Provider::ALL {
            let authorize = manager
                .start(provider, "alice", "http://kmrs.test/")
                .unwrap();
            let url = Url::parse(&authorize).unwrap();
            assert_eq!(
                query(&url, "client_id").as_deref(),
                Some(format!("{}-test-id", provider.as_str()).as_str())
            );
            assert_eq!(query(&url, "response_type").as_deref(), Some("code"));
            assert_eq!(
                query(&url, "redirect_uri").as_deref(),
                Some(relay_callback_url(provider).as_str())
            );
            let (_, state) = state(&url);
            assert_eq!(
                state["redirectUrl"].as_str(),
                Some(
                    format!(
                        "http://kmrs.test/api/v1/trackers/oauth/{}/callback",
                        provider.as_str()
                    )
                    .as_str()
                )
            );
            let nonce = state["nonce"].as_str().unwrap();
            let pending = dao
                .get_pending(provider.as_str(), nonce, time_codec::now_utc())
                .unwrap()
                .unwrap();
            assert_eq!(pending.user_id, "alice");
            let challenge = query(&url, "code_challenge");
            match provider {
                Provider::Anilist | Provider::Mangabaka => {
                    assert_eq!(
                        query(&url, "code_challenge_method").as_deref(),
                        Some("S256")
                    );
                    assert_eq!(
                        challenge,
                        Some(URL_SAFE_NO_PAD.encode(Sha256::digest(pending.verifier.as_bytes())))
                    );
                }
                Provider::Mal => {
                    assert_eq!(
                        query(&url, "code_challenge_method").as_deref(),
                        Some("plain")
                    );
                    assert_eq!(challenge, Some(pending.verifier));
                }
                Provider::Bangumi => {
                    assert_eq!(challenge, None);
                    assert_eq!(query(&url, "code_challenge_method"), None);
                }
            }
            assert_eq!(
                query(&url, "scope"),
                (provider == Provider::Mangabaka)
                    .then(|| "library.read library.write profile offline_access openid".into())
            );
        }
    }

    #[tokio::test]
    async fn callback_username_logout_and_replay_for_all_providers() {
        for provider in Provider::ALL {
            let (user_body, username) = match provider {
                Provider::Anilist => (
                    serde_json::json!({"data": {"Viewer": {"name": "anilist-user"}}}),
                    "anilist-user",
                ),
                Provider::Mal => (serde_json::json!({"name": "mal-user"}), "mal-user"),
                Provider::Bangumi => (
                    serde_json::json!({"username": "bangumi-user"}),
                    "bangumi-user",
                ),
                Provider::Mangabaka => (
                    serde_json::json!({"data": {"nickname": "mangabaka-user"}}),
                    "mangabaka-user",
                ),
            };
            let mock = MockOAuth::new(user_body);
            let base_url = serve(mock.clone()).await;
            let (manager, dao) = test_manager(vec![test_app(provider, &base_url)]);
            let authorize = manager
                .start(provider, "alice", "http://kmrs.test")
                .unwrap();
            let url = Url::parse(&authorize).unwrap();
            let (state_raw, state) = state(&url);
            let nonce = state["nonce"].as_str().unwrap();
            let verifier = dao
                .get_pending(provider.as_str(), nonce, time_codec::now_utc())
                .unwrap()
                .unwrap()
                .verifier;

            manager
                .handle_callback(provider, "alice", "authorization-code", &state_raw)
                .await
                .unwrap();
            let status = manager.status(provider, "alice").unwrap();
            assert!(status.logged_in);
            assert_eq!(status.username.as_deref(), Some(username));
            assert_eq!(
                manager.access_token(provider, "alice").await.unwrap(),
                Some("access".into())
            );

            let token_requests = mock.token_requests();
            assert_eq!(token_requests.len(), 1);
            assert_eq!(
                token_requests[0].user_agent.as_deref(),
                Some(concat!("kmrs/", env!("CARGO_PKG_VERSION")))
            );
            let form = &token_requests[0].form;
            assert_eq!(form["grant_type"], "authorization_code");
            assert_eq!(form["code"], "authorization-code");
            assert_eq!(form["redirect_uri"], relay_callback_url(provider));
            assert_eq!(form["client_id"], format!("{}-test-id", provider.as_str()));
            assert_eq!(
                form["client_secret"],
                format!("{}-test-secret", provider.as_str())
            );
            if provider == Provider::Bangumi {
                assert!(!form.contains_key("code_verifier"));
            } else {
                assert_eq!(form["code_verifier"], verifier);
            }
            let user_request = mock
                .requests()
                .into_iter()
                .find(|request| request.path == "/user")
                .unwrap();
            assert_eq!(user_request.authorization.as_deref(), Some("Bearer access"));
            if provider == Provider::Anilist {
                assert_eq!(user_request.method, Method::POST);
                assert!(user_request.json.is_some());
            } else {
                assert_eq!(user_request.method, Method::GET);
            }

            assert!(matches!(
                manager
                    .handle_callback(provider, "alice", "authorization-code", &state_raw)
                    .await,
                Err(TrackerError::PendingExpired)
            ));
            assert_eq!(mock.token_requests().len(), 1);

            let second = manager
                .start(provider, "alice", "http://kmrs.test")
                .unwrap();
            let second_url = Url::parse(&second).unwrap();
            let (_, second_state) = self::state(&second_url);
            let second_nonce = second_state["nonce"].as_str().unwrap();
            assert!(manager.has_pending(provider, second_nonce).unwrap());
            manager.logout(provider, "alice").unwrap();
            assert!(!manager.status(provider, "alice").unwrap().logged_in);
            assert!(!manager.has_pending(provider, second_nonce).unwrap());
            assert_eq!(manager.access_token(provider, "alice").await.unwrap(), None);
        }
    }

    #[tokio::test]
    async fn mangabaka_profile_prefers_nickname() {
        assert_eq!(
            OAuthApp::for_provider(Provider::Mangabaka).userinfo_url,
            "https://api.mangabaka.org/v1/my/profile"
        );
        let mock = MockOAuth::new(serde_json::json!({
            "data": {"nickname": "MangaBaka Display", "preferred_username": "mangabaka-user"}
        }));
        let base_url = serve(mock).await;
        let (manager, _) = test_manager(vec![test_app(Provider::Mangabaka, &base_url)]);

        assert_eq!(
            manager
                .fetch_username(Provider::Mangabaka, "access")
                .await
                .as_deref(),
            Some("MangaBaka Display")
        );
    }

    #[tokio::test]
    async fn mangabaka_profile_falls_back_to_username() {
        let mock = MockOAuth::new(serde_json::json!({
            "data": {"nickname": null, "preferred_username": "mangabaka-user"}
        }));
        let base_url = serve(mock).await;
        let (manager, _) = test_manager(vec![test_app(Provider::Mangabaka, &base_url)]);

        assert_eq!(
            manager
                .fetch_username(Provider::Mangabaka, "access")
                .await
                .as_deref(),
            Some("mangabaka-user")
        );
    }

    #[tokio::test]
    async fn mangabaka_status_refreshes_existing_display_name() {
        let mock = MockOAuth::new(serde_json::json!({
            "data": {"nickname": "MangaBaka Display", "preferred_username": "mangabaka-user"}
        }));
        let base_url = serve(mock.clone()).await;
        let (manager, dao) = test_manager(vec![test_app(Provider::Mangabaka, &base_url)]);
        dao.upsert_token(
            "mangabaka",
            "alice",
            &TrackerOAuthToken {
                access_token: "access".into(),
                refresh_token: None,
                token_type: Some("Bearer".into()),
                expires_at: None,
                username: Some("mangabaka-user".into()),
            },
        )
        .unwrap();

        let status = manager
            .status_with_backfill(Provider::Mangabaka, "alice")
            .await
            .unwrap();
        assert_eq!(status.username.as_deref(), Some("MangaBaka Display"));
        assert_eq!(mock.requests().len(), 1);
    }

    #[tokio::test]
    async fn callback_rejects_invalid_state_without_token_exchange() {
        let mock = MockOAuth::new(serde_json::json!({}));
        let base_url = serve(mock.clone()).await;
        let (manager, _) = test_manager(vec![test_app(Provider::Mal, &base_url)]);

        let error = manager
            .handle_callback(Provider::Mal, "alice", "bad-code", "not-json")
            .await
            .unwrap_err();

        assert!(matches!(error, TrackerError::InvalidState));
        assert!(mock.token_requests().is_empty());
        assert!(!manager.status(Provider::Mal, "alice").unwrap().logged_in);
    }

    #[tokio::test]
    async fn callback_exchange_failure_consumes_pending_without_fallback() {
        let mock = MockOAuth::new(serde_json::json!({}));
        mock.set_token_response(
            StatusCode::BAD_REQUEST,
            serde_json::json!({"error": "invalid_grant"}),
        );
        let base_url = serve(mock.clone()).await;
        let (manager, _) = test_manager(vec![test_app(Provider::Mal, &base_url)]);
        let authorize = manager
            .start(Provider::Mal, "alice", "http://kmrs.test")
            .unwrap();
        let url = Url::parse(&authorize).unwrap();
        let (state_raw, _) = state(&url);

        let error = manager
            .handle_callback(Provider::Mal, "alice", "bad-code", &state_raw)
            .await
            .unwrap_err();
        assert!(matches!(
            error,
            TrackerError::Upstream {
                status: StatusCode::BAD_REQUEST,
                ..
            }
        ));
        assert!(error.to_string().contains("400 Bad Request"));
        assert!(matches!(
            manager
                .handle_callback(Provider::Mal, "alice", "bad-code", &state_raw)
                .await,
            Err(TrackerError::PendingExpired)
        ));
        assert_eq!(mock.token_requests().len(), 1);
        assert!(!manager.status(Provider::Mal, "alice").unwrap().logged_in);
    }

    #[tokio::test]
    async fn refresh_transport_failure_preserves_login() {
        let mock = MockOAuth::new(serde_json::json!({}));
        mock.set_token_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            serde_json::json!({"error": "temporarily unavailable"}),
        );
        let base_url = serve(mock.clone()).await;
        let (manager, dao) = test_manager(vec![test_app(Provider::Mal, &base_url)]);
        dao.upsert_token("mal", "alice", &stored_token("access-old"))
            .unwrap();

        let result = manager.access_token(Provider::Mal, "alice").await;
        assert!(result.is_err());
        assert!(manager.status(Provider::Mal, "alice").unwrap().logged_in);
        assert_eq!(
            dao.get_token("mal", "alice").unwrap().unwrap().access_token,
            "access-old"
        );
    }

    #[tokio::test]
    async fn refresh_rejection_logs_out() {
        let mock = MockOAuth::new(serde_json::json!({}));
        mock.set_token_response(
            StatusCode::BAD_REQUEST,
            serde_json::json!({"error": "invalid_grant"}),
        );
        let base_url = serve(mock.clone()).await;
        let (manager, _) = test_manager(vec![test_app(Provider::Mal, &base_url)]);
        manager
            .dao
            .upsert_token("mal", "alice", &stored_token("access-old"))
            .unwrap();

        assert_eq!(
            manager.access_token(Provider::Mal, "alice").await.unwrap(),
            None
        );
        assert!(!manager.status(Provider::Mal, "alice").unwrap().logged_in);
    }

    #[tokio::test]
    async fn logout_during_delayed_refresh_stays_logged_out() {
        let mut mock = MockOAuth::new(serde_json::json!({}));
        mock.token_delay = StdDuration::from_millis(50);
        mock.set_token_response(
            StatusCode::OK,
            serde_json::json!({"access_token": "access-new", "expires_in": 3600}),
        );
        let base_url = serve(mock.clone()).await;
        let (manager, dao) = test_manager(vec![test_app(Provider::Bangumi, &base_url)]);
        dao.upsert_token("bangumi", "alice", &stored_token("access-old"))
            .unwrap();

        let first = manager.access_token(Provider::Bangumi, "alice");
        let second = async { manager.logout(Provider::Bangumi, "alice") };
        let (first, second) = tokio::join!(first, second);
        second.unwrap();
        assert_eq!(first.unwrap(), None);
        assert!(
            !manager
                .status(Provider::Bangumi, "alice")
                .unwrap()
                .logged_in
        );
    }

    #[tokio::test]
    async fn refresh_is_serialized_and_preserves_refresh_token_and_username() {
        let mut mock = MockOAuth::new(serde_json::json!({}));
        mock.token_delay = StdDuration::from_millis(50);
        mock.set_token_response(
            StatusCode::OK,
            serde_json::json!({"access_token": "access-new", "expires_in": 3600}),
        );
        let base_url = serve(mock.clone()).await;
        let (manager, dao) = test_manager(vec![test_app(Provider::Bangumi, &base_url)]);
        dao.upsert_token("bangumi", "alice", &stored_token("access-old"))
            .unwrap();

        let first = manager.access_token(Provider::Bangumi, "alice");
        let second = manager.access_token(Provider::Bangumi, "alice");
        let (first, second) = tokio::join!(first, second);
        assert_eq!(first.unwrap().as_deref(), Some("access-new"));
        assert_eq!(second.unwrap().as_deref(), Some("access-new"));
        assert_eq!(mock.token_requests().len(), 1);
        let stored = dao.get_token("bangumi", "alice").unwrap().unwrap();
        assert_eq!(stored.refresh_token.as_deref(), Some("refresh-old"));
        assert_eq!(stored.username.as_deref(), Some("existing-user"));
        let form = &mock.token_requests()[0].form;
        assert_eq!(form["grant_type"], "refresh_token");
        assert_eq!(form["refresh_token"], "refresh-old");
        assert_eq!(form["redirect_uri"], relay_callback_url(Provider::Bangumi));

        mock.set_token_response(
            StatusCode::OK,
            serde_json::json!({
                "access_token": "access-forced",
                "refresh_token": "refresh-rotated",
                "expires_in": 3600
            }),
        );
        assert_eq!(
            manager
                .refresh_now(Provider::Bangumi, "alice")
                .await
                .unwrap()
                .as_deref(),
            Some("access-forced")
        );
        assert_eq!(mock.token_requests().len(), 2);
        let stored = dao.get_token("bangumi", "alice").unwrap().unwrap();
        assert_eq!(stored.refresh_token.as_deref(), Some("refresh-rotated"));
        assert_eq!(stored.username.as_deref(), Some("existing-user"));
    }

    #[tokio::test]
    async fn expired_token_without_refresh_is_logged_out() {
        let (manager, dao) = test_manager(vec![test_app(Provider::Anilist, "http://oauth.test")]);
        let mut token = stored_token("expired");
        token.refresh_token = None;
        dao.upsert_token("anilist", "alice", &token).unwrap();

        assert_eq!(
            manager
                .access_token(Provider::Anilist, "alice")
                .await
                .unwrap(),
            None
        );
        assert!(
            !manager
                .status(Provider::Anilist, "alice")
                .unwrap()
                .logged_in
        );
    }
}
