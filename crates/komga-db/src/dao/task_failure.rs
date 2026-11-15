//! Permanently failed background tasks in `kmrs.sqlite`, separate from the
//! Java-compatible task queue.

use crate::error::Result;
use crate::pool::Database;
use komga_core::task::Task;
use komga_core::time_codec;
use rusqlite::params;

#[derive(Debug)]
pub struct TaskFailure {
    pub task: Task,
    pub retry_count: u32,
    pub error: String,
    pub failed_at: time::OffsetDateTime,
}

pub struct TaskFailureDao {
    db: Database,
}

impl TaskFailureDao {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    pub fn record(&self, task: &Task, retry_count: u32, error: &str) -> Result<()> {
        let conn = self.db.rw()?;
        conn.execute(
            "INSERT INTO TASK_FAILURE \
             (TASK_ID, CLASS, PAYLOAD, RETRY_COUNT, LAST_ERROR, FAILED_AT) \
             VALUES (?, ?, ?, ?, ?, ?) \
             ON CONFLICT(TASK_ID) DO UPDATE SET \
             CLASS = excluded.CLASS, PAYLOAD = excluded.PAYLOAD, \
             RETRY_COUNT = excluded.RETRY_COUNT, LAST_ERROR = excluded.LAST_ERROR, \
             FAILED_AT = excluded.FAILED_AT",
            params![
                task.unique_id(),
                task.class_name(),
                task.to_payload().to_string(),
                retry_count,
                error,
                time_codec::format_datetime(time_codec::now_utc()),
            ],
        )?;
        Ok(())
    }

    pub fn find_all(&self) -> Result<Vec<TaskFailure>> {
        let conn = self.db.ro()?;
        let mut stmt = conn.prepare(
            "SELECT CLASS, PAYLOAD, RETRY_COUNT, LAST_ERROR, FAILED_AT FROM TASK_FAILURE \
             ORDER BY FAILED_AT DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, u32>(2)?,
                row.get::<_, String>(3)?,
                crate::dao::get_datetime(row, 4)?,
            ))
        })?;
        let mut failures = vec![];
        for row in rows {
            let (class, payload, retry_count, error, failed_at) = row?;
            match Task::from_payload(&class, &payload) {
                Some(task) => failures.push(TaskFailure {
                    task,
                    retry_count,
                    error,
                    failed_at,
                }),
                None => tracing::error!("Could not deserialize object of type: {class}"),
            }
        }
        Ok(failures)
    }

    pub fn delete(&self, task_id: &str) -> Result<()> {
        let conn = self.db.rw()?;
        conn.execute("DELETE FROM TASK_FAILURE WHERE TASK_ID = ?", [task_id])?;
        Ok(())
    }

    pub fn delete_all(&self) -> Result<()> {
        let conn = self.db.rw()?;
        conn.execute("DELETE FROM TASK_FAILURE", [])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Migrator, Placeholders};
    use komga_core::task::{BookTaskKind, DEFAULT_PRIORITY};

    #[test]
    fn failed_task_round_trip() {
        let db = Database::open_in_memory(false).unwrap();
        Migrator::new(&crate::kmrs_migrations(), Placeholders::default())
            .migrate(&db.rw().unwrap())
            .unwrap();
        let dao = TaskFailureDao::new(db);
        let task = Task::book(BookTaskKind::HashBook, "b1", DEFAULT_PRIORITY, None);

        dao.record(&task, 3, "permanent I/O error").unwrap();
        let failed = dao.find_all().unwrap();
        assert_eq!(failed.len(), 1);
        assert_eq!(failed[0].task.to_payload(), task.to_payload());
        assert_eq!(failed[0].retry_count, 3);
        assert_eq!(failed[0].error, "permanent I/O error");

        dao.delete_all().unwrap();
        assert!(dao.find_all().unwrap().is_empty());
    }
}
