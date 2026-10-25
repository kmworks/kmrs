pub mod anilist;
pub mod bangumi;
pub mod mal;
pub mod mangabaka;

pub fn parse_tracker_url(input: &str) -> Option<reqwest::Url> {
    let input = input.trim();
    reqwest::Url::parse(input)
        .or_else(|_| reqwest::Url::parse(&format!("https://{input}")))
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracker_urls_accept_missing_scheme() {
        assert_eq!(
            parse_tracker_url(" anilist.co/manga/42/Title ")
                .unwrap()
                .as_str(),
            "https://anilist.co/manga/42/Title"
        );
        assert_eq!(
            parse_tracker_url("https://myanimelist.net/manga/7")
                .unwrap()
                .host_str(),
            Some("myanimelist.net")
        );
    }
}

#[cfg(test)]
pub(super) mod test_support {
    use super::super::oauth::{OAuthApp, OAuthManager};
    use super::super::Provider;
    use axum::extract::Request;
    use axum::http::{HeaderMap, Method};
    use axum::Router;
    use komga_db::dao::tracker_oauth::{TrackerOAuthDao, TrackerOAuthToken};
    use komga_db::pool::Database;
    use komga_db::{Migrator, Placeholders};
    use std::collections::HashMap;
    use std::sync::Arc;

    #[derive(Debug, Clone)]
    pub(super) struct CapturedRequest {
        pub(super) method: Method,
        pub(super) path: String,
        query: Vec<(String, String)>,
        pub(super) authorization: Option<String>,
        pub(super) content_type: Option<String>,
        pub(super) body: Vec<u8>,
    }

    impl CapturedRequest {
        pub(super) fn query(&self, name: &str) -> Option<&str> {
            self.query
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.as_str())
        }

        pub(super) fn json(&self) -> serde_json::Value {
            serde_json::from_slice(&self.body).unwrap()
        }

        pub(super) fn form(&self) -> HashMap<String, String> {
            form_urlencoded::parse(&self.body).into_owned().collect()
        }
    }

    pub(super) async fn capture(request: Request) -> CapturedRequest {
        let (parts, body) = request.into_parts();
        let bytes = axum::body::to_bytes(body, 1024 * 1024).await.unwrap();
        CapturedRequest {
            method: parts.method,
            path: parts.uri.path().to_string(),
            query: form_urlencoded::parse(parts.uri.query().unwrap_or_default().as_bytes())
                .into_owned()
                .collect(),
            authorization: header(&parts.headers, reqwest::header::AUTHORIZATION),
            content_type: header(&parts.headers, reqwest::header::CONTENT_TYPE),
            body: bytes.to_vec(),
        }
    }

    fn header(headers: &HeaderMap, name: reqwest::header::HeaderName) -> Option<String> {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
    }

    pub(super) async fn serve(router: Router) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        format!("http://{address}")
    }

    pub(super) fn test_oauth(
        provider: Provider,
        base_url: &str,
    ) -> (Arc<OAuthManager>, TrackerOAuthDao) {
        let db = Database::open_in_memory(false).unwrap();
        Migrator::new(&komga_db::kmrs_migrations(), Placeholders::default())
            .migrate(&db.rw().unwrap())
            .unwrap();
        let dao = TrackerOAuthDao::new(db.clone());
        let mut app = OAuthApp::for_provider(provider);
        app.client_id = Some(format!("{}-test-id", provider.as_str()));
        app.client_secret = Some(format!("{}-test-secret", provider.as_str()));
        app.authorize_url = format!("{base_url}/authorize");
        app.token_url = format!("{base_url}/token");
        app.userinfo_url = format!("{base_url}/user");
        let apps = HashMap::from([(provider, app)]);
        let manager = OAuthManager::with_apps(db, reqwest::Client::new(), apps);
        (manager, dao)
    }

    pub(super) fn seed_token(dao: &TrackerOAuthDao, provider: Provider, user_id: &str) {
        dao.upsert_token(
            provider.as_str(),
            user_id,
            &TrackerOAuthToken {
                access_token: "old-token".into(),
                refresh_token: Some("refresh-old".into()),
                token_type: Some("Bearer".into()),
                expires_at: None,
                username: Some("test-user".into()),
            },
        )
        .unwrap();
    }
}
