//! Framework-level handling Spring Security never had on the Rust side: a 401 with
//! `WWW-Authenticate: Basic` makes browsers pause the request and pop their native
//! sign-in dialog, hijacking the SPA's own login flow. The komga web UI tags every
//! API call with `X-Requested-With: XMLHttpRequest`, so those 401s go out bare,
//! with neither the challenge nor the Spring error body; everything else (OPDS
//! readers, API clients, browser navigations) keeps both, same as the Java version.

use axum::body::Body;
use axum::extract::Request;
use axum::http::header;
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;

use crate::error::BasicChallenge;

pub async fn strip_challenge_for_xhr(request: Request, next: Next) -> Response {
    let xhr = request
        .headers()
        .get("x-requested-with")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.eq_ignore_ascii_case("XMLHttpRequest"));
    let mut response = next.run(request).await;
    if xhr && response.status() == StatusCode::UNAUTHORIZED {
        response.headers_mut().remove(header::WWW_AUTHENTICATE);
        if response.extensions().get::<BasicChallenge>().is_some() {
            response.headers_mut().remove(header::CONTENT_TYPE);
            response.headers_mut().remove(header::CONTENT_LENGTH);
            *response.body_mut() = Body::empty();
        }
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::header::WWW_AUTHENTICATE;
    use axum::routing;
    use tower::ServiceExt;

    fn app() -> axum::Router {
        axum::Router::new()
            .route(
                "/x",
                routing::get(|| async {
                    (
                        StatusCode::UNAUTHORIZED,
                        [(WWW_AUTHENTICATE, "Basic realm=\"Realm\"")],
                    )
                }),
            )
            .layer(axum::middleware::from_fn(strip_challenge_for_xhr))
    }

    async fn www_authenticate(app: &axum::Router, xhr: bool) -> Option<String> {
        let mut request = Request::builder().uri("/x");
        if xhr {
            request = request.header("x-requested-with", "XMLHttpRequest");
        }
        let response = app
            .clone()
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        response
            .headers()
            .get(WWW_AUTHENTICATE)
            .map(|v| v.to_str().unwrap().to_string())
    }

    #[tokio::test]
    async fn strips_challenge_for_xhr_keeps_for_others() {
        let app = app();
        assert_eq!(www_authenticate(&app, true).await, None);
        assert_eq!(
            www_authenticate(&app, false).await.as_deref(),
            Some("Basic realm=\"Realm\"")
        );
    }

    #[tokio::test]
    async fn xhr_keeps_the_body_of_a_401_not_from_the_basic_entry_point() {
        let app = axum::Router::new()
            .route(
                "/x",
                routing::get(|| async {
                    (
                        StatusCode::UNAUTHORIZED,
                        [(WWW_AUTHENTICATE, "Basic realm=\"Realm\"")],
                        "document",
                    )
                }),
            )
            .layer(axum::middleware::from_fn(strip_challenge_for_xhr));
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/x")
                    .header("x-requested-with", "XMLHttpRequest")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(&bytes[..], b"document");
    }
}
