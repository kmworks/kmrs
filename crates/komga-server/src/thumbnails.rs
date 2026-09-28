//! Optional file storage for book/series thumbnails (`thumbnails.storage = "file"`,
//! kmrs enhancement; Java always keeps blobs in the DB). Files live under
//! `<config-dir>/thumbnails/<kind>/<id[0..2]>/<id><ext>`; the row then carries only the
//! file URL, which the existing read path (blob first, URL fallback) already serves.

use crate::config::ThumbnailStorage;
use crate::state::AppState;
use komga_core::model::thumbnail::{ThumbnailBook, ThumbnailSeries};
use komga_db::dao::thumbnail::{ThumbnailBookDao, ThumbnailSeriesDao};
use komga_db::dao::thumbnail_migration::ThumbnailMigrationDao;
use komga_media::scanner::path_to_url;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

const MIGRATION_BATCH_SIZE: u32 = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThumbnailKind {
    Book,
    Series,
}

impl ThumbnailKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Book => "book",
            Self::Series => "series",
        }
    }
}

pub fn thumbnails_dir(config_dir: &Path) -> PathBuf {
    config_dir.join("thumbnails")
}

/// Writes thumbnail bytes to `<dir>/<kind>/<id[0..2]>/<id><ext>`: a temp file in the
/// same directory renamed into place, so readers never see a partial file. Returns the
/// file's URL for the row.
pub fn write(
    dir: &Path,
    kind: ThumbnailKind,
    id: &str,
    media_type: &str,
    bytes: &[u8],
) -> std::io::Result<String> {
    let shard_dir = dir.join(kind.as_str()).join(id.get(..2).unwrap_or(id));
    std::fs::create_dir_all(&shard_dir)?;
    let file_name = format!("{id}{}", extension_for(media_type));
    let tmp = shard_dir.join(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, shard_dir.join(&file_name))?;
    Ok(path_to_url(&shard_dir.join(file_name)))
}

fn extension_for(media_type: &str) -> &'static str {
    match media_type {
        "image/jpeg" => ".jpg",
        "image/png" => ".png",
        "image/webp" => ".webp",
        _ => ".img",
    }
}

/// Deletes the file behind `url`, but only when it lives under `dir` — a sidecar URL
/// points into the library and must never be deleted here. A missing file is a no-op.
pub fn remove_url_if_managed(dir: &Path, url: &str) -> std::io::Result<()> {
    let mut prefix = path_to_url(dir);
    if !prefix.ends_with('/') {
        prefix.push('/');
    }
    if !url.starts_with(&prefix) {
        return Ok(());
    }
    let path = komga_core::dto::url_to_file_path(url);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// Best-effort removal of files behind rows that were just replaced or deleted.
/// Failures are logged, not fatal: the daily orphan sweep reclaims anything left behind.
pub fn remove_managed_files<'a>(state: &AppState, urls: impl IntoIterator<Item = &'a str>) {
    if state.config.thumbnail_storage != ThumbnailStorage::File {
        return;
    }
    let dir = thumbnails_dir(&state.config.config_dir);
    for url in urls {
        if let Err(e) = remove_url_if_managed(&dir, url) {
            tracing::warn!("could not remove thumbnail file {url}: {e}");
        }
    }
}

/// Maps a thumbnail-file IO failure into the DB error channel the services speak.
pub fn file_error(e: std::io::Error) -> komga_db::Error {
    komga_db::Error::Db(rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error {
            code: rusqlite::ErrorCode::Unknown,
            extended_code: 0,
        },
        Some(e.to_string()),
    ))
}

/// Field access shared by `ThumbnailBook`/`ThumbnailSeries` for the blob→file migration.
trait BlobThumbnail {
    fn id(&self) -> &str;
    fn media_type(&self) -> &str;
    fn take_blob(&mut self) -> Option<Vec<u8>>;
    fn set_url(&mut self, url: String);
}

impl BlobThumbnail for ThumbnailBook {
    fn id(&self) -> &str {
        &self.id
    }
    fn media_type(&self) -> &str {
        &self.media_type
    }
    fn take_blob(&mut self) -> Option<Vec<u8>> {
        self.thumbnail.take()
    }
    fn set_url(&mut self, url: String) {
        self.url = Some(url);
    }
}

impl BlobThumbnail for ThumbnailSeries {
    fn id(&self) -> &str {
        &self.id
    }
    fn media_type(&self) -> &str {
        &self.media_type
    }
    fn take_blob(&mut self) -> Option<Vec<u8>> {
        self.thumbnail.take()
    }
    fn set_url(&mut self, url: String) {
        self.url = Some(url);
    }
}

/// One-time migration of existing blob thumbnails to files, run at startup when
/// `thumbnails.storage = "file"`. Each kind is marker-gated in kmrs.sqlite so an
/// interrupted run resumes instead of restarting; a row whose file cannot be written
/// keeps its blob (still readable) and is logged.
pub fn migrate_blobs_to_files(state: &AppState) -> komga_db::Result<()> {
    let dir = thumbnails_dir(&state.config.config_dir);
    let markers = ThumbnailMigrationDao::new(state.kmrs_db.clone());
    let mut migrated_total = 0u64;
    for kind in [ThumbnailKind::Book, ThumbnailKind::Series] {
        if markers.is_done(kind.as_str())? {
            continue;
        }
        let migrated = match kind {
            ThumbnailKind::Book => migrate_kind(
                &dir,
                kind,
                &markers,
                |after, limit| {
                    ThumbnailBookDao::new(state.task_db.clone()).find_with_blob_batch(after, limit)
                },
                |thumbnail| ThumbnailBookDao::new(state.task_db.clone()).update(thumbnail),
            )?,
            ThumbnailKind::Series => migrate_kind(
                &dir,
                kind,
                &markers,
                |after, limit| {
                    ThumbnailSeriesDao::new(state.task_db.clone())
                        .find_with_blob_batch(after, limit)
                },
                |thumbnail| ThumbnailSeriesDao::new(state.task_db.clone()).update(thumbnail),
            )?,
        };
        migrated_total += migrated;
        tracing::info!("migrated {migrated} {} thumbnails to files", kind.as_str());
    }
    if migrated_total > 0 {
        // reclaim the blob space the migration just freed; failure only costs disk space
        if let Err(e) = state.task_db.rw().execute_batch("VACUUM") {
            tracing::warn!("could not VACUUM the main database after the thumbnail migration: {e}");
        }
    }
    Ok(())
}

fn migrate_kind<T: BlobThumbnail>(
    dir: &Path,
    kind: ThumbnailKind,
    markers: &ThumbnailMigrationDao,
    fetch: impl Fn(i64, u32) -> komga_db::Result<Vec<(i64, T)>>,
    update: impl Fn(&T) -> komga_db::Result<()>,
) -> komga_db::Result<u64> {
    let mut migrated = 0u64;
    let mut after_rowid = 0i64;
    loop {
        let batch = fetch(after_rowid, MIGRATION_BATCH_SIZE)?;
        if batch.is_empty() {
            break;
        }
        for (rowid, mut thumbnail) in batch {
            after_rowid = rowid;
            let Some(bytes) = thumbnail.take_blob() else {
                continue;
            };
            match write(dir, kind, thumbnail.id(), thumbnail.media_type(), &bytes) {
                Ok(url) => {
                    thumbnail.set_url(url);
                    update(&thumbnail)?;
                    migrated += 1;
                }
                Err(e) => tracing::warn!(
                    "could not migrate {} thumbnail {} to a file, keeping the blob: {e}",
                    kind.as_str(),
                    thumbnail.id()
                ),
            }
        }
    }
    markers.mark_done(kind.as_str())?;
    Ok(migrated)
}

/// Deletes files under `<dir>/book` and `<dir>/series` that no THUMBNAIL_BOOK /
/// THUMBNAIL_SERIES row references (a row deleted without removing its file leaves an
/// orphan behind). Runs in both storage modes; missing directories are a no-op.
pub fn sweep_orphan_files(state: &AppState) -> komga_db::Result<usize> {
    let mut referenced: HashSet<String> = HashSet::new();
    referenced.extend(ThumbnailBookDao::new(state.task_db.clone()).all_urls()?);
    referenced.extend(ThumbnailSeriesDao::new(state.task_db.clone()).all_urls()?);
    let dir = thumbnails_dir(&state.config.config_dir);
    let mut removed = 0usize;
    for kind in [ThumbnailKind::Book, ThumbnailKind::Series] {
        let Ok(shards) = std::fs::read_dir(dir.join(kind.as_str())) else {
            continue;
        };
        for shard in shards.flatten() {
            let Ok(files) = std::fs::read_dir(shard.path()) else {
                continue;
            };
            for file in files.flatten() {
                if !file.file_type().is_ok_and(|t| t.is_file()) {
                    continue;
                }
                let path = file.path();
                if !referenced.contains(&path_to_url(&path)) {
                    match std::fs::remove_file(&path) {
                        Ok(()) => {
                            removed += 1;
                            tracing::debug!("removed orphaned thumbnail file {}", path.display());
                        }
                        Err(e) => tracing::warn!(
                            "could not remove orphaned thumbnail file {}: {e}",
                            path.display()
                        ),
                    }
                }
            }
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ThumbnailStorage;
    use crate::service::series::create_series;
    use crate::service::series::tests as series_tests;
    use komga_core::model::thumbnail::{Dimension, ThumbnailType};
    use komga_core::time_codec::now_utc;
    use std::path::PathBuf;

    fn file_state() -> AppState {
        crate::state::test_state_with_thumbnail_storage(
            series_tests::test_state(),
            ThumbnailStorage::File,
        )
    }

    fn file_path(url: &str) -> PathBuf {
        PathBuf::from(komga_core::dto::url_to_file_path(url))
    }

    #[test]
    fn write_lands_at_deterministic_path_and_url_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let url = write(
            dir.path(),
            ThumbnailKind::Book,
            "0123456789abc",
            "image/jpeg",
            b"jpeg-bytes",
        )
        .unwrap();
        let expected = dir.path().join("book").join("01").join("0123456789abc.jpg");
        assert_eq!(std::fs::read(&expected).unwrap(), b"jpeg-bytes");
        assert_eq!(url, path_to_url(&expected));
        assert_eq!(file_path(&url), expected);

        for (media_type, ext) in [
            ("image/png", ".png"),
            ("image/webp", ".webp"),
            ("image/gif", ".img"),
        ] {
            let url = write(dir.path(), ThumbnailKind::Series, "abc", media_type, b"x").unwrap();
            assert!(url.ends_with(ext), "{url} should end with {ext}");
        }
    }

    #[test]
    fn remove_url_if_managed_only_deletes_inside_the_dir() {
        let dir = tempfile::tempdir().unwrap();
        let url = write(dir.path(), ThumbnailKind::Book, "abc", "image/png", b"x").unwrap();

        // a URL outside the thumbnails dir is refused, the file survives
        let outside = tempfile::tempdir().unwrap();
        let outside_file = outside.path().join("cover.jpg");
        std::fs::write(&outside_file, b"library sidecar").unwrap();
        remove_url_if_managed(dir.path(), &path_to_url(&outside_file)).unwrap();
        assert!(outside_file.exists());

        let managed = file_path(&url);
        remove_url_if_managed(dir.path(), &url).unwrap();
        assert!(!managed.exists());
        // a missing file is not an error
        remove_url_if_managed(dir.path(), &url).unwrap();
    }

    #[test]
    fn migrate_blobs_to_files_flips_rows_and_is_idempotent() {
        let state = file_state();
        series_tests::seed_library(&state.db, "lib1");
        let series = create_series(&state, &series_tests::sample_series("lib1", "S")).unwrap();
        let book = series_tests::insert_book_with_media(&state, &series, "v01", 1);
        let book_dao = ThumbnailBookDao::new(state.db.clone());
        let series_dao = ThumbnailSeriesDao::new(state.db.clone());

        let book_blob_id = book_dao
            .insert(&ThumbnailBook {
                id: String::new(),
                book_id: book.id.clone(),
                thumbnail: Some(vec![1, 2, 3]),
                url: None,
                selected: true,
                type_: ThumbnailType::Generated,
                media_type: "image/jpeg".into(),
                file_size: 3,
                dimension: Dimension {
                    width: 1,
                    height: 1,
                },
                created_date: now_utc(),
                last_modified_date: now_utc(),
            })
            .unwrap();
        let book_sidecar_id = book_dao
            .insert(&ThumbnailBook {
                id: String::new(),
                book_id: book.id.clone(),
                thumbnail: None,
                url: Some("file:/library/cover.jpg".into()),
                selected: false,
                type_: ThumbnailType::Sidecar,
                media_type: "image/jpeg".into(),
                file_size: 3,
                dimension: Dimension {
                    width: 1,
                    height: 1,
                },
                created_date: now_utc(),
                last_modified_date: now_utc(),
            })
            .unwrap();
        let series_blob_id = series_dao
            .insert(&ThumbnailSeries {
                id: String::new(),
                series_id: series.id.clone(),
                thumbnail: Some(vec![9, 9]),
                url: None,
                selected: true,
                type_: ThumbnailType::UserUploaded,
                media_type: "image/png".into(),
                file_size: 2,
                dimension: Dimension {
                    width: 1,
                    height: 1,
                },
                created_date: now_utc(),
                last_modified_date: now_utc(),
            })
            .unwrap();

        migrate_blobs_to_files(&state).unwrap();

        let dir = thumbnails_dir(&state.config.config_dir);
        let book_row = book_dao.find_by_id(&book_blob_id).unwrap().unwrap();
        assert!(book_row.thumbnail.is_none());
        let book_file = file_path(book_row.url.as_ref().unwrap());
        assert_eq!(std::fs::read(&book_file).unwrap(), vec![1, 2, 3]);
        assert!(book_file.starts_with(dir.join("book")));
        assert!(book_file.ends_with(format!("{book_blob_id}.jpg")));

        let series_row = series_dao.find_by_id(&series_blob_id).unwrap().unwrap();
        assert!(series_row.thumbnail.is_none());
        let series_file = file_path(series_row.url.as_ref().unwrap());
        assert_eq!(std::fs::read(&series_file).unwrap(), vec![9, 9]);
        assert!(series_file.starts_with(dir.join("series")));
        assert!(series_file.ends_with(format!("{series_blob_id}.png")));

        // the sidecar row (URL-only) is not a blob row and stays untouched
        let sidecar_row = book_dao.find_by_id(&book_sidecar_id).unwrap().unwrap();
        assert_eq!(sidecar_row.url.as_deref(), Some("file:/library/cover.jpg"));
        assert!(sidecar_row.thumbnail.is_none());

        let markers = ThumbnailMigrationDao::new(state.kmrs_db.clone());
        assert!(markers.is_done("book").unwrap());
        assert!(markers.is_done("series").unwrap());

        // a second run is a no-op (markers done, nothing left to migrate)
        migrate_blobs_to_files(&state).unwrap();
        let book_row = book_dao.find_by_id(&book_blob_id).unwrap().unwrap();
        assert!(book_row.thumbnail.is_none());
        assert_eq!(std::fs::read(&book_file).unwrap(), vec![1, 2, 3]);
    }

    #[test]
    fn sweep_removes_orphans_and_keeps_referenced_files() {
        let state = file_state();
        series_tests::seed_library(&state.db, "lib1");
        let series = create_series(&state, &series_tests::sample_series("lib1", "S")).unwrap();
        let book = series_tests::insert_book_with_media(&state, &series, "v01", 1);
        let dir = thumbnails_dir(&state.config.config_dir);

        // a file a thumbnail row points at survives
        let referenced_url =
            write(&dir, ThumbnailKind::Book, "ref1", "image/png", b"keep").unwrap();
        ThumbnailBookDao::new(state.db.clone())
            .insert(&ThumbnailBook {
                id: String::new(),
                book_id: book.id.clone(),
                thumbnail: None,
                url: Some(referenced_url.clone()),
                selected: false,
                type_: ThumbnailType::Sidecar,
                media_type: "image/png".into(),
                file_size: 4,
                dimension: Dimension {
                    width: 1,
                    height: 1,
                },
                created_date: now_utc(),
                last_modified_date: now_utc(),
            })
            .unwrap();
        // no row points at this one
        let orphan_url = write(
            &dir,
            ThumbnailKind::Series,
            "orphan1",
            "image/jpeg",
            b"gone",
        )
        .unwrap();
        // a sidecar file outside the thumbnails dir is never touched
        let outside = state.config.config_dir.join("library-cover.jpg");
        std::fs::write(&outside, b"library").unwrap();

        let removed = sweep_orphan_files(&state).unwrap();
        assert_eq!(removed, 1);
        assert!(file_path(&referenced_url).exists());
        assert!(!file_path(&orphan_url).exists());
        assert!(outside.exists());
    }

    #[test]
    fn sweep_without_a_thumbnails_dir_is_a_no_op() {
        let state = file_state();
        assert_eq!(sweep_orphan_files(&state).unwrap(), 0);
    }
}
