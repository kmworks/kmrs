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

pub fn bracket_search_term(name: &str, author_separator: Option<&str>) -> Option<String> {
    if let Some(title) = bracket_groups(name, '《', '》')
        .into_iter()
        .map(str::trim)
        .find(|title| !title.is_empty())
    {
        return Some(title.to_string());
    }

    let groups = bracket_groups(name, '[', ']');
    if groups.len() < 2 {
        return None;
    }

    let outside = without_bracket_groups(name);
    let outside = outside.split_whitespace().collect::<Vec<_>>().join(" ");
    if !outside.is_empty() {
        return Some(outside);
    }

    let mut groups = groups.as_slice();
    while groups
        .first()
        .is_some_and(|group| is_media_type_keyword(group))
    {
        groups = &groups[1..];
    }
    let first = *groups.first()?;
    if author_separator.is_some_and(|separator| first.contains(separator)) {
        groups.get(1).map(|title| (*title).to_string())
    } else {
        Some(first.to_string())
    }
}

fn bracket_groups(input: &str, open: char, close: char) -> Vec<&str> {
    let mut groups = Vec::new();
    let mut start = None;
    for (index, character) in input.char_indices() {
        if character == open {
            if start.is_none() {
                start = Some(index + character.len_utf8());
            }
        } else if character == close {
            if let Some(content_start) = start.take() {
                groups.push(&input[content_start..index]);
            }
        }
    }
    groups
}

fn without_bracket_groups(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut characters = input.char_indices().peekable();
    while let Some((index, character)) = characters.next() {
        let close = match character {
            '(' => Some(')'),
            '<' => Some('>'),
            '[' => Some(']'),
            '（' => Some('）'),
            '【' => Some('】'),
            _ => None,
        };
        if let Some(close) = close {
            let content_start = index + character.len_utf8();
            if let Some(relative_end) = input[content_start..].find(close) {
                let group_end = content_start + relative_end + close.len_utf8();
                output.push(' ');
                while characters
                    .peek()
                    .is_some_and(|(next_index, _)| *next_index < group_end)
                {
                    characters.next();
                }
                continue;
            }
        }
        output.push(character);
    }
    output
}

fn is_media_type_keyword(value: &str) -> bool {
    const KEYWORDS: &[&str] = &[
        "comic",
        "comics",
        "novel",
        "novels",
        "manga",
        "mangas",
        "webtoon",
        "hentai",
        "漫画",
        "漫畫",
        "小说",
        "小說",
        "轻小说",
        "輕小說",
        "网文",
        "網文",
        "卡通",
        "条漫",
        "條漫",
        "画集",
        "畫集",
        "同人",
        "同人本",
        "同人志",
        "同人誌",
        "一般向",
        "成人向",
        "限制级",
        "限制級",
        "全年龄",
        "全年齡",
    ];
    let value = value.trim();
    KEYWORDS
        .iter()
        .any(|keyword| value.eq_ignore_ascii_case(keyword))
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

    #[test]
    fn bracket_cleanup_preserves_title_and_default_author_separator() {
        assert_eq!(
            bracket_search_term(
                "(画集)[chin] 女騎士が転生したら 全編 [中国翻訳] [DL版]",
                Some("×")
            )
            .as_deref(),
            Some("女騎士が転生したら 全編")
        );
        assert_eq!(
            bracket_search_term(
                "[逢沢大介×東西×坂野杏梨][想要成为影之实力者！][未完]",
                Some("×")
            )
            .as_deref(),
            Some("想要成为影之实力者！")
        );
        assert_eq!(
            bracket_search_term("[漫画][默示录的四骑士][鈴木央]", Some("×")).as_deref(),
            Some("默示录的四骑士")
        );
        assert_eq!(
            bracket_search_term("汉化组《正式标题》 [DL版] [123]", None).as_deref(),
            Some("正式标题")
        );
        assert_eq!(bracket_search_term("普通标题", Some("×")), None);
        assert_eq!(bracket_search_term("[只有一个]", Some("×")), None);
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
