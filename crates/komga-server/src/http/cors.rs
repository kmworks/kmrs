//! CORS, mirroring the Java `CorsConfiguration`: active only when
//! `cors.allowed-origins` is non-empty, credentials allowed, every HTTP method
//! enabled, request headers echoed back on preflight (what Spring's
//! `allowedHeaders=*` does under `allowCredentials=true`), and
//! `Content-Disposition` plus the session header exposed.
//!
//! The wildcard origin is rejected at config load: with credentials allowed it
//! can never work (browsers refuse `Access-Control-Allow-Origin: *` on
//! credentialed requests, and tower-http panics on that combination), so a
//! config that asks for it must fail loudly instead of silently allowing nothing.

use std::time::Duration;

use axum::http::header::CONTENT_DISPOSITION;
use axum::http::{HeaderName, HeaderValue, Method};
use tower_http::cors::{AllowHeaders, AllowMethods, AllowOrigin, CorsLayer};

use crate::auth::SESSION_HEADER_NAME;

pub fn validate_origins(origins: &[String]) -> anyhow::Result<()> {
    for origin in origins {
        anyhow::ensure!(
            origin != "*",
            "cors.allowed-origins: the wildcard '*' cannot be combined with credentialed requests; list origins explicitly"
        );
        anyhow::ensure!(
            !origin.is_empty() && HeaderValue::from_str(origin).is_ok(),
            "cors.allowed-origins: {origin:?} is not a valid origin"
        );
    }
    Ok(())
}

pub fn layer(origins: &[String]) -> Option<CorsLayer> {
    if origins.is_empty() {
        return None;
    }
    let allowed = origins
        .iter()
        // a trailing slash never matches the Origin header; Spring trims it too
        .map(|origin| origin.strip_suffix('/').unwrap_or(origin))
        .map(|origin| HeaderValue::from_str(origin).expect("origins are validated at config load"))
        .collect::<Vec<_>>();
    Some(
        CorsLayer::new()
            .allow_origin(AllowOrigin::list(allowed))
            .allow_methods(AllowMethods::list([
                Method::GET,
                Method::HEAD,
                Method::POST,
                Method::PUT,
                Method::PATCH,
                Method::DELETE,
                Method::OPTIONS,
                Method::TRACE,
            ]))
            .allow_headers(AllowHeaders::mirror_request())
            .allow_credentials(true)
            .expose_headers([
                CONTENT_DISPOSITION,
                HeaderName::from_bytes(SESSION_HEADER_NAME.as_bytes())
                    .expect("SESSION_HEADER_NAME is a valid header name"),
            ])
            .max_age(Duration::from_secs(1800)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{header, Request, StatusCode};
    use tower::ServiceExt;

    fn app(origins: &[&str]) -> axum::Router {
        let origins = origins.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        axum::Router::new()
            .route("/api/v1/data", axum::routing::get(|| async { "ok" }))
            .layer(layer(&origins).unwrap())
    }

    fn preflight(origin: &str) -> Request<Body> {
        Request::options("/api/v1/data")
            .header(header::ORIGIN, origin)
            .header(header::ACCESS_CONTROL_REQUEST_METHOD, "PUT")
            .header(
                header::ACCESS_CONTROL_REQUEST_HEADERS,
                "x-custom, content-type",
            )
            .body(Body::empty())
            .unwrap()
    }

    #[tokio::test]
    async fn preflight_allows_configured_origin() {
        let response = app(&["https://a.example"])
            .oneshot(preflight("https://a.example"))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let headers = response.headers();
        assert_eq!(
            headers[header::ACCESS_CONTROL_ALLOW_ORIGIN],
            "https://a.example"
        );
        assert_eq!(headers[header::ACCESS_CONTROL_ALLOW_CREDENTIALS], "true");
        assert_eq!(
            headers[header::ACCESS_CONTROL_ALLOW_HEADERS],
            "x-custom, content-type"
        );
        assert_eq!(headers[header::ACCESS_CONTROL_MAX_AGE], "1800");
        let methods = headers[header::ACCESS_CONTROL_ALLOW_METHODS]
            .to_str()
            .unwrap()
            .to_string();
        for method in [
            "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE",
        ] {
            assert!(methods.contains(method), "{method} missing from {methods}");
        }
    }

    #[tokio::test]
    async fn preflight_ignores_unlisted_origin() {
        let response = app(&["https://a.example"])
            .oneshot(preflight("https://evil.example"))
            .await
            .unwrap();
        assert!(!response
            .headers()
            .contains_key(header::ACCESS_CONTROL_ALLOW_ORIGIN));
    }

    #[tokio::test]
    async fn trailing_slash_origin_still_matches() {
        let response = app(&["https://a.example/"])
            .oneshot(preflight("https://a.example"))
            .await
            .unwrap();
        assert_eq!(
            response.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN],
            "https://a.example"
        );
    }

    #[tokio::test]
    async fn actual_request_exposes_session_and_disposition_headers() {
        let response = app(&["https://a.example"])
            .oneshot(
                Request::get("/api/v1/data")
                    .header(header::ORIGIN, "https://a.example")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let headers = response.headers();
        assert_eq!(
            headers[header::ACCESS_CONTROL_ALLOW_ORIGIN],
            "https://a.example"
        );
        assert_eq!(headers[header::ACCESS_CONTROL_ALLOW_CREDENTIALS], "true");
        let exposed = headers[header::ACCESS_CONTROL_EXPOSE_HEADERS]
            .to_str()
            .unwrap()
            .to_string();
        assert!(exposed.contains("content-disposition"), "{exposed}");
        assert!(exposed.contains("x-auth-token"), "{exposed}");
    }

    #[tokio::test]
    async fn request_without_origin_gets_no_cors_headers() {
        let response = app(&["https://a.example"])
            .oneshot(Request::get("/api/v1/data").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert!(!response
            .headers()
            .contains_key(header::ACCESS_CONTROL_ALLOW_ORIGIN));
    }

    #[test]
    fn empty_origins_disable_the_layer() {
        assert!(layer(&[]).is_none());
    }

    #[test]
    fn wildcard_origin_is_rejected() {
        assert!(validate_origins(&["*".to_string()]).is_err());
        assert!(validate_origins(&["https://a.example".to_string(), "*".to_string()]).is_err());
    }

    #[test]
    fn invalid_origin_is_rejected() {
        assert!(validate_origins(&["https://a.example".to_string()]).is_ok());
        assert!(validate_origins(&[String::new()]).is_err());
        assert!(validate_origins(&["bad\norigin".to_string()]).is_err());
    }
}
