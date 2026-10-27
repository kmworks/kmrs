//! User-visible tracker entries recorded independently of series bindings.

use crate::pool::Database;
use crate::Result;
use komga_core::time_codec;
use komga_core::tracker::TrackLedgerItem;
use rusqlite::Row;

pub struct TrackerLedgerDao {
    db: Database,
}

const COLUMNS: &str = "PROVIDER, TRACK_ID, TITLE, URL, COVER_URL, UPDATED_DATE";

fn row_to_item(row: &Row<'_>) -> rusqlite::Result<TrackLedgerItem> {
    Ok(TrackLedgerItem {
        provider: row.get(0)?,
        track_id: row.get(1)?,
        title: row.get(2)?,
        url: row.get(3)?,
        cover_url: row.get(4)?,
        updated_at: super::get_datetime(row, 5)?.unix_timestamp(),
    })
}

impl TrackerLedgerDao {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    pub fn upsert(
        &self,
        provider: &str,
        user_id: &str,
        track_id: &str,
        title: Option<&str>,
        url: Option<&str>,
        cover_url: Option<&str>,
    ) -> Result<()> {
        self.db.rw()?.execute(
            r#"
            INSERT INTO TRACKER_LEDGER
                (PROVIDER, USER_ID, TRACK_ID, TITLE, URL, COVER_URL, UPDATED_DATE)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (PROVIDER, USER_ID, TRACK_ID) DO UPDATE SET
                TITLE = COALESCE(excluded.TITLE, TRACKER_LEDGER.TITLE),
                URL = excluded.URL,
                COVER_URL = COALESCE(excluded.COVER_URL, TRACKER_LEDGER.COVER_URL),
                UPDATED_DATE = excluded.UPDATED_DATE
            "#,
            rusqlite::params![
                provider,
                user_id,
                track_id,
                title,
                url,
                cover_url,
                time_codec::format_datetime(time_codec::now_utc()),
            ],
        )?;
        Ok(())
    }

    pub fn page_by_user(
        &self,
        user_id: &str,
        limit: Option<u32>,
        offset: u64,
    ) -> Result<(Vec<TrackLedgerItem>, u64)> {
        let conn = self.db.ro()?;
        let total = conn.query_row(
            "SELECT COUNT(*) FROM TRACKER_LEDGER WHERE USER_ID = ?",
            [user_id],
            |row| row.get::<_, u64>(0),
        )?;
        let mut sql = format!(
            "SELECT {COLUMNS} FROM TRACKER_LEDGER WHERE USER_ID = ?1 \
             ORDER BY UPDATED_DATE DESC, PROVIDER, TRACK_ID"
        );
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(user_id.to_string())];
        if let Some(limit) = limit {
            sql.push_str(" LIMIT ?2 OFFSET ?3");
            params.push(Box::new(i64::from(limit.max(1))));
            params.push(Box::new(i64::try_from(offset).unwrap_or(i64::MAX)));
        }
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(params), row_to_item)?;
        let items = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((items, total))
    }

    #[cfg(test)]
    pub fn list_by_user(&self, user_id: &str) -> Result<Vec<TrackLedgerItem>> {
        Ok(self.page_by_user(user_id, None, 0)?.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dao::tracker_link::{NewTrackerLink, TrackerLinkDao};
    use crate::{Migrator, Placeholders};
    use komga_core::tracker::TrackMode;

    fn test_db() -> Database {
        let db = Database::open_in_memory(false).unwrap();
        Migrator::new(&crate::kmrs_migrations(), Placeholders::default())
            .migrate(&db.rw().unwrap())
            .unwrap();
        db
    }

    #[test]
    fn upsert_and_list_are_isolated_per_user_and_provider() {
        let dao = TrackerLedgerDao::new(test_db());
        dao.upsert(
            "anilist",
            "alice",
            "42",
            Some("Alice Title"),
            Some("https://anilist.co/manga/42"),
            None,
        )
        .unwrap();
        dao.upsert("anilist", "bob", "42", Some("Bob Title"), None, None)
            .unwrap();
        dao.upsert("mal", "alice", "42", Some("MAL Title"), None, None)
            .unwrap();

        assert_eq!(dao.list_by_user("alice").unwrap().len(), 2);
        assert_eq!(dao.list_by_user("bob").unwrap().len(), 1);
        assert!(dao.list_by_user("nobody").unwrap().is_empty());

        let (first, total) = dao.page_by_user("alice", Some(1), 0).unwrap();
        assert_eq!(total, 2);
        assert_eq!(first.len(), 1);
        let (second, total) = dao.page_by_user("alice", Some(1), 1).unwrap();
        assert_eq!(total, 2);
        assert_eq!(second.len(), 1);
        assert_ne!(first[0].provider, second[0].provider);

        dao.upsert(
            "anilist",
            "alice",
            "42",
            Some("Updated"),
            Some("https://anilist.co/manga/42"),
            Some("https://img.example/cover.jpg"),
        )
        .unwrap();
        let alice = dao.list_by_user("alice").unwrap();
        assert_eq!(alice.len(), 2);
        let item = alice
            .iter()
            .find(|item| item.provider == "anilist")
            .unwrap();
        assert_eq!(item.title.as_deref(), Some("Updated"));
        assert_eq!(
            item.cover_url.as_deref(),
            Some("https://img.example/cover.jpg")
        );
        assert!(item.updated_at > 0);
    }

    #[test]
    fn upsert_without_display_metadata_preserves_existing_values() {
        let dao = TrackerLedgerDao::new(test_db());
        dao.upsert(
            "anilist",
            "alice",
            "42",
            Some("Title"),
            Some("https://anilist.co/manga/42"),
            Some("https://img.example/cover.jpg"),
        )
        .unwrap();
        dao.upsert(
            "anilist",
            "alice",
            "42",
            None,
            Some("https://anilist.co/manga/42"),
            None,
        )
        .unwrap();

        let items = dao.list_by_user("alice").unwrap();
        assert_eq!(items[0].title.as_deref(), Some("Title"));
        assert_eq!(
            items[0].cover_url.as_deref(),
            Some("https://img.example/cover.jpg")
        );
    }

    #[test]
    fn ledger_does_not_alias_series_bindings() {
        let db = test_db();
        let ledger = TrackerLedgerDao::new(db.clone());
        let links = TrackerLinkDao::new(db);
        ledger
            .upsert("bangumi", "alice", "track-1", Some("Ledger"), None, None)
            .unwrap();
        links
            .upsert(&NewTrackerLink {
                series_id: "series-1",
                user_id: "alice",
                provider: "bangumi",
                track_id: "track-2",
                title: Some("Binding"),
                track_mode: TrackMode::Auto,
                chapter_offset: 0,
            })
            .unwrap();

        let ledger_items = ledger.list_by_user("alice").unwrap();
        assert_eq!(ledger_items.len(), 1);
        assert_eq!(ledger_items[0].track_id, "track-1");
        let bindings = links.list_by_user("alice").unwrap();
        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].track_id, "track-2");
    }

    #[test]
    fn ledger_survives_reopening_kmrs_database() {
        let dir = tempfile::tempdir().unwrap();
        let config = crate::pool::DatabaseConfig {
            file: dir.path().join("kmrs.sqlite"),
            pool_size: Some(1),
            register_udfs: false,
            ..Default::default()
        };
        {
            let db = Database::open(&config).unwrap();
            Migrator::new(&crate::kmrs_migrations(), Placeholders::default())
                .migrate(&db.rw().unwrap())
                .unwrap();
            TrackerLedgerDao::new(db)
                .upsert(
                    "mangabaka",
                    "alice",
                    "42",
                    Some("Persisted"),
                    Some("https://mangabaka.org/42"),
                    None,
                )
                .unwrap();
        }

        let db = Database::open(&config).unwrap();
        Migrator::new(&crate::kmrs_migrations(), Placeholders::default())
            .migrate(&db.rw().unwrap())
            .unwrap();
        let items = TrackerLedgerDao::new(db).list_by_user("alice").unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].provider, "mangabaka");
        assert_eq!(items[0].track_id, "42");
        assert_eq!(items[0].title.as_deref(), Some("Persisted"));
    }
}
