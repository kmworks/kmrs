//! Login/logout:
//! - `GET /api/v1/login/set-cookie`: materializes the X-Auth-Token session into a cookie (204).
//! - `GET|POST /api/logout`: clears the session and remember-me cookies and invalidates the
//!   session (204).

use crate::auth::remember_me::REMEMBER_ME_COOKIE;
use crate::auth::{MaybeAuth, RequireAuth, SESSION_HEADER_NAME};
use crate::http::base_url::request_is_secure;
use crate::state::AppState;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{AppendHeaders, IntoResponse, Response};
use axum::{routing, Router};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/login/set-cookie", routing::get(set_cookie))
        .route("/api/logout", routing::get(logout).post(logout))
}

async fn set_cookie(
    State(state): State<AppState>,
    _auth: RequireAuth,
    headers: HeaderMap,
) -> Response {
    match headers
        .get(SESSION_HEADER_NAME)
        .and_then(|v| v.to_str().ok())
    {
        Some(session_id) => (
            StatusCode::NO_CONTENT,
            [(
                axum::http::header::SET_COOKIE,
                state
                    .config
                    .session_cookie
                    .set_cookie(session_id, request_is_secure(&headers)),
            )],
        )
            .into_response(),
        None => StatusCode::NO_CONTENT.into_response(),
    }
}

async fn logout(State(state): State<AppState>, auth: MaybeAuth, headers: HeaderMap) -> Response {
    let session_cookie = &state.config.session_cookie;
    let session_id = headers
        .get(SESSION_HEADER_NAME)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .or_else(|| {
            headers
                .get(axum::http::header::COOKIE)
                .and_then(|v| v.to_str().ok())
                .and_then(|header| {
                    header
                        .split(';')
                        .filter_map(|pair| {
                            let pair = pair.trim();
                            pair.split_once('=')
                                .filter(|(k, _)| *k == session_cookie.name)
                                .map(|(_, v)| v.to_string())
                        })
                        .next()
                })
        });
    if let Some(id) = session_id {
        // the client discards the cookie either way; a failed delete is left to the
        // hourly cleanup rather than failing the logout
        if let Err(e) = state.sessions.invalidate(&id) {
            tracing::warn!("failed to delete session on logout: {e}");
        }
    }
    let _ = auth;
    // the remember-me cookie is HttpOnly, so only the server can drop it; left in
    // place, it would log the browser straight back in on the next request
    (
        StatusCode::NO_CONTENT,
        AppendHeaders([
            (
                axum::http::header::SET_COOKIE,
                session_cookie.clear_cookie(request_is_secure(&headers)),
            ),
            (
                axum::http::header::SET_COOKIE,
                format!("{REMEMBER_ME_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"),
            ),
        ]),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::collections::tests::{call, insert_user, test_state};
    use crate::auth::SESSION_COOKIE_NAME;
    use axum::body::Body;
    use axum::http::Request;

    #[tokio::test]
    async fn set_cookie_requires_auth_and_echoes_session() {
        let state = test_state();
        insert_user(&state.db, "u@b.c", &[], &[], Default::default(), "k");

        let (status, _, _) = call(
            &state,
            router(),
            Request::get("/api/v1/login/set-cookie")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);

        let (status, headers, _) = call(
            &state,
            router(),
            Request::get("/api/v1/login/set-cookie")
                .header("X-API-Key", "k")
                .header(SESSION_HEADER_NAME, "session-1")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        let cookie = headers[axum::http::header::SET_COOKIE].to_str().unwrap();
        assert!(
            cookie.contains(&format!("{SESSION_COOKIE_NAME}=session-1")),
            "{cookie}"
        );
        // same cookie the session filter would write: max-age + expires like the serializer
        assert!(cookie.contains("; Max-Age="), "{cookie}");
        assert!(cookie.contains("; Expires="), "{cookie}");
    }

    #[tokio::test]
    async fn session_cookie_name_is_configurable() {
        let state = test_state();
        let config = std::sync::Arc::new(crate::config::ServerConfig {
            session_cookie: crate::config::SessionCookieConfig {
                name: "MY-SESSION".to_string(),
                ..Default::default()
            },
            ..(*state.config).clone()
        });
        let state = AppState { config, ..state };
        insert_user(&state.db, "u@b.c", &[], &[], Default::default(), "k");

        // set-cookie writes the configured name
        let (status, headers, _) = call(
            &state,
            router(),
            Request::get("/api/v1/login/set-cookie")
                .header("X-API-Key", "k")
                .header(SESSION_HEADER_NAME, "session-1")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        let cookie = headers[axum::http::header::SET_COOKIE].to_str().unwrap();
        assert!(cookie.starts_with("MY-SESSION=session-1;"), "{cookie}");

        // logout reads and clears the configured name
        let (status, headers, _) = call(
            &state,
            router(),
            Request::post("/api/logout")
                .header(axum::http::header::COOKIE, "MY-SESSION=session-1")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        let cleared = headers
            .get_all(axum::http::header::SET_COOKIE)
            .iter()
            .any(|v| {
                let c = v.to_str().unwrap();
                c.starts_with("MY-SESSION=;") && c.contains("Max-Age=0")
            });
        assert!(cleared, "{headers:?}");
    }

    #[tokio::test]
    async fn logout_clears_session_and_remember_me_cookies() {
        let state = test_state();
        let (status, headers, _) = call(
            &state,
            router(),
            Request::post("/api/logout").body(Body::empty()).unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        let cookies: Vec<&str> = headers
            .get_all(axum::http::header::SET_COOKIE)
            .iter()
            .map(|v| v.to_str().unwrap())
            .collect();
        for name in [SESSION_COOKIE_NAME, REMEMBER_ME_COOKIE] {
            assert!(
                cookies
                    .iter()
                    .any(|c| c.starts_with(&format!("{name}=;")) && c.contains("Max-Age=0")),
                "{name} not cleared: {cookies:?}"
            );
        }
    }
}
