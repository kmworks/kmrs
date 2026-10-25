use super::parse_tracker_url;
use crate::service::tracker::oauth::OAuthManager;
use crate::service::tracker::{Provider, TrackerError, TrackerService};
use komga_core::tracker::{RemoteState, TrackMediaType, TrackSearchItem, TrackStatus, TrackUpdate};
use reqwest::{Method, StatusCode, Url};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::Arc;

const API_ORIGIN: &str = "https://api.bgm.tv";
const SITE_ORIGIN: &str = "https://bgm.tv";
const COLLECTION_PAGE_SIZE: usize = 100;
const USER_AGENT: &str = concat!("kmrs/", env!("CARGO_PKG_VERSION"));

pub struct BangumiTracker {
    http: reqwest::Client,
    oauth: Arc<OAuthManager>,
    api_origin: String,
}

#[derive(Debug, Default, Deserialize)]
struct Subject {
    id: i64,
    #[serde(default)]
    name: String,
    #[serde(default)]
    name_cn: Option<String>,
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    images: Option<Images>,
    #[serde(default)]
    platform: Option<String>,
    #[serde(default)]
    eps: Option<i32>,
    #[serde(default)]
    total_episodes: Option<i32>,
    #[serde(default)]
    volumes: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct Images {
    #[serde(default)]
    large: Option<String>,
    #[serde(default)]
    common: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct SearchPage {
    #[serde(default)]
    data: Vec<Subject>,
}

#[derive(Debug, Deserialize)]
struct Me {
    username: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct CollectionPage {
    #[serde(default)]
    data: Vec<Collection>,
    #[serde(default)]
    total: Option<u64>,
}

#[derive(Debug, Default, Deserialize)]
struct Collection {
    #[serde(default)]
    subject_id: Option<i64>,
    #[serde(default, rename = "type")]
    collection_type: Option<i64>,
    #[serde(default)]
    rate: Option<i32>,
    #[serde(default)]
    ep_status: Option<i64>,
    #[serde(default)]
    vol_status: Option<i32>,
}

fn provider_error(message: impl Into<String>) -> TrackerError {
    TrackerError::Provider {
        provider: Provider::Bangumi,
        message: message.into(),
    }
}

fn not_logged_in() -> TrackerError {
    TrackerError::NotLoggedIn {
        provider: Provider::Bangumi,
    }
}

fn track_id(value: &str) -> Result<i64, TrackerError> {
    value
        .parse()
        .map_err(|_| provider_error(format!("invalid Bangumi subject id '{value}'")))
}

fn collection_status(collection_type: Option<i64>) -> Option<TrackStatus> {
    match collection_type {
        Some(1) => Some(TrackStatus::Planning),
        Some(2) => Some(TrackStatus::Completed),
        Some(3) => Some(TrackStatus::Reading),
        Some(4) => Some(TrackStatus::Paused),
        Some(5) => Some(TrackStatus::Dropped),
        _ => None,
    }
}

fn collection_type(status: TrackStatus) -> i64 {
    match status {
        TrackStatus::Reading | TrackStatus::Rereading => 3,
        TrackStatus::Planning => 1,
        TrackStatus::Completed => 2,
        TrackStatus::Paused => 4,
        TrackStatus::Dropped => 5,
    }
}

impl BangumiTracker {
    pub fn new(http: reqwest::Client, oauth: Arc<OAuthManager>) -> Self {
        Self::with_api_origin(http, oauth, API_ORIGIN)
    }

    pub fn with_api_origin(
        http: reqwest::Client,
        oauth: Arc<OAuthManager>,
        api_origin: impl Into<String>,
    ) -> Self {
        Self {
            http,
            oauth,
            api_origin: api_origin.into().trim_end_matches('/').to_string(),
        }
    }

    fn api_url(&self, segments: &[&str]) -> Result<Url, TrackerError> {
        let mut url = Url::parse(&format!("{}/", self.api_origin))
            .map_err(|error| provider_error(format!("invalid API origin: {error}")))?;
        url.path_segments_mut()
            .map_err(|_| provider_error("API origin cannot contain path segments"))?
            .extend(segments);
        Ok(url)
    }

    async fn access_token(&self, user_id: &str) -> Result<String, TrackerError> {
        self.oauth
            .access_token(Provider::Bangumi, user_id)
            .await?
            .ok_or_else(not_logged_in)
    }

    async fn send_authed(
        &self,
        user_id: &str,
        method: Method,
        url: Url,
        body: Option<&Value>,
        action: &str,
    ) -> Result<reqwest::Response, TrackerError> {
        let token = self.access_token(user_id).await?;
        let build = |token: &str| {
            let mut request = self
                .http
                .request(method.clone(), url.clone())
                .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
                .header(reqwest::header::USER_AGENT, USER_AGENT);
            if let Some(body) = body {
                request = request.json(body);
            }
            request
        };
        let mut response = build(&token)
            .send()
            .await
            .map_err(|error| provider_error(format!("{action} request failed: {error}")))?;
        if response.status() == StatusCode::UNAUTHORIZED {
            let token = match self.oauth.refresh_now(Provider::Bangumi, user_id).await? {
                Some(token) => token,
                None => {
                    self.oauth
                        .logout_if_current(Provider::Bangumi, user_id, &token)?;
                    return Err(not_logged_in());
                }
            };
            response = build(&token)
                .send()
                .await
                .map_err(|error| provider_error(format!("{action} retry failed: {error}")))?;
            if response.status() == StatusCode::UNAUTHORIZED {
                self.oauth
                    .logout_if_current(Provider::Bangumi, user_id, &token)?;
                return Err(not_logged_in());
            }
        }
        Ok(response)
    }

    async fn decode_json<T: DeserializeOwned>(
        response: reqwest::Response,
        action: &str,
    ) -> Result<T, TrackerError> {
        let status = response.status();
        let body = response.text().await.map_err(|error| {
            provider_error(format!("{action} response could not be read: {error}"))
        })?;
        if !status.is_success() {
            return Err(provider_error(format!(
                "{action} returned {status}: {body}"
            )));
        }
        serde_json::from_str(&body)
            .map_err(|error| provider_error(format!("{action} response is invalid: {error}")))
    }

    async fn ensure_success(response: reqwest::Response, action: &str) -> Result<(), TrackerError> {
        if response.status().is_success() {
            return Ok(());
        }
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        Err(provider_error(format!(
            "{action} returned {status}: {body}"
        )))
    }

    async fn get_json<T: DeserializeOwned>(
        &self,
        user_id: &str,
        url: Url,
        action: &str,
    ) -> Result<T, TrackerError> {
        let response = self
            .send_authed(user_id, Method::GET, url, None, action)
            .await?;
        Self::decode_json(response, action).await
    }

    async fn me(&self, user_id: &str) -> Result<String, TrackerError> {
        let me: Me = self
            .get_json(user_id, self.api_url(&["v0", "me"])?, "Bangumi /me")
            .await?;
        me.username
            .filter(|username| !username.is_empty())
            .ok_or_else(|| provider_error("Bangumi /me response has no username"))
    }

    async fn tracked_subject_ids(
        &self,
        user_id: &str,
        username: &str,
    ) -> Result<HashSet<i64>, TrackerError> {
        let mut tracked = HashSet::new();
        let mut offset = 0_u64;
        loop {
            let mut url = self.api_url(&["v0", "users", username, "collections"])?;
            url.query_pairs_mut()
                .append_pair("subject_type", "1")
                .append_pair("limit", &COLLECTION_PAGE_SIZE.to_string())
                .append_pair("offset", &offset.to_string());
            let page: CollectionPage = self
                .get_json(user_id, url, "Bangumi collection list")
                .await?;
            let received = page.data.len();
            if received == 0 {
                break;
            }
            tracked.extend(page.data.iter().filter_map(|entry| entry.subject_id));
            offset += received as u64;
            if received < COLLECTION_PAGE_SIZE || page.total.is_some_and(|total| offset >= total) {
                break;
            }
        }
        Ok(tracked)
    }

    async fn current_tracked_ids(&self, user_id: &str) -> Result<HashSet<i64>, TrackerError> {
        let username = self.me(user_id).await?;
        self.tracked_subject_ids(user_id, &username).await
    }

    fn subject_url_id(query: &str) -> Option<i64> {
        let url = parse_tracker_url(query)?;
        let host = url.host_str()?.to_ascii_lowercase();
        if host != "bgm.tv" && host != "bangumi.tv" && !host.ends_with(".bgm.tv") {
            return None;
        }
        let mut segments = url.path_segments()?;
        if segments.next()? != "subject" {
            return None;
        }
        segments.next()?.parse().ok()
    }

    fn search_item(subject: Subject, tracked: &HashSet<i64>) -> TrackSearchItem {
        let title = subject
            .name_cn
            .as_deref()
            .filter(|title| !title.is_empty())
            .unwrap_or(&subject.name);
        let media_type = match subject.platform.as_deref() {
            Some(platform) if platform.contains("小说") => Some(TrackMediaType::Novel),
            Some(platform) if platform.contains("漫画") => Some(TrackMediaType::Manga),
            _ => None,
        };
        let cover_url = subject
            .images
            .as_ref()
            .and_then(|images| images.large.clone().or_else(|| images.common.clone()));
        TrackSearchItem {
            id: subject.id.to_string(),
            title: if title.is_empty() {
                "Unknown Title"
            } else {
                title
            }
            .into(),
            cover_url,
            description: subject.summary,
            tracked: tracked.contains(&subject.id),
            media_type,
            url: Some(format!("{SITE_ORIGIN}/subject/{}", subject.id)),
        }
    }

    async fn search_v0(
        &self,
        user_id: &str,
        query: &str,
        nsfw: bool,
    ) -> Result<Vec<Subject>, TrackerError> {
        let mut url = self.api_url(&["v0", "search", "subjects"])?;
        url.query_pairs_mut().append_pair("limit", "20");
        let body = json!({
            "keyword": query,
            "sort": "match",
            "filter": { "type": [1], "nsfw": nsfw }
        });
        let response = self
            .send_authed(user_id, Method::POST, url, Some(&body), "Bangumi search")
            .await?;
        let page: SearchPage = Self::decode_json(response, "Bangumi search").await?;
        Ok(page.data)
    }

    async fn subject(&self, user_id: &str, id: i64) -> Result<Subject, TrackerError> {
        self.get_json(
            user_id,
            self.api_url(&["v0", "subjects", &id.to_string()])?,
            "Bangumi subject detail",
        )
        .await
    }

    async fn subject_totals(
        &self,
        user_id: &str,
        id: i64,
    ) -> Result<(Option<i32>, Option<i32>), TrackerError> {
        let subject = self.subject(user_id, id).await?;
        Ok((subject.eps.or(subject.total_episodes), subject.volumes))
    }
}

#[async_trait::async_trait]
impl TrackerService for BangumiTracker {
    fn provider(&self) -> Provider {
        Provider::Bangumi
    }

    fn is_logged_in(&self, user_id: &str) -> Result<bool, TrackerError> {
        Ok(self.oauth.status(Provider::Bangumi, user_id)?.logged_in)
    }

    async fn search(
        &self,
        user_id: &str,
        query: &str,
        nsfw: bool,
    ) -> Result<Vec<TrackSearchItem>, TrackerError> {
        let tracked = self.current_tracked_ids(user_id).await?;
        if let Some(id) = Self::subject_url_id(query) {
            let subject = self.subject(user_id, id).await?;
            return Ok(vec![Self::search_item(subject, &tracked)]);
        }
        let subjects = self.search_v0(user_id, query, nsfw).await?;
        Ok(subjects
            .into_iter()
            .map(|subject| Self::search_item(subject, &tracked))
            .collect())
    }

    async fn get_state(&self, user_id: &str, id: &str) -> Result<RemoteState, TrackerError> {
        let id = track_id(id)?;
        let username = self.me(user_id).await?;
        let url = self.api_url(&["v0", "users", &username, "collections", &id.to_string()])?;
        let response = self
            .send_authed(user_id, Method::GET, url, None, "Bangumi collection")
            .await?;
        if response.status() == StatusCode::NOT_FOUND {
            let (total_chapters, total_volumes) = self.subject_totals(user_id, id).await?;
            return Ok(RemoteState {
                total_chapters,
                total_volumes,
                ..RemoteState::default()
            });
        }
        let collection: Collection = Self::decode_json(response, "Bangumi collection").await?;
        if collection.collection_type.is_none() {
            let (total_chapters, total_volumes) = self.subject_totals(user_id, id).await?;
            return Ok(RemoteState {
                total_chapters,
                total_volumes,
                ..RemoteState::default()
            });
        }
        let (total_chapters, total_volumes) = self.subject_totals(user_id, id).await?;
        Ok(RemoteState {
            score: collection.rate,
            status: collection_status(collection.collection_type),
            last_read_chapter: collection.ep_status.map(|value| value as f32),
            last_read_volume: collection.vol_status,
            total_chapters,
            total_volumes,
            start_read_date: None,
            finish_read_date: None,
        })
    }

    async fn update(
        &self,
        user_id: &str,
        id: &str,
        update: &TrackUpdate,
    ) -> Result<(), TrackerError> {
        let id = track_id(id)?;
        let mut body = serde_json::Map::new();
        if let Some(status) = update.status {
            body.insert("type".into(), json!(collection_type(status)));
        }
        if let Some(score) = update.score {
            body.insert("rate".into(), json!(score));
        }
        if let Some(chapter) = update.last_read_chapter {
            body.insert("ep_status".into(), json!(chapter.floor() as i64));
        }
        if let Some(volume) = update.last_read_volume {
            body.insert("vol_status".into(), json!(volume));
        }
        if body.is_empty() {
            return Ok(());
        }
        let response = self
            .send_authed(
                user_id,
                Method::POST,
                self.api_url(&["v0", "users", "-", "collections", &id.to_string()])?,
                Some(&Value::Object(body)),
                "Bangumi collection update",
            )
            .await?;
        Self::ensure_success(response, "Bangumi collection update").await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::tracker::oauth::OAuthApp;
    use axum::extract::{Request, State};
    use axum::http::{HeaderMap, Method, StatusCode};
    use axum::response::{IntoResponse, Response};
    use axum::{Json, Router};
    use komga_core::tracker::{BookTrackInput, TrackMode};
    use komga_db::dao::tracker_oauth::{TrackerOAuthDao, TrackerOAuthToken};
    use komga_db::pool::Database;
    use komga_db::{Migrator, Placeholders};
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Debug, Clone)]
    struct CapturedRequest {
        method: Method,
        path: String,
        query: String,
        authorization: Option<String>,
        json: Option<Value>,
        form: HashMap<String, String>,
    }

    type Responder = dyn Fn(&CapturedRequest) -> (StatusCode, Value) + Send + Sync;

    #[derive(Clone)]
    struct Mock {
        requests: Arc<Mutex<Vec<CapturedRequest>>>,
        responder: Arc<Responder>,
    }

    impl Mock {
        fn requests(&self) -> Vec<CapturedRequest> {
            self.requests.lock().unwrap().clone()
        }
    }

    fn authorization(headers: &HeaderMap) -> Option<String> {
        headers
            .get(reqwest::header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
    }

    async fn handle(State(mock): State<Mock>, request: Request) -> Response {
        let (parts, body) = request.into_parts();
        let bytes = axum::body::to_bytes(body, 1024 * 1024).await.unwrap();
        let captured = CapturedRequest {
            method: parts.method,
            path: parts.uri.path().to_string(),
            query: parts.uri.query().unwrap_or_default().to_string(),
            authorization: authorization(&parts.headers),
            json: serde_json::from_slice(&bytes).ok(),
            form: form_urlencoded::parse(&bytes).into_owned().collect(),
        };
        let (status, body) = (mock.responder)(&captured);
        mock.requests.lock().unwrap().push(captured);
        (status, Json(body)).into_response()
    }

    async fn serve<F>(responder: F) -> (String, Mock)
    where
        F: Fn(&CapturedRequest) -> (StatusCode, Value) + Send + Sync + 'static,
    {
        let mock = Mock {
            requests: Arc::new(Mutex::new(Vec::new())),
            responder: Arc::new(responder),
        };
        let app = Router::new()
            .fallback(axum::routing::any(handle))
            .with_state(mock.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{address}"), mock)
    }

    fn query(request: &CapturedRequest, key: &str) -> Option<String> {
        form_urlencoded::parse(request.query.as_bytes())
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.into_owned())
    }

    fn test_service(origin: &str) -> BangumiTracker {
        let db = Database::open_in_memory(false).unwrap();
        Migrator::new(&komga_db::kmrs_migrations(), Placeholders::default())
            .migrate(&db.rw().unwrap())
            .unwrap();
        let dao = TrackerOAuthDao::new(db.clone());
        dao.upsert_token(
            "bangumi",
            "alice",
            &TrackerOAuthToken {
                access_token: "stale".into(),
                refresh_token: Some("refresh-old".into()),
                token_type: Some("Bearer".into()),
                expires_at: None,
                username: Some("alice-bg".into()),
            },
        )
        .unwrap();
        let mut app = OAuthApp::for_provider(Provider::Bangumi);
        app.client_id = Some("test-id".into());
        app.client_secret = Some("test-secret".into());
        app.token_url = format!("{origin}/token");
        let manager = OAuthManager::with_apps(
            db,
            reqwest::Client::new(),
            HashMap::from([(Provider::Bangumi, app)]),
        );
        BangumiTracker::with_api_origin(reqwest::Client::new(), manager, origin)
    }

    fn subject(id: i64, name: &str) -> Value {
        json!({
            "id": id,
            "name": name,
            "name_cn": "",
            "images": {"large": format!("https://img.test/{id}.jpg")},
            "summary": format!("Summary {id}"),
            "platform": "漫画"
        })
    }

    #[tokio::test]
    async fn v0_search_marks_tracked_across_collection_pages() {
        let first_page = (1..=100)
            .map(|id| json!({"subject_id": id}))
            .collect::<Vec<_>>();
        let (origin, mock) = serve(move |request| match request.path.as_str() {
            "/v0/me" => (StatusCode::OK, json!({"username": "alice-bg"})),
            "/v0/users/alice-bg/collections" => {
                if query(request, "offset").as_deref() == Some("100") {
                    (
                        StatusCode::OK,
                        json!({"data": [{"subject_id": 101}], "total": 101}),
                    )
                } else {
                    (StatusCode::OK, json!({"data": first_page, "total": 101}))
                }
            }
            "/v0/search/subjects" => (StatusCode::OK, json!({"data": [subject(101, "Book")]})),
            _ => (StatusCode::NOT_FOUND, json!({"message": "unexpected"})),
        })
        .await;
        let service = test_service(&origin);
        assert_eq!(service.provider(), Provider::Bangumi);
        assert!(service.is_logged_in("alice").unwrap());

        let results = service.search("alice", "Book", false).await.unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].tracked);
        assert_eq!(results[0].media_type, Some(TrackMediaType::Manga));
        let requests = mock.requests();
        let search = requests
            .iter()
            .find(|request| request.path == "/v0/search/subjects")
            .unwrap();
        assert_eq!(search.method, Method::POST);
        assert_eq!(search.authorization.as_deref(), Some("Bearer stale"));
        assert_eq!(
            search.json,
            Some(json!({
                "keyword": "Book",
                "sort": "match",
                "filter": {"type": [1], "nsfw": false}
            }))
        );
        let collections = requests
            .iter()
            .filter(|request| request.path == "/v0/users/alice-bg/collections")
            .collect::<Vec<_>>();
        assert_eq!(collections.len(), 2);
        assert_eq!(query(collections[0], "offset").as_deref(), Some("0"));
        assert_eq!(query(collections[1], "offset").as_deref(), Some("100"));
        assert!(requests
            .iter()
            .all(|request| !request.path.starts_with("/search/subject/")));
    }

    #[tokio::test]
    async fn failed_v0_search_returns_error_without_legacy_request() {
        let (origin, mock) = serve(|request| match request.path.as_str() {
            "/v0/me" => (StatusCode::OK, json!({"username": "alice-bg"})),
            "/v0/users/alice-bg/collections" => (
                StatusCode::OK,
                json!({"data": [{"subject_id": 7}], "total": 1}),
            ),
            "/v0/search/subjects" => (
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({"message": "v0 unavailable"}),
            ),
            path if path.starts_with("/search/subject/") => {
                (StatusCode::OK, json!({"list": [subject(7, "Legacy")]}))
            }
            _ => (StatusCode::NOT_FOUND, json!({"message": "unexpected"})),
        })
        .await;
        let service = test_service(&origin);

        assert!(matches!(
            service.search("alice", "标题 / A", true).await,
            Err(TrackerError::Provider {
                provider: Provider::Bangumi,
                ..
            })
        ));
        let requests = mock.requests();
        assert!(!requests
            .iter()
            .any(|request| request.path.starts_with("/search/subject/")));
        let v0 = requests
            .iter()
            .find(|request| request.path == "/v0/search/subjects")
            .unwrap();
        assert_eq!(v0.json.as_ref().unwrap()["filter"]["nsfw"], true);
    }

    #[tokio::test]
    async fn search_propagates_collection_list_failure() {
        let (origin, mock) = serve(|request| match request.path.as_str() {
            "/v0/me" => (StatusCode::OK, json!({"username": "alice-bg"})),
            "/v0/users/alice-bg/collections" => (
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({"message": "collections unavailable"}),
            ),
            "/v0/search/subjects" => (StatusCode::OK, json!({"data": [subject(7, "Book")]})),
            _ => (StatusCode::NOT_FOUND, json!({"message": "unexpected"})),
        })
        .await;
        let service = test_service(&origin);

        assert!(matches!(
            service.search("alice", "Book", false).await,
            Err(TrackerError::Provider {
                provider: Provider::Bangumi,
                ..
            })
        ));
        assert!(!mock
            .requests()
            .iter()
            .any(|request| request.path == "/v0/search/subjects"));
    }

    async fn state_with_subject_detail_failure(
        collection_status: StatusCode,
        collection: Value,
    ) -> Result<RemoteState, TrackerError> {
        let (origin, _) = serve(move |request| match request.path.as_str() {
            "/v0/me" => (StatusCode::OK, json!({"username": "alice-bg"})),
            "/v0/users/alice-bg/collections/42" => (collection_status, collection.clone()),
            "/v0/subjects/42" => (
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({"message": "subject unavailable"}),
            ),
            _ => (StatusCode::NOT_FOUND, json!({"message": "unexpected"})),
        })
        .await;
        test_service(&origin).get_state("alice", "42").await
    }

    #[tokio::test]
    async fn uncollected_state_propagates_subject_detail_failure() {
        assert!(matches!(
            state_with_subject_detail_failure(StatusCode::NOT_FOUND, json!({})).await,
            Err(TrackerError::Provider {
                provider: Provider::Bangumi,
                ..
            })
        ));
    }

    #[tokio::test]
    async fn missing_collection_type_state_propagates_subject_detail_failure() {
        assert!(matches!(
            state_with_subject_detail_failure(StatusCode::OK, json!({})).await,
            Err(TrackerError::Provider {
                provider: Provider::Bangumi,
                ..
            })
        ));
    }

    #[tokio::test]
    async fn collected_state_propagates_subject_detail_failure() {
        assert!(matches!(
            state_with_subject_detail_failure(
                StatusCode::OK,
                json!({"type": 3, "rate": 8, "ep_status": 12, "vol_status": 2}),
            )
            .await,
            Err(TrackerError::Provider {
                provider: Provider::Bangumi,
                ..
            })
        ));
    }

    #[tokio::test]
    async fn state_preserves_totals_for_uncollected_and_missing_type() {
        let (origin, mock) = serve(|request| match request.path.as_str() {
            "/v0/me" => (StatusCode::OK, json!({"username": "alice-bg"})),
            "/v0/users/alice-bg/collections/42" => (
                StatusCode::OK,
                json!({"type": 3, "rate": 8, "ep_status": 12, "vol_status": 2}),
            ),
            "/v0/subjects/42" => (
                StatusCode::OK,
                json!({"id": 42, "name": "Book", "eps": 30, "volumes": 6}),
            ),
            "/v0/subjects/43" => (
                StatusCode::OK,
                json!({"id": 43, "name": "Book 43", "eps": 30, "volumes": 6}),
            ),
            "/v0/subjects/44" => (
                StatusCode::OK,
                json!({"id": 44, "name": "Book 44", "eps": 40, "volumes": 8}),
            ),
            "/v0/users/alice-bg/collections/43" => (
                StatusCode::NOT_FOUND,
                json!({"message": "subject is not collected"}),
            ),
            "/v0/users/alice-bg/collections/44" => (StatusCode::OK, json!({})),
            _ => (StatusCode::NOT_FOUND, json!({"message": "unexpected"})),
        })
        .await;
        let service = test_service(&origin);

        let state = service.get_state("alice", "42").await.unwrap();
        assert_eq!(state.score, Some(8));
        assert_eq!(state.status, Some(TrackStatus::Reading));
        assert_eq!(state.last_read_chapter, Some(12.0));
        assert_eq!(state.last_read_volume, Some(2));
        assert_eq!(state.total_chapters, Some(30));
        assert_eq!(state.total_volumes, Some(6));
        assert_eq!(state.start_read_date, None);
        assert_eq!(state.finish_read_date, None);

        let uncollected = service.get_state("alice", "43").await.unwrap();
        assert_eq!(uncollected.total_chapters, Some(30));
        assert_eq!(uncollected.total_volumes, Some(6));
        assert_eq!(uncollected.status, None);
        let books = [BookTrackInput {
            name: "ch.30",
            number_sort: 30.0,
            read: true,
        }];
        let update = komga_core::tracker::decide(
            TrackMode::Chapter,
            0,
            &uncollected,
            &books,
            time::Date::from_calendar_date(2026, time::Month::October, 25).unwrap(),
        )
        .unwrap();
        assert_eq!(update.status, Some(TrackStatus::Completed));

        let missing_type = service.get_state("alice", "44").await.unwrap();
        assert_eq!(missing_type.total_chapters, Some(40));
        assert_eq!(missing_type.total_volumes, Some(8));
        assert!(mock
            .requests()
            .iter()
            .any(|request| request.path == "/v0/subjects/43"));
    }

    #[tokio::test]
    async fn final_unauthorized_logs_out() {
        let (origin, _) = serve(|request| match request.path.as_str() {
            "/token" => (
                StatusCode::OK,
                json!({"access_token": "fresh", "expires_in": 3600}),
            ),
            _ => (StatusCode::UNAUTHORIZED, json!({"message": "expired"})),
        })
        .await;
        let service = test_service(&origin);
        let update = TrackUpdate {
            last_read_chapter: Some(1.0),
            ..TrackUpdate::default()
        };
        assert!(matches!(
            service.update("alice", "42", &update).await,
            Err(TrackerError::NotLoggedIn { .. })
        ));
        assert!(
            !service
                .oauth
                .status(Provider::Bangumi, "alice")
                .unwrap()
                .logged_in
        );
    }

    #[tokio::test]
    async fn update_ignores_dates_downgrades_rereading_and_refreshes_once() {
        let (origin, mock) = serve(|request| match request.path.as_str() {
            "/token" => (
                StatusCode::OK,
                json!({"access_token": "fresh", "refresh_token": "refresh-new", "expires_in": 3600}),
            ),
            "/v0/users/-/collections/42" if request.authorization.as_deref() == Some("Bearer stale") => {
                (StatusCode::UNAUTHORIZED, json!({"message": "expired"}))
            }
            "/v0/users/-/collections/42" => (StatusCode::NO_CONTENT, Value::Null),
            _ => (StatusCode::NOT_FOUND, json!({"message": "unexpected"})),
        })
        .await;
        let service = test_service(&origin);
        let update = TrackUpdate {
            score: Some(8),
            status: Some(TrackStatus::Rereading),
            last_read_chapter: Some(12.9),
            last_read_volume: Some(3),
            start_read_date: Some("2026-10-01".into()),
            finish_read_date: Some("2026-10-20".into()),
        };

        service.update("alice", "42", &update).await.unwrap();
        let requests = mock.requests();
        let updates = requests
            .iter()
            .filter(|request| request.path == "/v0/users/-/collections/42")
            .collect::<Vec<_>>();
        assert_eq!(updates.len(), 2);
        assert_eq!(updates[0].authorization.as_deref(), Some("Bearer stale"));
        assert_eq!(updates[1].authorization.as_deref(), Some("Bearer fresh"));
        for request in updates {
            assert_eq!(request.method, Method::POST);
            assert_eq!(
                request.json,
                Some(json!({"type": 3, "rate": 8, "ep_status": 12, "vol_status": 3}))
            );
        }
        let token = requests
            .iter()
            .find(|request| request.path == "/token")
            .unwrap();
        assert_eq!(token.form["grant_type"], "refresh_token");
        assert_eq!(token.form["refresh_token"], "refresh-old");
    }

    #[tokio::test]
    async fn subject_url_uses_detail_and_official_result_url() {
        let (origin, _) = serve(|request| match request.path.as_str() {
            "/v0/me" => (StatusCode::OK, json!({"username": "alice-bg"})),
            "/v0/users/alice-bg/collections" => (StatusCode::OK, json!({"data": [], "total": 0})),
            "/v0/subjects/1902" => (StatusCode::OK, subject(1902, "Book")),
            _ => (StatusCode::NOT_FOUND, json!({"message": "unexpected"})),
        })
        .await;
        let service = test_service(&origin);

        let results = service
            .search("alice", "bgm.tv/subject/1902", false)
            .await
            .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "1902");
        assert_eq!(
            results[0].url.as_deref(),
            Some("https://bgm.tv/subject/1902")
        );
    }

    #[test]
    fn status_mapping_has_no_rereading_collection_type() {
        assert_eq!(collection_status(Some(1)), Some(TrackStatus::Planning));
        assert_eq!(collection_status(Some(2)), Some(TrackStatus::Completed));
        assert_eq!(collection_status(Some(3)), Some(TrackStatus::Reading));
        assert_eq!(collection_status(Some(4)), Some(TrackStatus::Paused));
        assert_eq!(collection_status(Some(5)), Some(TrackStatus::Dropped));
        assert_eq!(collection_type(TrackStatus::Rereading), 3);
    }
}
