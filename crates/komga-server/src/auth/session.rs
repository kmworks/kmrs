//! Session store: aligned with Spring Session (caffeine when
//! `jdbc-session-enabled=false`, JDBC over `sessions.sqlite` when true).
//! - Cookie name `KOMGA-SESSION`; the `X-Auth-Token` header is also accepted for passing the session id both ways.
//! - Sliding expiration (default 7 days, idle-based): every access refreshes
//!   `LAST_ACCESS_TIME`/`EXPIRY_TIME`, like the `SessionRepositoryFilter` saving
//!   the session at the end of each request.
//! - Session data stores the user id plus the API-key mark left by API-key authentication
//!   (Spring persists the replaced SecurityContext into the session); user info is fetched
//!   from the DB each time (immediate effect of permission changes is handled by explicit invalidation).
//!
//! JDBC mapping notes (see `komga_db::dao::session`): the row mirrors
//! `JdbcIndexedSessionRepository` — distinct `PRIMARY_ID`/`SESSION_ID` UUIDs,
//! millis timestamps, interval in seconds, `EXPIRY_TIME = last access + interval`.
//! `PRINCIPAL_NAME` holds the kmrs user id rather than Java's login email: kmrs
//! invalidation and the actuator `?username=` filter both key off the user id and
//! resolve the email lazily, so observable behavior is identical across backends.
//! A session row without a kmrs payload (e.g. written by Java komga) reads as an
//! unknown session and the user re-authenticates.

use komga_db::dao::session::SessionDao;
use komga_db::pool::Database;
use moka::sync::Cache;
use std::time::Duration;

pub const SESSION_COOKIE_NAME: &str = "KOMGA-SESSION";
pub const SESSION_HEADER_NAME: &str = "X-Auth-Token";

/// Set once an API-key authentication replaces the session's security context
/// (Java stores the `ApiKeyAuthenticationToken`, whose name is the masked key hash, in the session).
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct SessionApiKey {
    pub id: String,
    pub hash: String,
}

#[derive(Clone)]
pub struct SessionData {
    pub user_id: String,
    pub api_key: Option<SessionApiKey>,
    /// Epoch millis; tracked for the actuator `/actuator/sessions` descriptors.
    pub created_at: u64,
    pub last_accessed_at: u64,
}

/// The security-context payload persisted in `SPRING_SESSION_ATTRIBUTES`.
#[derive(serde::Serialize, serde::Deserialize)]
struct SessionPayload {
    user_id: String,
    api_key: Option<SessionApiKey>,
}

impl SessionPayload {
    fn encode(user_id: &str, api_key: Option<&SessionApiKey>) -> Vec<u8> {
        serde_json::to_vec(&SessionPayload {
            user_id: user_id.to_string(),
            api_key: api_key.cloned(),
        })
        .expect("session payload serializes")
    }

    fn decode(bytes: &[u8]) -> Option<Self> {
        serde_json::from_slice(bytes).ok()
    }
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn timeout_secs(timeout: Duration) -> i64 {
    timeout.as_secs().min(i64::MAX as u64) as i64
}

enum StoreInner {
    Memory { cache: Cache<String, SessionData> },
    Jdbc { dao: SessionDao, timeout: Duration },
}

#[derive(Clone)]
pub struct SessionStore {
    inner: std::sync::Arc<StoreInner>,
}

impl SessionStore {
    pub fn new(timeout: Duration) -> Self {
        Self {
            // sliding expiration (time_to_idle = expire after access)
            inner: std::sync::Arc::new(StoreInner::Memory {
                cache: Cache::builder().time_to_idle(timeout).build(),
            }),
        }
    }

    /// JDBC backend over `sessions.sqlite`, used when `jdbc-session-enabled=true`.
    pub fn jdbc(db: Database, timeout: Duration) -> Self {
        Self {
            inner: std::sync::Arc::new(StoreInner::Jdbc {
                dao: SessionDao::new(db),
                timeout,
            }),
        }
    }

    pub fn create(&self, user_id: &str) -> String {
        match &*self.inner {
            StoreInner::Memory { cache } => {
                let id = uuid::Uuid::new_v4().to_string();
                let now = now_millis();
                cache.insert(
                    id.clone(),
                    SessionData {
                        user_id: user_id.to_string(),
                        api_key: None,
                        created_at: now,
                        last_accessed_at: now,
                    },
                );
                id
            }
            StoreInner::Jdbc { dao, timeout } => {
                let id = uuid::Uuid::new_v4().to_string();
                let primary_id = uuid::Uuid::new_v4().to_string();
                let now = now_millis() as i64;
                dao.insert(
                    &primary_id,
                    &id,
                    now,
                    timeout_secs(*timeout),
                    user_id,
                    &SessionPayload::encode(user_id, None),
                )
                .expect("insert session");
                id
            }
        }
    }

    pub fn get(&self, id: &str) -> Option<SessionData> {
        match &*self.inner {
            StoreInner::Memory { cache } => {
                let data = cache.get(id)?;
                let mut data = data;
                data.last_accessed_at = now_millis();
                cache.insert(id.to_string(), data.clone());
                Some(data)
            }
            // `findById`: an expired row is deleted and reads as missing, a live
            // one has its sliding expiration refreshed.
            StoreInner::Jdbc { dao, timeout } => {
                let row = dao.find_by_id(id).expect("load session")?;
                let now = now_millis() as i64;
                if row.is_expired(now) {
                    dao.delete_by_id(id).expect("delete expired session");
                    return None;
                }
                let payload = row.payload.as_deref().and_then(SessionPayload::decode)?;
                dao.touch(id, now, timeout_secs(*timeout))
                    .expect("refresh session");
                Some(SessionData {
                    user_id: payload.user_id,
                    api_key: payload.api_key,
                    created_at: row.created_at as u64,
                    last_accessed_at: now as u64,
                })
            }
        }
    }

    /// All live sessions, for the actuator `/actuator/sessions` listing.
    pub fn all(&self) -> Vec<(String, SessionData)> {
        match &*self.inner {
            StoreInner::Memory { cache } => cache.iter().map(|(k, v)| ((*k).clone(), v)).collect(),
            StoreInner::Jdbc { dao, .. } => dao
                .list_live(now_millis() as i64)
                .expect("list sessions")
                .into_iter()
                .filter_map(|row| {
                    let payload = row.payload.as_deref().and_then(SessionPayload::decode)?;
                    Some((
                        row.id,
                        SessionData {
                            user_id: payload.user_id,
                            api_key: payload.api_key,
                            created_at: row.created_at as u64,
                            last_accessed_at: row.last_accessed_at as u64,
                        },
                    ))
                })
                .collect(),
        }
    }

    /// Replaces the session's identity with the API-key authentication, like Spring's
    /// `SecurityContextRepository` saving the new context. Unknown session ids are ignored:
    /// the caller creates the session first when the request had none.
    pub fn mark_api_key(&self, id: &str, user_id: &str, key_id: &str, key_hash: &str) {
        match &*self.inner {
            StoreInner::Memory { cache } => {
                if let Some(existing) = cache.get(id) {
                    cache.insert(
                        id.to_string(),
                        SessionData {
                            user_id: user_id.to_string(),
                            api_key: Some(SessionApiKey {
                                id: key_id.to_string(),
                                hash: key_hash.to_string(),
                            }),
                            created_at: existing.created_at,
                            last_accessed_at: now_millis(),
                        },
                    );
                }
            }
            StoreInner::Jdbc { dao, timeout } => {
                let now = now_millis() as i64;
                if let Some(row) = dao.find_by_id(id).expect("load session") {
                    if row.is_expired(now) {
                        dao.delete_by_id(id).expect("delete expired session");
                        return;
                    }
                    let api_key = SessionApiKey {
                        id: key_id.to_string(),
                        hash: key_hash.to_string(),
                    };
                    dao.update_identity(
                        &row.primary_id,
                        now,
                        timeout_secs(*timeout),
                        key_hash,
                        &SessionPayload::encode(user_id, Some(&api_key)),
                    )
                    .expect("mark session api key");
                }
            }
        }
    }

    pub fn invalidate(&self, id: &str) {
        match &*self.inner {
            StoreInner::Memory { cache } => cache.invalidate(id),
            StoreInner::Jdbc { dao, .. } => dao.delete_by_id(id).expect("delete session"),
        }
    }

    /// Invalidates all sessions of a user (on password change / permission change / user deletion).
    pub fn invalidate_user(&self, user_id: &str) {
        match &*self.inner {
            StoreInner::Memory { cache } => {
                let ids: Vec<String> = cache
                    .iter()
                    .filter(|(_, v)| v.user_id == user_id)
                    .map(|(k, _)| (*k).clone())
                    .collect();
                for id in ids {
                    cache.invalidate(&id);
                }
            }
            StoreInner::Jdbc { dao, .. } => {
                // like the memory backend, invalidation keys off the stored user
                // id — not the PRINCIPAL_NAME column, which holds the API-key
                // hash once the session context was replaced by API-key auth.
                let ids: Vec<String> = dao
                    .list_live(now_millis() as i64)
                    .expect("list sessions")
                    .into_iter()
                    .filter(|row| {
                        row.payload
                            .as_deref()
                            .and_then(SessionPayload::decode)
                            .is_some_and(|p| p.user_id == user_id)
                    })
                    .map(|row| row.id)
                    .collect();
                for id in ids {
                    dao.delete_by_id(&id).expect("delete user session");
                }
            }
        }
    }

    /// Hourly expired-session cleanup (Java's `cleanup-cron: "0 0 * * * *"`); a
    /// no-op for the memory backend, whose cache evicts idle entries itself.
    /// Returns the number of rows removed.
    pub fn cleanup_expired(&self) -> u64 {
        match &*self.inner {
            StoreInner::Memory { .. } => 0,
            StoreInner::Jdbc { dao, .. } => dao
                .delete_expired(now_millis() as i64)
                .expect("cleanup expired sessions"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_store() -> SessionStore {
        SessionStore::new(Duration::from_secs(60))
    }

    fn jdbc_store() -> SessionStore {
        let db = Database::open_in_memory(false).unwrap();
        let migrations = komga_db::sessions_migrations();
        komga_db::Migrator::new(&migrations, komga_db::Placeholders::default())
            .migrate(&db.rw().unwrap())
            .unwrap();
        SessionStore::jdbc(db, Duration::from_secs(60))
    }

    fn mark_api_key_replaces_identity_and_ignores_unknown_sessions(store: &SessionStore) {
        store.mark_api_key("ghost", "u1", "k1", "h1");
        assert!(store.get("ghost").is_none());

        let id = store.create("u1");
        store.mark_api_key(&id, "u2", "k1", "h1");
        let session = store.get(&id).unwrap();
        assert_eq!(session.user_id, "u2");
        let key = session.api_key.unwrap();
        assert_eq!(key.id, "k1");
        assert_eq!(key.hash, "h1");

        store.invalidate_user("u2");
        assert!(store.get(&id).is_none());
    }

    #[test]
    fn memory_mark_api_key_replaces_identity_and_ignores_unknown_sessions() {
        mark_api_key_replaces_identity_and_ignores_unknown_sessions(&memory_store());
    }

    #[test]
    fn jdbc_mark_api_key_replaces_identity_and_ignores_unknown_sessions() {
        mark_api_key_replaces_identity_and_ignores_unknown_sessions(&jdbc_store());
    }

    fn lifecycle_round_trip(store: &SessionStore) {
        // create + get refreshes the sliding expiration
        let id = store.create("u1");
        let first = store.get(&id).unwrap();
        assert_eq!(first.user_id, "u1");
        assert!(first.api_key.is_none());
        assert!(first.created_at > 0);
        assert!(first.last_accessed_at >= first.created_at);
        assert_eq!(store.get(&id).unwrap().user_id, "u1");

        // invalidate kills the session
        store.invalidate(&id);
        assert!(store.get(&id).is_none());
        store.invalidate(&id); // idempotent

        // all() lists live sessions
        let a = store.create("u1");
        let b = store.create("u2");
        let mut ids: Vec<String> = store.all().iter().map(|(id, _)| id.clone()).collect();
        ids.sort();
        let mut expected = vec![a, b];
        expected.sort();
        assert_eq!(ids, expected);
    }

    #[test]
    fn memory_lifecycle_round_trip() {
        lifecycle_round_trip(&memory_store());
    }

    #[test]
    fn jdbc_lifecycle_round_trip() {
        lifecycle_round_trip(&jdbc_store());
    }

    #[test]
    fn jdbc_sessions_survive_store_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("sessions.sqlite");
        let config = komga_db::pool::DatabaseConfig {
            file: file.clone(),
            ..Default::default()
        };
        let open = || {
            let db = Database::open(&config).unwrap();
            let migrations = komga_db::sessions_migrations();
            komga_db::Migrator::new(&migrations, komga_db::Placeholders::default())
                .migrate(&db.rw().unwrap())
                .unwrap();
            SessionStore::jdbc(db, Duration::from_secs(60))
        };

        let store = open();
        let id = store.create("u1");
        store.mark_api_key(&id, "u1", "k1", "h1");
        drop(store);

        // a new store over the same file sees the session, with its identity mark
        let store = open();
        let session = store.get(&id).unwrap();
        assert_eq!(session.user_id, "u1");
        assert_eq!(session.api_key.unwrap().hash, "h1");
    }

    #[test]
    fn jdbc_expired_sessions_read_as_missing_and_are_cleaned_up() {
        let db = Database::open_in_memory(false).unwrap();
        let migrations = komga_db::sessions_migrations();
        komga_db::Migrator::new(&migrations, komga_db::Placeholders::default())
            .migrate(&db.rw().unwrap())
            .unwrap();
        // a 1ns timeout expires the session before the next read
        let store = SessionStore::jdbc(db.clone(), Duration::from_nanos(1));
        let id = store.create("u1");
        assert!(store.get(&id).is_none());
        // the expired row is gone (deleted on read); cleanup finds nothing
        assert_eq!(store.cleanup_expired(), 0);
        assert!(store.all().is_empty());

        // an expired row never read is removed by the hourly cleanup instead
        let dao = komga_db::dao::session::SessionDao::new(db);
        let past = now_millis() as i64 - 60_000;
        dao.insert(
            &uuid::Uuid::new_v4().to_string(),
            "stale",
            past,
            30,
            "u1",
            &SessionPayload::encode("u1", None),
        )
        .unwrap();
        assert_eq!(store.cleanup_expired(), 1);
        assert!(store.all().is_empty());
        assert_eq!(store.cleanup_expired(), 0);
    }
}
