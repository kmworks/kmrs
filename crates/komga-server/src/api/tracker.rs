use crate::auth::RequireAuth;
use crate::dto::tracker::{
    TrackerLinkDto, TrackerLinkUpsertDto, TrackerPreferencesDto, TrackerUpdateRequestDto,
};
use crate::error::{ApiError, Violation};
use crate::service::tracker::oauth::OAuthStatus;
use crate::service::tracker::providers::bracket_search_term;
use crate::service::tracker::{Provider, TrackerError, TrackerService};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Redirect;
use axum::{routing, Json, Router};
use komga_core::tracker::{RemoteState, TrackLedgerItem, TrackMode, TrackSearchItem};
use komga_db::dao::tracker_ledger::TrackerLedgerDao;
use komga_db::dao::tracker_link::{NewTrackerLink, TrackerLinkDao};
use komga_db::dao::tracker_preferences::TrackerPreferencesDao;
use serde::Deserialize;
use std::sync::Arc;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/trackers/links",
            routing::get(list_all_tracker_links),
        )
        .route(
            "/api/v1/trackers/links/{seriesId}",
            routing::get(list_tracker_links).put(put_tracker_link),
        )
        .route(
            "/api/v1/trackers/links/{seriesId}/{provider}",
            routing::delete(delete_tracker_link),
        )
        .route(
            "/api/v1/trackers/preferences",
            routing::get(get_tracker_preferences).put(put_tracker_preferences),
        )
        .route("/api/v1/trackers/ledger", routing::get(tracker_ledger))
        .route(
            "/api/v1/trackers/{provider}/search",
            routing::get(tracker_search),
        )
        .route(
            "/api/v1/trackers/{provider}/state",
            routing::get(tracker_state),
        )
        .route(
            "/api/v1/trackers/{provider}/update",
            routing::post(tracker_update),
        )
        .route(
            "/api/v1/trackers/oauth/{provider}/start",
            routing::get(tracker_oauth_start),
        )
        .route(
            "/api/v1/trackers/oauth/{provider}/status",
            routing::get(tracker_oauth_status),
        )
        .route(
            "/api/v1/trackers/oauth/{provider}/logout",
            routing::post(tracker_oauth_logout),
        )
        .route(
            "/api/v1/trackers/oauth/{provider}/callback",
            routing::get(tracker_oauth_callback),
        )
}

fn parse_provider(name: &str) -> Result<Provider, ApiError> {
    Provider::parse(name)
        .ok_or_else(|| ApiError::not_found(format!("Tracker provider '{name}' is not supported")))
}

fn check_tracker_provider(provider: &str) -> Result<(), ApiError> {
    parse_provider(provider).map(|_| ())
}

fn tracker_for(state: &AppState, provider: Provider) -> Result<Arc<dyn TrackerService>, ApiError> {
    state.tracker.get(provider).ok_or_else(|| {
        ApiError::not_found(format!("Tracker provider '{provider}' is not supported"))
    })
}

fn tracker_error(error: TrackerError) -> ApiError {
    match error {
        TrackerError::NotLoggedIn { .. } => ApiError::Status {
            status: StatusCode::UNAUTHORIZED,
            message: error.to_string(),
        },
        TrackerError::InvalidState | TrackerError::PendingExpired => {
            ApiError::bad_request(error.to_string())
        }
        TrackerError::Database(error) => error.into(),
        other => ApiError::Internal(other.to_string()),
    }
}

fn require_login(
    service: &Arc<dyn TrackerService>,
    provider: Provider,
    user_id: &str,
) -> Result<(), ApiError> {
    if service.is_logged_in(user_id).map_err(tracker_error)? {
        Ok(())
    } else {
        Err(tracker_error(TrackerError::NotLoggedIn { provider }))
    }
}

async fn list_all_tracker_links(
    State(state): State<AppState>,
    auth: RequireAuth,
) -> Result<Json<Vec<TrackerLinkDto>>, ApiError> {
    let links = TrackerLinkDao::new(state.kmrs_db.clone()).list_by_user(&auth.0.user.id)?;
    Ok(Json(links.into_iter().map(TrackerLinkDto::from).collect()))
}

async fn list_tracker_links(
    State(state): State<AppState>,
    auth: RequireAuth,
    Path(series_id): Path<String>,
) -> Result<Json<Vec<TrackerLinkDto>>, ApiError> {
    let links = TrackerLinkDao::new(state.kmrs_db.clone())
        .list_by_series_and_user(&series_id, &auth.0.user.id)?;
    Ok(Json(links.into_iter().map(TrackerLinkDto::from).collect()))
}

async fn put_tracker_link(
    State(state): State<AppState>,
    auth: RequireAuth,
    Path(series_id): Path<String>,
    Json(body): Json<TrackerLinkUpsertDto>,
) -> Result<Json<TrackerLinkDto>, ApiError> {
    check_tracker_provider(&body.provider)?;
    let track_id = body.track_id.trim();
    if track_id.is_empty() {
        return Err(ApiError::Violations(vec![Violation {
            field_name: "trackId".into(),
            message: "must not be blank".into(),
        }]));
    }
    let track_mode = match body.track_mode.as_deref() {
        None | Some("auto") => TrackMode::Auto,
        Some("chapter") => TrackMode::Chapter,
        Some("volume") => TrackMode::Volume,
        Some(other) => {
            return Err(ApiError::Violations(vec![Violation {
                field_name: "trackMode".into(),
                message: format!("'{other}' is not a valid track mode"),
            }]))
        }
    };
    let chapter_offset = body.chapter_offset.unwrap_or(0);
    if !(-10000..=10000).contains(&chapter_offset) {
        return Err(ApiError::Violations(vec![Violation {
            field_name: "chapterOffset".into(),
            message: "must be between -10000 and 10000".into(),
        }]));
    }
    let dao = TrackerLinkDao::new(state.kmrs_db.clone());
    dao.upsert(&NewTrackerLink {
        series_id: &series_id,
        user_id: &auth.0.user.id,
        provider: &body.provider,
        track_id,
        title: body
            .title
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty()),
        track_mode,
        chapter_offset,
    })?;
    let links = dao.list_by_series_and_user(&series_id, &auth.0.user.id)?;
    let link = links
        .into_iter()
        .find(|l| l.provider == body.provider)
        .expect("upserted binding is readable");
    Ok(Json(TrackerLinkDto::from(link)))
}

async fn delete_tracker_link(
    State(state): State<AppState>,
    auth: RequireAuth,
    Path((series_id, provider)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    check_tracker_provider(&provider)?;
    TrackerLinkDao::new(state.kmrs_db.clone()).delete(&series_id, &auth.0.user.id, &provider)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_tracker_preferences(
    State(state): State<AppState>,
    auth: RequireAuth,
) -> Result<Json<TrackerPreferencesDto>, ApiError> {
    let prefs = TrackerPreferencesDao::new(state.kmrs_db.clone()).get(&auth.0.user.id)?;
    Ok(Json(TrackerPreferencesDto {
        libraries: prefs.libraries,
        default_tracker: prefs.default_tracker,
    }))
}

async fn put_tracker_preferences(
    State(state): State<AppState>,
    auth: RequireAuth,
    Json(body): Json<TrackerPreferencesDto>,
) -> Result<Json<TrackerPreferencesDto>, ApiError> {
    let default_tracker = body
        .default_tracker
        .as_deref()
        .filter(|d| !d.is_empty())
        .map(str::to_string);
    if let Some(default) = default_tracker.as_deref() {
        if Provider::parse(default).is_none() {
            return Err(ApiError::Violations(vec![Violation {
                field_name: "defaultTracker".into(),
                message: format!("'{default}' is not a supported tracker"),
            }]));
        }
    }
    let dao = TrackerPreferencesDao::new(state.kmrs_db.clone());
    dao.set(
        &auth.0.user.id,
        &komga_db::dao::tracker_preferences::TrackerPreferences {
            libraries: body.libraries.clone(),
            default_tracker,
        },
    )?;
    let prefs = dao.get(&auth.0.user.id)?;
    Ok(Json(TrackerPreferencesDto {
        libraries: prefs.libraries,
        default_tracker: prefs.default_tracker,
    }))
}

async fn tracker_ledger(
    State(state): State<AppState>,
    auth: RequireAuth,
) -> Result<Json<Vec<TrackLedgerItem>>, ApiError> {
    let items = TrackerLedgerDao::new(state.kmrs_db.clone()).list_by_user(&auth.0.user.id)?;
    Ok(Json(items))
}

#[derive(Debug, Deserialize)]
struct SearchQuery {
    name: String,
    nsfw: Option<bool>,
}

async fn tracker_search(
    State(state): State<AppState>,
    auth: RequireAuth,
    Path(provider): Path<String>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Vec<TrackSearchItem>>, ApiError> {
    let provider = parse_provider(&provider)?;
    let service = tracker_for(&state, provider)?;
    require_login(&service, provider, &auth.0.user.id)?;
    let name = bracket_search_term(&query.name, Some("×")).unwrap_or(query.name);
    let results = service
        .search(&auth.0.user.id, &name, query.nsfw.unwrap_or(true))
        .await
        .map_err(tracker_error)?;
    Ok(Json(results))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StateQuery {
    track_id: String,
}

async fn tracker_state(
    State(state): State<AppState>,
    auth: RequireAuth,
    Path(provider): Path<String>,
    Query(query): Query<StateQuery>,
) -> Result<Json<RemoteState>, ApiError> {
    let provider = parse_provider(&provider)?;
    let service = tracker_for(&state, provider)?;
    require_login(&service, provider, &auth.0.user.id)?;
    let remote = service
        .get_state(&auth.0.user.id, &query.track_id)
        .await
        .map_err(tracker_error)?;
    Ok(Json(remote))
}

async fn tracker_update(
    State(state): State<AppState>,
    auth: RequireAuth,
    Path(provider): Path<String>,
    Json(body): Json<TrackerUpdateRequestDto>,
) -> Result<StatusCode, ApiError> {
    let provider = parse_provider(&provider)?;
    let service = tracker_for(&state, provider)?;
    require_login(&service, provider, &auth.0.user.id)?;
    service
        .update(&auth.0.user.id, &body.track_id, &body.update)
        .await
        .map_err(tracker_error)?;
    TrackerLedgerDao::new(state.kmrs_db.clone()).upsert(
        provider.as_str(),
        &auth.0.user.id,
        &body.track_id,
        body.update.title.as_deref(),
        tracker_entry_url(provider, &body.track_id).as_deref(),
        body.update.cover_url.as_deref(),
    )?;
    Ok(StatusCode::NO_CONTENT)
}

fn tracker_entry_url(provider: Provider, track_id: &str) -> Option<String> {
    match provider {
        Provider::Anilist => Some(format!("https://anilist.co/manga/{track_id}")),
        Provider::Mal => Some(format!("https://myanimelist.net/manga/{track_id}")),
        Provider::Bangumi => Some(format!("https://bgm.tv/subject/{track_id}")),
        Provider::Mangabaka => Some(format!("https://mangabaka.org/{track_id}")),
    }
}

async fn tracker_oauth_start(
    State(state): State<AppState>,
    auth: RequireAuth,
    Path(provider): Path<String>,
    headers: HeaderMap,
) -> Result<Redirect, ApiError> {
    let provider = parse_provider(&provider)?;
    let origin = instance_origin(&state, &headers)?;
    let authorize_url = state
        .tracker
        .oauth()
        .start(provider, &auth.0.user.id, &origin)
        .map_err(tracker_error)?;
    Ok(Redirect::to(&authorize_url))
}

async fn tracker_oauth_status(
    State(state): State<AppState>,
    auth: RequireAuth,
    Path(provider): Path<String>,
) -> Result<Json<OAuthStatus>, ApiError> {
    let provider = parse_provider(&provider)?;
    let status = state
        .tracker
        .oauth()
        .status(provider, &auth.0.user.id)
        .map_err(tracker_error)?;
    Ok(Json(status))
}

async fn tracker_oauth_logout(
    State(state): State<AppState>,
    auth: RequireAuth,
    Path(provider): Path<String>,
) -> Result<StatusCode, ApiError> {
    let provider = parse_provider(&provider)?;
    state
        .tracker
        .oauth()
        .logout(provider, &auth.0.user.id)
        .map_err(tracker_error)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
struct CallbackQuery {
    code: String,
    state: String,
}

async fn tracker_oauth_callback(
    State(state): State<AppState>,
    Path(provider): Path<String>,
    Query(query): Query<CallbackQuery>,
) -> Result<Redirect, ApiError> {
    let provider = parse_provider(&provider)?;
    let target = match state
        .tracker
        .oauth()
        .handle_callback(provider, &query.code, &query.state)
        .await
    {
        Ok(()) => "/account/trackers?oauth=success".to_string(),
        Err(error) => {
            tracing::warn!("tracker OAuth callback failed for {provider}: {error}");
            let message =
                form_urlencoded::byte_serialize(error.to_string().as_bytes()).collect::<String>();
            format!("/account/trackers?oauth=error&message={message}")
        }
    };
    Ok(Redirect::to(&target))
}

fn instance_origin(state: &AppState, headers: &HeaderMap) -> Result<String, ApiError> {
    let scheme = headers
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("http");
    let host = headers
        .get("x-forwarded-host")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            headers
                .get(axum::http::header::HOST)
                .and_then(|value| value.to_str().ok())
        })
        .ok_or_else(|| ApiError::bad_request("cannot determine instance host"))?;
    let context_path = context_path_prefix(state.config.server_context_path.as_deref())?;
    Ok(format!("{scheme}://{host}{context_path}"))
}

fn context_path_prefix(path: Option<&str>) -> Result<String, ApiError> {
    let Some(path) = path else {
        return Ok(String::new());
    };
    let path = path.trim_matches('/');
    if path.is_empty() {
        return Ok(String::new());
    }
    if !path.split('/').all(|segment| {
        !segment.is_empty()
            && segment
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    }) {
        return Err(ApiError::bad_request(
            "server.context-path must contain only letters, numbers, '-' or '_' per segment",
        ));
    }
    Ok(format!("/{path}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::libraries::test_support::{insert_api_key, insert_user, TestApp};

    fn user_app() -> (TestApp, String) {
        let app = TestApp::new(router());
        let user_id = insert_user(&app.state.db, "user@x.c", false, true, &[]);
        insert_api_key(&app.state.db, &user_id, "k-user");
        (app, user_id)
    }

    #[tokio::test]
    async fn tracker_links_crud_is_per_user() {
        let (app, _) = user_app();

        let (status, body) = app.get_json("/api/v1/trackers/links/ser-1", "k-user").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, serde_json::json!([]));

        for (provider, track_id) in [("anilist", "42"), ("mal", "99")] {
            let (status, body) = app
                .request_json(
                    "PUT",
                    "/api/v1/trackers/links/ser-1",
                    "k-user",
                    Some(serde_json::json!({
                        "provider": provider,
                        "trackId": track_id,
                        "title": "Series",
                        "trackMode": "auto",
                        "chapterOffset": 2
                    })),
                )
                .await;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(body["provider"], provider);
            assert_eq!(body["trackId"], track_id);
            assert_eq!(body["trackMode"], "auto");
            assert_eq!(body["chapterOffset"], 2);
        }

        let (status, body) = app
            .request_json(
                "PUT",
                "/api/v1/trackers/links/ser-1",
                "k-user",
                Some(serde_json::json!({
                    "provider": "anilist",
                    "trackId": "43",
                    "trackMode": "volume",
                    "chapterOffset": 0
                })),
            )
            .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["trackId"], "43");
        assert_eq!(body["trackMode"], "volume");

        let (status, body) = app.get_json("/api/v1/trackers/links/ser-1", "k-user").await;
        assert_eq!(status, StatusCode::OK);
        let links = body.as_array().unwrap();
        assert_eq!(links.len(), 2);
        assert_eq!(links[0]["provider"], "anilist");
        assert_eq!(links[0]["trackId"], "43");

        let other = insert_user(&app.state.db, "other@x.c", false, true, &[]);
        insert_api_key(&app.state.db, &other, "k-other");
        let (status, body) = app
            .get_json("/api/v1/trackers/links/ser-1", "k-other")
            .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, serde_json::json!([]));

        app.request_json(
            "PUT",
            "/api/v1/trackers/links/ser-2",
            "k-user",
            Some(serde_json::json!({"provider": "bangumi", "trackId": "7"})),
        )
        .await;
        let (status, body) = app.get_json("/api/v1/trackers/links", "k-user").await;
        assert_eq!(status, StatusCode::OK);
        let links = body.as_array().unwrap();
        assert_eq!(links.len(), 3);
        let (_, body) = app.get_json("/api/v1/trackers/links", "k-other").await;
        assert_eq!(body, serde_json::json!([]));

        let (status, _) = app
            .request_json(
                "DELETE",
                "/api/v1/trackers/links/ser-1/anilist",
                "k-user",
                None,
            )
            .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        let (_, body) = app.get_json("/api/v1/trackers/links/ser-1", "k-user").await;
        let links = body.as_array().unwrap();
        assert_eq!(links.len(), 1);
        assert_eq!(links[0]["provider"], "mal");
    }

    #[tokio::test]
    async fn tracker_link_upsert_validates_input() {
        let (app, user_id) = user_app();

        let (status, body) = app
            .request_json(
                "PUT",
                "/api/v1/trackers/links/ser-1",
                "k-user",
                Some(serde_json::json!({"provider": "anilist", "trackId": "  "})),
            )
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["violations"][0]["fieldName"], "trackId");

        let (status, body) = app
            .request_json(
                "PUT",
                "/api/v1/trackers/links/ser-1",
                "k-user",
                Some(serde_json::json!({"provider": "anilist", "trackId": "1", "trackMode": "issues"})),
            )
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["violations"][0]["fieldName"], "trackMode");

        let (status, _) = app
            .request_json(
                "PUT",
                "/api/v1/trackers/links/ser-1",
                "k-user",
                Some(serde_json::json!({"provider": "AniList", "trackId": "1"})),
            )
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND);

        let (status, _) = app
            .request_json(
                "PUT",
                "/api/v1/trackers/links/ser-1",
                "k-user",
                Some(serde_json::json!({"provider": "foo", "trackId": "1"})),
            )
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND);

        let (status, _) = app
            .request_json("DELETE", "/api/v1/trackers/links/ser-1/foo", "k-user", None)
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND);

        assert!(TrackerLinkDao::new(app.state.kmrs_db.clone())
            .list_by_series_and_user("ser-1", &user_id)
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn tracker_preferences_roundtrip_is_per_user() {
        let (app, _) = user_app();

        let (status, body) = app.get_json("/api/v1/trackers/preferences", "k-user").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, serde_json::json!({ "libraries": [] }));

        let (status, body) = app
            .request_json(
                "PUT",
                "/api/v1/trackers/preferences",
                "k-user",
                Some(serde_json::json!({
                    "libraries": ["lib-1"],
                    "defaultTracker": "bangumi"
                })),
            )
            .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body,
            serde_json::json!({
                "libraries": ["lib-1"],
                "defaultTracker": "bangumi"
            })
        );

        let other = insert_user(&app.state.db, "other@x.c", false, true, &[]);
        insert_api_key(&app.state.db, &other, "k-other");
        let (_, body) = app
            .get_json("/api/v1/trackers/preferences", "k-other")
            .await;
        assert_eq!(body, serde_json::json!({ "libraries": [] }));
    }

    #[tokio::test]
    async fn tracker_preferences_rejects_unknown_default_tracker() {
        let (app, _) = user_app();

        let (status, body) = app
            .request_json(
                "PUT",
                "/api/v1/trackers/preferences",
                "k-user",
                Some(serde_json::json!({ "defaultTracker": "shikimori" })),
            )
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["violations"][0]["fieldName"], "defaultTracker");

        let (_, body) = app.get_json("/api/v1/trackers/preferences", "k-user").await;
        assert_eq!(body, serde_json::json!({ "libraries": [] }));
    }

    mod native_api {
        use super::*;
        use crate::api::libraries::test_support::test_config;
        use crate::service::tracker::oauth::{OAuthApp, OAuthManager};
        use crate::service::tracker::{TrackerError, TrackerServices};
        use crate::state::{test_app_state, test_kmrs_db};
        use axum::body::Body;
        use axum::http::Request;
        use komga_core::tracker::{TrackStatus, TrackUpdate};
        use komga_db::pool::Database;
        use komga_db::{Migrator, Placeholders};
        use std::collections::{HashMap, HashSet};
        use std::sync::Mutex as StdMutex;

        fn test_state() -> AppState {
            let db = Database::open_in_memory(true).unwrap();
            Migrator::new(&komga_db::main_migrations(), Placeholders::default())
                .migrate(&db.rw().unwrap())
                .unwrap();
            let tasks_db = Database::open_in_memory(false).unwrap();
            Migrator::new(&komga_db::tasks_migrations(), Placeholders::default())
                .migrate(&tasks_db.rw().unwrap())
                .unwrap();
            test_app_state(test_config(), db, tasks_db, test_kmrs_db()).0
        }

        #[derive(Default)]
        struct StubTracker {
            users: StdMutex<HashSet<String>>,
            updates: StdMutex<Vec<(String, String, TrackUpdate)>>,
        }

        #[async_trait::async_trait]
        impl TrackerService for StubTracker {
            fn provider(&self) -> Provider {
                Provider::Anilist
            }

            fn is_logged_in(&self, user_id: &str) -> Result<bool, TrackerError> {
                Ok(self.users.lock().unwrap().contains(user_id))
            }

            async fn search(
                &self,
                user_id: &str,
                query: &str,
                _nsfw: bool,
            ) -> Result<Vec<TrackSearchItem>, TrackerError> {
                Ok(vec![TrackSearchItem {
                    id: user_id.to_string(),
                    title: query.to_string(),
                    cover_url: None,
                    description: None,
                    tracked: true,
                    media_type: None,
                    url: None,
                }])
            }

            async fn get_state(
                &self,
                _user_id: &str,
                _track_id: &str,
            ) -> Result<RemoteState, TrackerError> {
                Ok(RemoteState {
                    status: Some(TrackStatus::Reading),
                    last_read_chapter: Some(7.0),
                    total_chapters: Some(20),
                    ..RemoteState::default()
                })
            }

            async fn update(
                &self,
                user_id: &str,
                track_id: &str,
                update: &TrackUpdate,
            ) -> Result<(), TrackerError> {
                self.updates.lock().unwrap().push((
                    user_id.to_string(),
                    track_id.to_string(),
                    update.clone(),
                ));
                Ok(())
            }
        }

        fn user_app_with_stub() -> (TestApp, String, Arc<StubTracker>) {
            let mut state = test_state();
            let stub = Arc::new(StubTracker::default());
            let oauth = state.tracker.oauth().clone();
            state.tracker = Arc::new(TrackerServices::new(oauth, vec![stub.clone()]));
            let app = TestApp::with_state(router(), state);
            let user_id = insert_user(&app.state.db, "user@x.c", false, true, &[]);
            insert_api_key(&app.state.db, &user_id, "k-user");
            stub.users.lock().unwrap().insert(user_id.clone());
            (app, user_id, stub)
        }

        #[tokio::test]
        async fn remote_routes_use_the_authenticated_user() {
            let (app, user_id, stub) = user_app_with_stub();
            let (status, body) = app
                .get_json("/api/v1/trackers/anilist/search?name=Series", "k-user")
                .await;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(body[0]["id"], user_id);
            assert_eq!(body[0]["title"], "Series");

            let (status, body) = app
                .get_json("/api/v1/trackers/anilist/state?trackId=42", "k-user")
                .await;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(body["lastReadChapter"], 7.0);
            assert_eq!(body["totalChapters"], 20);

            let (status, _) = app
                .request_json(
                    "POST",
                    "/api/v1/trackers/anilist/update",
                    "k-user",
                    Some(serde_json::json!({
                        "trackId": "42",
                        "title": "Series",
                        "coverUrl": "https://img.example/cover.jpg",
                        "score": 8,
                        "status": "reading",
                        "lastReadChapter": 9
                    })),
                )
                .await;
            assert_eq!(status, StatusCode::NO_CONTENT);
            {
                let updates = stub.updates.lock().unwrap();
                assert_eq!(updates.len(), 1);
                assert_eq!(updates[0].0, user_id);
                assert_eq!(updates[0].1, "42");
                assert_eq!(updates[0].2.score, Some(8));
            }

            let (_, body) = app.get_json("/api/v1/trackers/ledger", "k-user").await;
            assert_eq!(body[0]["trackId"], "42");
            assert_eq!(body[0]["title"], "Series");
            assert_eq!(body[0]["coverUrl"], "https://img.example/cover.jpg");

            let other = insert_user(&app.state.db, "other@x.c", false, true, &[]);
            insert_api_key(&app.state.db, &other, "k-other");
            let (status, _) = app
                .get_json("/api/v1/trackers/anilist/search?name=Series", "k-other")
                .await;
            assert_eq!(status, StatusCode::UNAUTHORIZED);
            let (status, _) = app
                .get_json("/api/v1/komf/trackers/anilist/search?name=Series", "k-user")
                .await;
            assert_eq!(status, StatusCode::NOT_FOUND);
        }

        async fn serve_oauth() -> String {
            let app = Router::new()
                .route(
                    "/token/anilist",
                    routing::post(|| async {
                        Json(serde_json::json!({
                            "access_token": "access-token",
                            "refresh_token": "refresh-token",
                            "token_type": "Bearer",
                            "expires_in": 3600
                        }))
                    }),
                )
                .route(
                    "/userinfo/anilist",
                    routing::post(|| async {
                        Json(serde_json::json!({"data": {"Viewer": {"name": "alice"}}}))
                    }),
                );
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            tokio::spawn(async move {
                axum::serve(listener, app).await.unwrap();
            });
            format!("http://{address}")
        }

        fn user_app_with_oauth(origin: &str) -> TestApp {
            user_app_with_oauth_context(origin, None)
        }

        fn user_app_with_oauth_context(origin: &str, context_path: Option<&str>) -> TestApp {
            let mut state = test_state();
            state.config = Arc::new(crate::config::ServerConfig {
                server_context_path: context_path.map(str::to_string),
                ..(*state.config).clone()
            });
            let mut apps = HashMap::new();
            for provider in Provider::ALL {
                let mut app = OAuthApp::for_provider(provider);
                app.client_id = Some(format!("id-{provider}"));
                app.client_secret = Some("secret".into());
                app.authorize_url = format!("{origin}/authorize/{provider}");
                app.token_url = format!("{origin}/token/{provider}");
                app.userinfo_url = format!("{origin}/userinfo/{provider}");
                apps.insert(provider, app);
            }
            let oauth =
                OAuthManager::with_apps(state.kmrs_db.clone(), reqwest::Client::new(), apps);
            state.tracker = Arc::new(TrackerServices::new(oauth, Vec::new()));
            let app = TestApp::with_state(router(), state);
            let user_id = insert_user(&app.state.db, "user@x.c", false, true, &[]);
            insert_api_key(&app.state.db, &user_id, "k-user");
            app
        }

        #[tokio::test]
        async fn oauth_start_includes_context_path() {
            let origin = serve_oauth().await;
            let app = user_app_with_oauth_context(&origin, Some("/komga"));
            let (status, headers, _) = app
                .request(
                    Request::get("/api/v1/trackers/oauth/anilist/start")
                        .header("X-API-Key", "k-user")
                        .header("Host", "kmrs.example")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await;
            assert_eq!(status, StatusCode::SEE_OTHER);
            let location = headers
                .get(axum::http::header::LOCATION)
                .unwrap()
                .to_str()
                .unwrap();
            let authorize = reqwest::Url::parse(location).unwrap();
            let query: HashMap<_, _> = authorize.query_pairs().into_owned().collect();
            let state: serde_json::Value = serde_json::from_str(&query["state"]).unwrap();
            assert_eq!(
                state["redirectUrl"],
                "http://kmrs.example/komga/api/v1/trackers/oauth/anilist/callback"
            );
        }

        #[tokio::test]
        async fn oauth_callback_completes_login_and_logout() {
            let origin = serve_oauth().await;
            let app = user_app_with_oauth(&origin);
            let (status, _, body) = app
                .get_response("/api/v1/trackers/oauth/anilist/status", "k-user")
                .await;
            assert_eq!(status, StatusCode::OK);
            let status: OAuthStatus = serde_json::from_slice(&body).unwrap();
            assert!(!status.logged_in);

            let (status, headers, _) = app
                .request(
                    Request::get("/api/v1/trackers/oauth/anilist/start")
                        .header("X-API-Key", "k-user")
                        .header("Host", "kmrs.example")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await;
            assert_eq!(status, StatusCode::SEE_OTHER);
            let location = headers
                .get(axum::http::header::LOCATION)
                .unwrap()
                .to_str()
                .unwrap();
            let authorize = reqwest::Url::parse(location).unwrap();
            let query: HashMap<_, _> = authorize.query_pairs().into_owned().collect();
            assert_eq!(query["client_id"], "id-anilist");
            assert_eq!(
                query["redirect_uri"],
                "https://kmworks.date/oauth/anilist/callback/"
            );
            let state: serde_json::Value = serde_json::from_str(&query["state"]).unwrap();
            assert_eq!(
                state["redirectUrl"],
                "http://kmrs.example/api/v1/trackers/oauth/anilist/callback"
            );

            let encoded_state =
                form_urlencoded::byte_serialize(query["state"].as_bytes()).collect::<String>();
            let callback =
                format!("/api/v1/trackers/oauth/anilist/callback?code=ok&state={encoded_state}");
            let (status, headers, _) = app.get_response(&callback, "k-user").await;
            assert_eq!(status, StatusCode::SEE_OTHER);
            assert_eq!(
                headers.get(axum::http::header::LOCATION).unwrap(),
                "/account/trackers?oauth=success"
            );
            let (_, body) = app
                .get_json("/api/v1/trackers/oauth/anilist/status", "k-user")
                .await;
            assert_eq!(body["logged_in"], true);
            assert_eq!(body["username"], "alice");

            let (status, headers, _) = app.get_response(&callback, "k-user").await;
            assert_eq!(status, StatusCode::SEE_OTHER);
            let location = headers
                .get(axum::http::header::LOCATION)
                .unwrap()
                .to_str()
                .unwrap();
            assert!(location.contains("oauth=error"));

            let (status, _) = app
                .request_json(
                    "POST",
                    "/api/v1/trackers/oauth/anilist/logout",
                    "k-user",
                    None,
                )
                .await;
            assert_eq!(status, StatusCode::NO_CONTENT);
            let (_, body) = app
                .get_json("/api/v1/trackers/oauth/anilist/status", "k-user")
                .await;
            assert_eq!(body["logged_in"], false);
        }
    }
}
