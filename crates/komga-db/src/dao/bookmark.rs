//! User-owned EPUB bookmarks in kmrs.sqlite.
use crate::{pool::Database, Result};
use komga_core::dto::bookmark::{EpubBookmark, EpubBookmarkLocation};

pub struct BookmarkDao {
    db: Database,
}

impl BookmarkDao {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    pub fn list(&self, user_id: &str, book_id: &str) -> Result<Vec<EpubBookmark>> {
        let conn = self.db.ro()?;
        let mut stmt = conn
            .prepare("SELECT ID, LOCATION FROM EPUB_BOOKMARK WHERE USER_ID = ? AND BOOK_ID = ?")?;
        let rows = stmt.query_map([user_id, book_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        let mut bookmarks = Vec::new();
        for row in rows {
            let (id, location) = row?;
            bookmarks.push(EpubBookmark {
                id,
                book_id: book_id.into(),
                location: serde_json::from_str::<EpubBookmarkLocation>(&location)
                    .map_err(std::io::Error::other)?,
            });
        }
        bookmarks.sort_by(|a, b| {
            a.location
                .chapter_index
                .cmp(&b.location.chapter_index)
                .then_with(|| {
                    a.location
                        .chapter_fraction
                        .total_cmp(&b.location.chapter_fraction)
                })
                .then_with(|| a.id.cmp(&b.id))
        });
        Ok(bookmarks)
    }

    pub fn save(&self, user_id: &str, bookmark: &EpubBookmark) -> Result<()> {
        self.db.rw()?.execute(
            "INSERT INTO EPUB_BOOKMARK (USER_ID, BOOK_ID, ID, LOCATION) VALUES (?, ?, ?, ?) ON CONFLICT (USER_ID, BOOK_ID, ID) DO UPDATE SET LOCATION = excluded.LOCATION",
            rusqlite::params![user_id, bookmark.book_id, bookmark.id, serde_json::to_string(&bookmark.location).map_err(std::io::Error::other)?],
        )?;
        Ok(())
    }

    pub fn delete(&self, user_id: &str, book_id: &str, id: &str) -> Result<()> {
        self.db.rw()?.execute(
            "DELETE FROM EPUB_BOOKMARK WHERE USER_ID = ? AND BOOK_ID = ? AND ID = ?",
            [user_id, book_id, id],
        )?;
        Ok(())
    }

    pub fn delete_by_user(&self, user_id: &str) -> Result<()> {
        self.db
            .rw()?
            .execute("DELETE FROM EPUB_BOOKMARK WHERE USER_ID = ?", [user_id])?;
        Ok(())
    }

    pub fn delete_by_books(&self, book_ids: &[String]) -> Result<()> {
        let mut conn = self.db.rw()?;
        let tx = conn.transaction()?;
        for id in book_ids {
            tx.execute("DELETE FROM EPUB_BOOKMARK WHERE BOOK_ID = ?", [id])?;
        }
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Migrator, Placeholders};

    #[test]
    fn bookmarks_sort_replace_and_cleanup_by_owner_or_book() {
        let db = Database::open_in_memory(false).unwrap();
        Migrator::new(&crate::kmrs_migrations(), Placeholders::default())
            .migrate(&db.rw().unwrap())
            .unwrap();
        let dao = BookmarkDao::new(db);
        let mut bookmark = EpubBookmark {
            id: "first".into(),
            book_id: "book".into(),
            location: EpubBookmarkLocation {
                chapter_index: 2,
                chapter_href: "chapter.xhtml".into(),
                chapter_fraction: 0.5,
                total_progression: 0.5,
                chapter_title: None,
                created_at: time::OffsetDateTime::now_utc(),
            },
        };
        dao.save("a", &bookmark).unwrap();
        dao.save("b", &bookmark).unwrap();
        bookmark.id = "second".into();
        bookmark.location.chapter_index = 1;
        dao.save("a", &bookmark).unwrap();
        assert_eq!(
            dao.list("a", "book")
                .unwrap()
                .iter()
                .map(|b| b.id.as_str())
                .collect::<Vec<_>>(),
            ["second", "first"]
        );
        bookmark.location.chapter_title = Some("Updated".into());
        dao.save("a", &bookmark).unwrap();
        let saved = dao.list("a", "book").unwrap();
        assert_eq!(saved.len(), 2);
        assert_eq!(saved[0].location.chapter_title.as_deref(), Some("Updated"));
        dao.delete_by_user("a").unwrap();
        assert!(dao.list("a", "book").unwrap().is_empty());
        assert_eq!(dao.list("b", "book").unwrap().len(), 1);
        bookmark.book_id = "other".into();
        dao.save("b", &bookmark).unwrap();
        dao.delete_by_books(&["book".into()]).unwrap();
        assert!(dao.list("b", "book").unwrap().is_empty());
        assert_eq!(dao.list("b", "other").unwrap().len(), 1);
    }
}
