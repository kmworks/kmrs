//! Per-user EPUB bookmark storage for reader clients.
use crate::{api::restriction, auth::RequireAuth, error::ApiError, state::AppState};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing, Json, Router,
};
use komga_core::dto::bookmark::{EpubBookmark, EpubBookmarkLocation};
use komga_db::dao::{book::BookDao, bookmark::BookmarkDao};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/books/{bookId}/bookmarks", routing::get(list))
        .route(
            "/api/v1/books/{bookId}/bookmarks/{bookmarkId}",
            routing::put(save).delete(delete),
        )
}

fn check_book(state: &AppState, auth: &RequireAuth, book_id: &str) -> Result<(), ApiError> {
    let book = BookDao::new(state.db.clone())
        .find_by_id(book_id)?
        .ok_or_else(|| ApiError::not_found(""))?;
    restriction::check_book(state, &auth.0.user, &book)
}

fn bookmark_id(id: &str) -> Result<String, ApiError> {
    uuid::Uuid::parse_str(id)
        .map(|id| id.to_string())
        .map_err(|_| ApiError::bad_request("bookmarkId must be a UUID"))
}

async fn list(
    State(state): State<AppState>,
    auth: RequireAuth,
    Path(book_id): Path<String>,
) -> Result<Json<Vec<EpubBookmark>>, ApiError> {
    check_book(&state, &auth, &book_id)?;
    Ok(Json(
        BookmarkDao::new(state.kmrs_db).list(&auth.0.user.id, &book_id)?,
    ))
}

async fn save(
    State(state): State<AppState>,
    auth: RequireAuth,
    Path((book_id, id)): Path<(String, String)>,
    Json(location): Json<EpubBookmarkLocation>,
) -> Result<Json<EpubBookmark>, ApiError> {
    check_book(&state, &auth, &book_id)?;
    let id = bookmark_id(&id)?;
    if location.chapter_index < 0
        || location.chapter_href.trim().is_empty()
        || location.chapter_href.len() > 8192
        || !location.chapter_fraction.is_finite()
        || !(0.0..=1.0).contains(&location.chapter_fraction)
        || !location.total_progression.is_finite()
        || !(0.0..=1.0).contains(&location.total_progression)
        || location
            .chapter_title
            .as_ref()
            .is_some_and(|title| title.len() > 4096)
    {
        return Err(ApiError::bad_request("Invalid EPUB bookmark location"));
    }
    let bookmark = EpubBookmark {
        id,
        book_id,
        location,
    };
    BookmarkDao::new(state.kmrs_db).save(&auth.0.user.id, &bookmark)?;
    Ok(Json(bookmark))
}

async fn delete(
    State(state): State<AppState>,
    auth: RequireAuth,
    Path((book_id, id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    check_book(&state, &auth, &book_id)?;
    BookmarkDao::new(state.kmrs_db).delete(&auth.0.user.id, &book_id, &bookmark_id(&id)?)?;
    Ok(StatusCode::NO_CONTENT)
}
