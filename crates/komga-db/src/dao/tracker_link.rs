//! The `TRACKER_LINK` table in the separate `kmrs.sqlite` database: which
//! platform entry (per provider) tracks a komga series for one user. Komga has
//! no tracker concept, so this mapping is kmrs-private state. OAuth tokens and
//! the linked-entry ledger use their own tables in the same database.

use crate::pool::Database;
use crate::Result;
use komga_core::time_codec;
use komga_core::tracker::TrackMode;
use rusqlite::Row;
use std::collections::BTreeMap;
use time::OffsetDateTime;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrackerLink {
    pub series_id: String,
    pub user_id: String,
    pub provider: String,
    pub track_id: String,
    pub title: Option<String>,
    pub track_mode: TrackMode,
    pub chapter_offset: i32,
    pub created_date: OffsetDateTime,
    pub last_modified_date: OffsetDateTime,
}

/// A binding to create or replace an existing one for the same
/// (series, user, provider).
#[derive(Debug, Clone)]
pub struct NewTrackerLink<'a> {
    pub series_id: &'a str,
    pub user_id: &'a str,
    pub provider: &'a str,
    pub track_id: &'a str,
    pub title: Option<&'a str>,
    pub track_mode: TrackMode,
    pub chapter_offset: i32,
}

#[derive(Debug)]
pub struct TrackerLinkGroup {
    pub series_id: String,
    pub links: Vec<TrackerLink>,
}

#[derive(Debug)]
pub struct TrackerLinkPage {
    pub groups: Vec<TrackerLinkGroup>,
    pub total: u64,
    pub series_count: u64,
    pub provider_counts: BTreeMap<String, u64>,
}

pub struct TrackerLinkDao {
    db: Database,
}

const COLUMNS: &str = "SERIES_ID, USER_ID, PROVIDER, TRACK_ID, TITLE, TRACK_MODE, \
                       CHAPTER_OFFSET, CREATED_DATE, LAST_MODIFIED_DATE";

fn track_mode_from_column(row: &Row<'_>, idx: usize) -> rusqlite::Result<TrackMode> {
    let s: String = row.get(idx)?;
    TrackMode::parse(&s).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            idx,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("invalid TRACK_MODE '{s}'"),
            )),
        )
    })
}

fn row_to_link(row: &Row<'_>) -> rusqlite::Result<TrackerLink> {
    Ok(TrackerLink {
        series_id: row.get(0)?,
        user_id: row.get(1)?,
        provider: row.get(2)?,
        track_id: row.get(3)?,
        title: row.get(4)?,
        track_mode: track_mode_from_column(row, 5)?,
        chapter_offset: row.get(6)?,
        created_date: super::get_datetime(row, 7)?,
        last_modified_date: super::get_datetime(row, 8)?,
    })
}

impl TrackerLinkDao {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    pub fn list_by_series_and_user(
        &self,
        series_id: &str,
        user_id: &str,
    ) -> Result<Vec<TrackerLink>> {
        let conn = self.db.ro()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS} FROM TRACKER_LINK WHERE SERIES_ID = ? AND USER_ID = ? \
             ORDER BY PROVIDER"
        ))?;
        let rows = stmt.query_map(rusqlite::params![series_id, user_id], row_to_link)?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn page_by_user(
        &self,
        user_id: &str,
        provider: Option<&str>,
        limit: Option<u32>,
        offset: u64,
    ) -> Result<TrackerLinkPage> {
        let conn = self.db.ro()?;
        let series_count = conn.query_row(
            "SELECT COUNT(DISTINCT SERIES_ID) FROM TRACKER_LINK WHERE USER_ID = ?",
            [user_id],
            |row| row.get::<_, u64>(0),
        )?;
        let total = if let Some(provider) = provider {
            conn.query_row(
                "SELECT COUNT(DISTINCT SERIES_ID) FROM TRACKER_LINK \
                 WHERE USER_ID = ? AND PROVIDER = ?",
                rusqlite::params![user_id, provider],
                |row| row.get::<_, u64>(0),
            )?
        } else {
            series_count
        };
        let provider_counts = {
            let mut stmt = conn.prepare(
                "SELECT PROVIDER, COUNT(DISTINCT SERIES_ID) FROM TRACKER_LINK \
                 WHERE USER_ID = ? GROUP BY PROVIDER",
            )?;
            let rows = stmt.query_map([user_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?))
            })?;
            rows.collect::<std::result::Result<BTreeMap<_, _>, _>>()?
        };

        let mut sql = "SELECT SERIES_ID FROM TRACKER_LINK \
                       WHERE USER_ID = ?1 AND (?2 IS NULL OR PROVIDER = ?2) \
                       GROUP BY SERIES_ID ORDER BY SERIES_ID"
            .to_string();
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![
            Box::new(user_id.to_string()),
            Box::new(provider.map(str::to_string)),
        ];
        if let Some(limit) = limit {
            sql.push_str(" LIMIT ?3 OFFSET ?4");
            params.push(Box::new(i64::from(limit.max(1))));
            params.push(Box::new(i64::try_from(offset).unwrap_or(i64::MAX)));
        }
        let series_ids = {
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(rusqlite::params_from_iter(params), |row| {
                row.get::<_, String>(0)
            })?;
            rows.collect::<std::result::Result<Vec<_>, _>>()?
        };

        let mut groups: Vec<TrackerLinkGroup> = Vec::new();
        if !series_ids.is_empty() {
            let placeholders = series_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(user_id.to_string())];
            params.extend(
                series_ids
                    .into_iter()
                    .map(|id| Box::new(id) as Box<dyn rusqlite::ToSql>),
            );
            let mut stmt = conn.prepare(&format!(
                "SELECT {COLUMNS} FROM TRACKER_LINK \
                 WHERE USER_ID = ? AND SERIES_ID IN ({placeholders}) \
                 ORDER BY SERIES_ID, PROVIDER"
            ))?;
            let rows = stmt.query_map(rusqlite::params_from_iter(params), row_to_link)?;
            let links = rows.collect::<std::result::Result<Vec<_>, _>>()?;
            for link in links {
                match groups.last_mut() {
                    Some(group) if group.series_id == link.series_id => group.links.push(link),
                    _ => groups.push(TrackerLinkGroup {
                        series_id: link.series_id.clone(),
                        links: vec![link],
                    }),
                }
            }
        }

        Ok(TrackerLinkPage {
            groups,
            total,
            series_count,
            provider_counts,
        })
    }

    #[cfg(test)]
    pub fn list_by_user(&self, user_id: &str) -> Result<Vec<TrackerLink>> {
        Ok(self
            .page_by_user(user_id, None, None, 0)?
            .groups
            .into_iter()
            .flat_map(|group| group.links)
            .collect())
    }

    /// Inserts the binding or replaces the target entry and options of an
    /// existing (series, user, provider) binding.
    pub fn upsert(&self, link: &NewTrackerLink<'_>) -> Result<()> {
        let now = time_codec::format_datetime(time_codec::now_utc());
        self.db.rw()?.execute(
            r#"
            INSERT INTO TRACKER_LINK
                (SERIES_ID, USER_ID, PROVIDER, TRACK_ID, TITLE, TRACK_MODE,
                 CHAPTER_OFFSET, CREATED_DATE, LAST_MODIFIED_DATE)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (SERIES_ID, USER_ID, PROVIDER) DO UPDATE SET
                TRACK_ID = excluded.TRACK_ID,
                TITLE = excluded.TITLE,
                TRACK_MODE = excluded.TRACK_MODE,
                CHAPTER_OFFSET = excluded.CHAPTER_OFFSET,
                LAST_MODIFIED_DATE = excluded.LAST_MODIFIED_DATE
            "#,
            rusqlite::params![
                link.series_id,
                link.user_id,
                link.provider,
                link.track_id,
                link.title,
                link.track_mode.as_str(),
                link.chapter_offset,
                now,
                now,
            ],
        )?;
        Ok(())
    }

    /// Removes one binding; deleting a non-existent binding is a no-op.
    pub fn delete(&self, series_id: &str, user_id: &str, provider: &str) -> Result<()> {
        self.db.rw()?.execute(
            "DELETE FROM TRACKER_LINK WHERE SERIES_ID = ? AND USER_ID = ? AND PROVIDER = ?",
            rusqlite::params![series_id, user_id, provider],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Migrator;
    use crate::Placeholders;

    fn test_dao() -> TrackerLinkDao {
        let db = Database::open_in_memory(false).unwrap();
        Migrator::new(&crate::kmrs_migrations(), Placeholders::default())
            .migrate(&db.rw().unwrap())
            .unwrap();
        TrackerLinkDao::new(db)
    }

    fn link<'a>(
        series: &'a str,
        user: &'a str,
        provider: &'a str,
        track_id: &'a str,
    ) -> NewTrackerLink<'a> {
        NewTrackerLink {
            series_id: series,
            user_id: user,
            provider,
            track_id,
            title: None,
            track_mode: TrackMode::Auto,
            chapter_offset: 0,
        }
    }

    #[test]
    fn upsert_lists_and_replaces_per_user_provider() {
        let dao = test_dao();
        dao.upsert(&link("ser-1", "alice", "anilist", "42"))
            .unwrap();
        dao.upsert(&link("ser-1", "alice", "mal", "99")).unwrap();
        dao.upsert(&link("ser-1", "bob", "anilist", "7")).unwrap();

        let alice = dao.list_by_series_and_user("ser-1", "alice").unwrap();
        assert_eq!(alice.len(), 2);
        // one series can be tracked on every provider independently
        assert_eq!(
            alice
                .iter()
                .map(|l| l.provider.as_str())
                .collect::<Vec<_>>(),
            vec!["anilist", "mal"]
        );
        // per-user isolation
        assert_eq!(
            dao.list_by_series_and_user("ser-1", "bob").unwrap().len(),
            1
        );
        assert_eq!(
            dao.list_by_series_and_user("ser-2", "alice").unwrap(),
            vec![]
        );

        // replacing the same (series, user, provider) keeps one row
        dao.upsert(&NewTrackerLink {
            title: Some("New Title"),
            track_mode: TrackMode::Volume,
            chapter_offset: -3,
            ..link("ser-1", "alice", "anilist", "43")
        })
        .unwrap();
        let alice = dao.list_by_series_and_user("ser-1", "alice").unwrap();
        assert_eq!(alice.len(), 2);
        let anilist = alice.iter().find(|l| l.provider == "anilist").unwrap();
        assert_eq!(anilist.track_id, "43");
        assert_eq!(anilist.title.as_deref(), Some("New Title"));
        assert_eq!(anilist.track_mode, TrackMode::Volume);
        assert_eq!(anilist.chapter_offset, -3);
    }

    #[test]
    fn page_by_user_spans_series() {
        let dao = test_dao();
        dao.upsert(&link("ser-1", "alice", "anilist", "1")).unwrap();
        dao.upsert(&link("ser-1", "alice", "mal", "2")).unwrap();
        dao.upsert(&link("ser-2", "alice", "bangumi", "3")).unwrap();
        dao.upsert(&link("ser-1", "bob", "anilist", "4")).unwrap();

        let first = dao.page_by_user("alice", None, Some(1), 0).unwrap();
        assert_eq!(first.total, 2);
        assert_eq!(first.series_count, 2);
        assert_eq!(first.groups.len(), 1);
        assert_eq!(first.groups[0].series_id, "ser-1");
        assert_eq!(first.groups[0].links.len(), 2);
        assert_eq!(first.provider_counts["anilist"], 1);
        assert_eq!(first.provider_counts["mal"], 1);
        assert_eq!(first.provider_counts["bangumi"], 1);

        let second = dao.page_by_user("alice", None, Some(1), 1).unwrap();
        assert_eq!(second.groups.len(), 1);
        assert_eq!(second.groups[0].series_id, "ser-2");

        let filtered = dao.page_by_user("alice", Some("anilist"), None, 0).unwrap();
        assert_eq!(filtered.total, 1);
        assert_eq!(filtered.series_count, 2);
        assert_eq!(filtered.groups.len(), 1);
        assert_eq!(filtered.groups[0].series_id, "ser-1");
        assert_eq!(filtered.groups[0].links.len(), 2);
    }

    #[test]
    fn delete_removes_only_the_target_binding() {
        let dao = test_dao();
        dao.upsert(&link("ser-1", "alice", "anilist", "1")).unwrap();
        dao.upsert(&link("ser-1", "alice", "mal", "2")).unwrap();

        dao.delete("ser-1", "alice", "anilist").unwrap();
        let rest = dao.list_by_series_and_user("ser-1", "alice").unwrap();
        assert_eq!(rest.len(), 1);
        assert_eq!(rest[0].provider, "mal");

        // deleting again is a no-op
        dao.delete("ser-1", "alice", "anilist").unwrap();
        assert_eq!(
            dao.list_by_series_and_user("ser-1", "alice").unwrap().len(),
            1
        );
    }
}
