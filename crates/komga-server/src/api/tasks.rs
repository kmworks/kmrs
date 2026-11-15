//! `TaskController` queue clearing, plus kmrs's persisted permanent-failure listing.

use crate::auth::RequireAuth;
use crate::error::ApiError;
use crate::state::AppState;
use axum::extract::State;
use axum::{routing, Json, Router};
use komga_db::dao::task_failure::{TaskFailure, TaskFailureDao};
use komga_db::dao::tasks::TasksDao;
use serde::Serialize;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/tasks", routing::delete(empty_task_queue))
        .route("/api/v1/tasks/failed", routing::get(list_failed_tasks))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FailedTaskDto {
    id: String,
    #[serde(rename = "type")]
    task_type: &'static str,
    payload: serde_json::Value,
    retry_count: u32,
    error: String,
    #[serde(with = "komga_core::dto::dto_datetime")]
    failed_at: time::OffsetDateTime,
}

impl From<TaskFailure> for FailedTaskDto {
    fn from(failure: TaskFailure) -> Self {
        Self {
            id: failure.task.unique_id(),
            task_type: failure.task.simple_type(),
            payload: failure.task.to_payload(),
            retry_count: failure.retry_count,
            error: failure.error,
            failed_at: failure.failed_at,
        }
    }
}

async fn list_failed_tasks(
    State(state): State<AppState>,
    auth: RequireAuth,
) -> Result<Json<Vec<FailedTaskDto>>, ApiError> {
    auth.0.require_admin()?;
    let failed = TaskFailureDao::new(state.kmrs_db.clone())
        .find_all()?
        .into_iter()
        .map(FailedTaskDto::from)
        .collect();
    Ok(Json(failed))
}

async fn empty_task_queue(
    State(state): State<AppState>,
    auth: RequireAuth,
) -> Result<Json<i64>, ApiError> {
    auth.0.require_admin()?;
    let deleted = TasksDao::new(state.tasks_db.clone()).delete_all_without_owner()?;
    TaskFailureDao::new(state.kmrs_db.clone()).delete_all()?;
    Ok(Json(deleted))
}

#[cfg(test)]
mod tests {
    use crate::api::libraries::test_support::{insert_api_key, insert_user, TestApp};
    use axum::http::StatusCode;
    use komga_core::task::{BookTaskKind, Task, DEFAULT_PRIORITY};
    use komga_db::dao::task_failure::TaskFailureDao;
    use komga_db::dao::tasks::TasksDao;

    #[tokio::test]
    async fn failed_tasks_endpoint_returns_empty_list() {
        let app = TestApp::new(super::router());
        let admin = insert_user(&app.state.db, "admin@x.c", true, true, &[]);
        insert_api_key(&app.state.db, &admin, "k-admin");

        let (status, body) = app
            .request_json("GET", "/api/v1/tasks/failed", "k-admin", None)
            .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, serde_json::json!([]));
    }

    #[tokio::test]
    async fn failed_tasks_include_payload_error_and_retry_count() {
        let app = TestApp::new(super::router());
        let task = Task::book(BookTaskKind::HashBook, "b1", DEFAULT_PRIORITY, None);
        TaskFailureDao::new(app.state.kmrs_db.clone())
            .record(&task, 1, "network mount unavailable")
            .unwrap();

        let admin = insert_user(&app.state.db, "admin@x.c", true, true, &[]);
        insert_api_key(&app.state.db, &admin, "k-admin");
        let user = insert_user(&app.state.db, "user@x.c", false, true, &[]);
        insert_api_key(&app.state.db, &user, "k-user");

        let (status, _) = app
            .request_json("GET", "/api/v1/tasks/failed", "k-user", None)
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN);

        let (status, body) = app
            .request_json("GET", "/api/v1/tasks/failed", "k-admin", None)
            .await;
        assert_eq!(status, StatusCode::OK);
        let tasks = body.as_array().unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0]["id"], task.unique_id());
        assert_eq!(tasks[0]["type"], "HashBook");
        assert_eq!(tasks[0]["payload"]["bookId"], "b1");
        assert_eq!(tasks[0]["retryCount"], 1);
        assert_eq!(tasks[0]["error"], "network mount unavailable");
        assert!(tasks[0]["failedAt"].is_string());
    }

    #[tokio::test]
    async fn clear_returns_deleted_count() {
        let app = TestApp::new(super::router());
        let dao = TasksDao::new(app.state.tasks_db.clone());
        dao.save(&Task::book(
            BookTaskKind::HashBook,
            "b1",
            DEFAULT_PRIORITY,
            None,
        ))
        .unwrap();
        dao.save(&Task::book(
            BookTaskKind::HashBook,
            "b2",
            DEFAULT_PRIORITY,
            None,
        ))
        .unwrap();
        // claimed tasks are not cleared
        dao.take_first("worker-1").unwrap();
        let failure_dao = TaskFailureDao::new(app.state.kmrs_db.clone());
        let failed = Task::book(BookTaskKind::HashBook, "b2", DEFAULT_PRIORITY, None);
        failure_dao.record(&failed, 1, "pending").unwrap();

        let admin = insert_user(&app.state.db, "admin@x.c", true, true, &[]);
        insert_api_key(&app.state.db, &admin, "k-admin");
        let user = insert_user(&app.state.db, "user@x.c", false, true, &[]);
        insert_api_key(&app.state.db, &user, "k-user");

        let (status, _) = app
            .request_json("DELETE", "/api/v1/tasks", "k-user", None)
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN);

        let (status, body) = app
            .request_json("DELETE", "/api/v1/tasks", "k-admin", None)
            .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, serde_json::json!(1));
        assert_eq!(dao.count().unwrap(), 1);
        assert!(failure_dao.find_all().unwrap().is_empty());
    }
}
