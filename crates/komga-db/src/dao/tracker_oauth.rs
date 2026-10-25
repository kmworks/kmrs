//! Native tracker OAuth state in `kmrs.sqlite`, isolated by provider and user.

use crate::pool::Database;
use crate::Result;
use komga_core::time_codec;
use rusqlite::{OptionalExtension, Row};
use time::{Duration, OffsetDateTime};

pub const PENDING_TTL: Duration = Duration::seconds(600);

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TrackerOAuthToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_type: Option<String>,
    pub expires_at: Option<OffsetDateTime>,
    pub username: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrackerOAuthPending {
    pub user_id: String,
    pub verifier: String,
    pub created_date: OffsetDateTime,
}

pub struct TrackerOAuthDao {
    db: Database,
}

const TOKEN_COLUMNS: &str = "ACCESS_TOKEN, REFRESH_TOKEN, TOKEN_TYPE, EXPIRES_AT, USERNAME";
const PENDING_COLUMNS: &str = "USER_ID, VERIFIER, CREATED_DATE";

fn row_to_token(row: &Row<'_>) -> rusqlite::Result<TrackerOAuthToken> {
    Ok(TrackerOAuthToken {
        access_token: row.get(0)?,
        refresh_token: row.get(1)?,
        token_type: row.get(2)?,
        expires_at: super::get_datetime_opt(row, 3)?,
        username: row.get(4)?,
    })
}

fn row_to_pending(row: &Row<'_>) -> rusqlite::Result<TrackerOAuthPending> {
    Ok(TrackerOAuthPending {
        user_id: row.get(0)?,
        verifier: row.get(1)?,
        created_date: super::get_datetime(row, 2)?,
    })
}

fn live(pending: TrackerOAuthPending, now: OffsetDateTime) -> Option<TrackerOAuthPending> {
    (now - pending.created_date <= PENDING_TTL).then_some(pending)
}

impl TrackerOAuthDao {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    pub fn get_token(&self, provider: &str, user_id: &str) -> Result<Option<TrackerOAuthToken>> {
        let conn = self.db.ro()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {TOKEN_COLUMNS} FROM TRACKER_OAUTH_TOKEN \
             WHERE PROVIDER = ? AND USER_ID = ?"
        ))?;
        Ok(stmt
            .query_row(rusqlite::params![provider, user_id], row_to_token)
            .optional()?)
    }

    pub fn upsert_token(
        &self,
        provider: &str,
        user_id: &str,
        token: &TrackerOAuthToken,
    ) -> Result<()> {
        let now = time_codec::format_datetime(time_codec::now_utc());
        let expires_at = token.expires_at.map(time_codec::format_datetime);
        self.db.rw()?.execute(
            r#"
            INSERT INTO TRACKER_OAUTH_TOKEN
                (PROVIDER, USER_ID, ACCESS_TOKEN, REFRESH_TOKEN, TOKEN_TYPE,
                 EXPIRES_AT, USERNAME, CREATED_DATE, LAST_MODIFIED_DATE)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (PROVIDER, USER_ID) DO UPDATE SET
                ACCESS_TOKEN = excluded.ACCESS_TOKEN,
                REFRESH_TOKEN = excluded.REFRESH_TOKEN,
                TOKEN_TYPE = excluded.TOKEN_TYPE,
                EXPIRES_AT = excluded.EXPIRES_AT,
                USERNAME = excluded.USERNAME,
                LAST_MODIFIED_DATE = excluded.LAST_MODIFIED_DATE
            "#,
            rusqlite::params![
                provider,
                user_id,
                token.access_token.as_str(),
                token.refresh_token.as_deref(),
                token.token_type.as_deref(),
                expires_at,
                token.username.as_deref(),
                now,
                now,
            ],
        )?;
        Ok(())
    }

    pub fn update_username(&self, provider: &str, user_id: &str, username: &str) -> Result<()> {
        self.db.rw()?.execute(
            "UPDATE TRACKER_OAUTH_TOKEN SET USERNAME = ?, LAST_MODIFIED_DATE = ? \
             WHERE PROVIDER = ? AND USER_ID = ?",
            rusqlite::params![
                username,
                time_codec::format_datetime(time_codec::now_utc()),
                provider,
                user_id,
            ],
        )?;
        Ok(())
    }

    pub fn update_token_if_current(
        &self,
        provider: &str,
        user_id: &str,
        expected_access_token: &str,
        token: &TrackerOAuthToken,
    ) -> Result<bool> {
        let affected = self.db.rw()?.execute(
            r#"
            UPDATE TRACKER_OAUTH_TOKEN SET
                ACCESS_TOKEN = ?, REFRESH_TOKEN = ?, TOKEN_TYPE = ?,
                EXPIRES_AT = ?, USERNAME = ?, LAST_MODIFIED_DATE = ?
            WHERE PROVIDER = ? AND USER_ID = ? AND ACCESS_TOKEN = ?
            "#,
            rusqlite::params![
                token.access_token.as_str(),
                token.refresh_token.as_deref(),
                token.token_type.as_deref(),
                token.expires_at.map(time_codec::format_datetime),
                token.username.as_deref(),
                time_codec::format_datetime(time_codec::now_utc()),
                provider,
                user_id,
                expected_access_token,
            ],
        )?;
        Ok(affected == 1)
    }

    pub fn delete_token_if_current(
        &self,
        provider: &str,
        user_id: &str,
        expected_access_token: &str,
    ) -> Result<bool> {
        let affected = self.db.rw()?.execute(
            "DELETE FROM TRACKER_OAUTH_TOKEN \
             WHERE PROVIDER = ? AND USER_ID = ? AND ACCESS_TOKEN = ?",
            rusqlite::params![provider, user_id, expected_access_token],
        )?;
        Ok(affected == 1)
    }

    pub fn delete_token(&self, provider: &str, user_id: &str) -> Result<()> {
        self.db.rw()?.execute(
            "DELETE FROM TRACKER_OAUTH_TOKEN WHERE PROVIDER = ? AND USER_ID = ?",
            rusqlite::params![provider, user_id],
        )?;
        Ok(())
    }

    pub fn insert_pending(
        &self,
        provider: &str,
        nonce: &str,
        user_id: &str,
        verifier: &str,
        created_date: OffsetDateTime,
    ) -> Result<()> {
        self.db.rw()?.execute(
            "INSERT INTO TRACKER_OAUTH_PENDING \
                (PROVIDER, NONCE, USER_ID, VERIFIER, CREATED_DATE) \
             VALUES (?, ?, ?, ?, ?)",
            rusqlite::params![
                provider,
                nonce,
                user_id,
                verifier,
                time_codec::format_datetime(created_date),
            ],
        )?;
        Ok(())
    }

    pub fn get_pending(
        &self,
        provider: &str,
        nonce: &str,
        now: OffsetDateTime,
    ) -> Result<Option<TrackerOAuthPending>> {
        let conn = self.db.ro()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {PENDING_COLUMNS} FROM TRACKER_OAUTH_PENDING \
             WHERE PROVIDER = ? AND NONCE = ?"
        ))?;
        let pending = stmt
            .query_row(rusqlite::params![provider, nonce], row_to_pending)
            .optional()?;
        Ok(pending.and_then(|pending| live(pending, now)))
    }

    /// Consumes even an expired row so a callback cannot be retried or replayed.
    pub fn consume_pending(
        &self,
        provider: &str,
        nonce: &str,
        now: OffsetDateTime,
    ) -> Result<Option<TrackerOAuthPending>> {
        let conn = self.db.rw()?;
        let mut stmt = conn.prepare(&format!(
            "DELETE FROM TRACKER_OAUTH_PENDING WHERE PROVIDER = ? AND NONCE = ? \
             RETURNING {PENDING_COLUMNS}"
        ))?;
        let pending = stmt
            .query_row(rusqlite::params![provider, nonce], row_to_pending)
            .optional()?;
        Ok(pending.and_then(|pending| live(pending, now)))
    }

    pub fn delete_pending_for_user(&self, provider: &str, user_id: &str) -> Result<()> {
        self.db.rw()?.execute(
            "DELETE FROM TRACKER_OAUTH_PENDING WHERE PROVIDER = ? AND USER_ID = ?",
            rusqlite::params![provider, user_id],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pool::DatabaseConfig;
    use crate::{Migrator, Placeholders};

    fn migrate(db: &Database) {
        Migrator::new(&crate::kmrs_migrations(), Placeholders::default())
            .migrate(&db.rw().unwrap())
            .unwrap();
    }

    fn test_dao() -> TrackerOAuthDao {
        let db = Database::open_in_memory(false).unwrap();
        migrate(&db);
        TrackerOAuthDao::new(db)
    }

    fn token(access_token: &str, username: &str) -> TrackerOAuthToken {
        TrackerOAuthToken {
            access_token: access_token.into(),
            refresh_token: Some(format!("refresh-{access_token}")),
            token_type: Some("Bearer".into()),
            expires_at: None,
            username: Some(username.into()),
        }
    }

    #[test]
    fn tokens_are_isolated_and_upserted_per_provider_and_user() {
        let dao = test_dao();
        dao.upsert_token("mal", "alice", &token("alice-token", "alice"))
            .unwrap();
        dao.upsert_token("mal", "bob", &token("bob-token", "bob"))
            .unwrap();
        dao.upsert_token("bangumi", "alice", &token("bangumi-token", "alice-bg"))
            .unwrap();

        assert_eq!(
            dao.get_token("mal", "alice").unwrap().unwrap().access_token,
            "alice-token"
        );
        assert_eq!(
            dao.get_token("mal", "bob").unwrap().unwrap().access_token,
            "bob-token"
        );
        assert!(dao.get_token("anilist", "alice").unwrap().is_none());

        let mut replacement = token("new-token", "alice-new");
        replacement.refresh_token = None;
        dao.upsert_token("mal", "alice", &replacement).unwrap();
        assert_eq!(dao.get_token("mal", "alice").unwrap(), Some(replacement));
        assert_eq!(
            dao.get_token("mal", "bob").unwrap().unwrap().access_token,
            "bob-token"
        );

        dao.delete_token("mal", "alice").unwrap();
        assert!(dao.get_token("mal", "alice").unwrap().is_none());
        assert!(dao.get_token("mal", "bob").unwrap().is_some());
        assert!(dao.get_token("bangumi", "alice").unwrap().is_some());
    }

    #[test]
    fn conditional_update_and_delete_require_the_current_access_token() {
        let dao = test_dao();
        dao.upsert_token("mal", "alice", &token("old", "alice"))
            .unwrap();
        let fresh = token("fresh", "alice-new");
        assert!(!dao
            .update_token_if_current("mal", "alice", "wrong", &fresh)
            .unwrap());
        assert_eq!(
            dao.get_token("mal", "alice").unwrap().unwrap().access_token,
            "old"
        );

        assert!(dao
            .update_token_if_current("mal", "alice", "old", &fresh)
            .unwrap());
        assert_eq!(
            dao.get_token("mal", "alice").unwrap().unwrap().access_token,
            "fresh"
        );
        assert!(!dao
            .delete_token_if_current("mal", "alice", "wrong")
            .unwrap());
        assert!(dao.get_token("mal", "alice").unwrap().is_some());
        assert!(dao
            .delete_token_if_current("mal", "alice", "fresh")
            .unwrap());
        assert!(dao.get_token("mal", "alice").unwrap().is_none());
    }

    #[test]
    fn pending_is_scoped_expiring_and_single_use() {
        let dao = test_dao();
        let now = time_codec::now_utc();
        dao.insert_pending("anilist", "alice-nonce", "alice", "alice-verifier", now)
            .unwrap();
        dao.insert_pending("anilist", "bob-nonce", "bob", "bob-verifier", now)
            .unwrap();
        dao.insert_pending("mal", "alice-nonce", "alice-mal", "mal-verifier", now)
            .unwrap();
        dao.insert_pending(
            "bangumi",
            "expired",
            "alice",
            "old-verifier",
            now - PENDING_TTL - Duration::seconds(1),
        )
        .unwrap();

        assert!(dao
            .get_pending("anilist", "expired", now)
            .unwrap()
            .is_none());
        assert_eq!(
            dao.consume_pending("bangumi", "expired", now).unwrap(),
            None
        );
        assert!(dao
            .consume_pending("bangumi", "expired", now)
            .unwrap()
            .is_none());

        let pending = dao
            .consume_pending("anilist", "alice-nonce", now)
            .unwrap()
            .unwrap();
        assert_eq!(pending.user_id, "alice");
        assert_eq!(pending.verifier, "alice-verifier");
        assert!(dao
            .consume_pending("anilist", "alice-nonce", now)
            .unwrap()
            .is_none());
        assert!(dao
            .get_pending("anilist", "bob-nonce", now)
            .unwrap()
            .is_some());
        assert_eq!(
            dao.get_pending("mal", "alice-nonce", now)
                .unwrap()
                .unwrap()
                .user_id,
            "alice-mal"
        );
    }

    #[test]
    fn logout_pending_cleanup_is_per_user() {
        let dao = test_dao();
        let now = time_codec::now_utc();
        dao.insert_pending("mal", "alice", "alice", "verifier", now)
            .unwrap();
        dao.insert_pending("mal", "bob", "bob", "verifier", now)
            .unwrap();
        dao.delete_pending_for_user("mal", "alice").unwrap();
        assert!(dao.get_pending("mal", "alice", now).unwrap().is_none());
        assert!(dao.get_pending("mal", "bob", now).unwrap().is_some());
    }

    #[test]
    fn token_and_pending_survive_reopening_kmrs_database() {
        let dir = tempfile::tempdir().unwrap();
        let config = DatabaseConfig {
            file: dir.path().join("kmrs.sqlite"),
            pool_size: Some(1),
            register_udfs: false,
            ..Default::default()
        };
        let now = time_codec::now_utc();
        {
            let db = Database::open(&config).unwrap();
            migrate(&db);
            let dao = TrackerOAuthDao::new(db);
            dao.upsert_token("mangabaka", "alice", &token("persisted", "alice"))
                .unwrap();
            dao.insert_pending("mangabaka", "nonce", "alice", "verifier", now)
                .unwrap();
        }

        let db = Database::open(&config).unwrap();
        migrate(&db);
        let dao = TrackerOAuthDao::new(db);
        assert_eq!(
            dao.get_token("mangabaka", "alice")
                .unwrap()
                .unwrap()
                .access_token,
            "persisted"
        );
        let pending = dao
            .consume_pending("mangabaka", "nonce", time_codec::now_utc())
            .unwrap()
            .unwrap();
        assert_eq!(pending.user_id, "alice");
        assert_eq!(pending.verifier, "verifier");
    }
}
