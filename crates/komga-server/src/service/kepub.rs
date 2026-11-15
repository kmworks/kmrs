//! `KepubConverter.kt`: kepubify availability (the `komga.kobo.kepubify-path` config
//! property, probed) and the 5-minute cache of converted files (`KoboController.cachedKepub`).

use crate::config::ServerConfig;
use komga_media::kepubify;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::Duration;

const CACHE_TTL: Duration = Duration::from_secs(5 * 60);

pub struct KepubConverter {
    /// probe results by path string; a path is only probed once, like `configureKepubify`
    probed: RwLock<HashMap<String, Option<PathBuf>>>,
    cache: moka::sync::Cache<String, CacheEntry>,
    /// converted files live in our own temp subdirectory so stale ones can be cleaned at
    /// startup (the Java side relies on `deleteOnExit` instead)
    tmp_dir: PathBuf,
}

#[derive(Clone)]
struct CacheEntry {
    path: PathBuf,
    directory: PathBuf,
}

/// Default converted-files directory; stale files are cleaned at startup (the Java side
/// relies on `deleteOnExit` instead).
pub fn default_tmp_dir() -> PathBuf {
    let dir = std::env::temp_dir().join("kmrs-kepub");
    let _ = std::fs::create_dir_all(&dir);
    for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            let _ = std::fs::remove_dir_all(entry.path());
        } else {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    dir
}

impl KepubConverter {
    pub fn new(tmp_dir: PathBuf) -> Arc<Self> {
        let _ = std::fs::create_dir_all(&tmp_dir);
        let cache = moka::sync::Cache::builder()
            .time_to_idle(CACHE_TTL)
            .eviction_listener(|_key, entry: CacheEntry, _cause| {
                let _ = std::fs::remove_dir_all(entry.directory);
            })
            .build();
        Arc::new(Self {
            probed: RwLock::new(HashMap::new()),
            cache,
            tmp_dir,
        })
    }

    /// Effective kepubify path: the `komga.kobo.kepubify-path` config property, probed
    /// (`configureKepubify`).
    pub fn kepubify_path(&self, config: &ServerConfig) -> Option<PathBuf> {
        config
            .kepubify_path
            .as_deref()
            .and_then(|p| self.probe(&p.to_string_lossy()))
    }

    pub fn is_available(&self, config: &ServerConfig) -> bool {
        self.kepubify_path(config).is_some()
    }

    fn probe(&self, path: &str) -> Option<PathBuf> {
        if let Some(cached) = self.probed.read().unwrap().get(path) {
            return cached.clone();
        }
        let result = kepubify::probe(path);
        self.probed
            .write()
            .unwrap()
            .insert(path.to_string(), result.clone());
        result
    }

    /// `cachedKepub`: Caffeine `expireAfterAccess(5 min)`; evicted temp files are deleted.
    /// A cached path that no longer exists is treated as a miss. Each conversion gets a
    /// fresh directory so parallel conversions of equal source filenames cannot collide.
    pub fn cached_or_convert(
        &self,
        key: &str,
        convert: impl FnOnce(&Path) -> Option<PathBuf>,
    ) -> Option<PathBuf> {
        self.cache
            .entry_by_ref(key)
            .and_try_compute_with(|maybe_entry| {
                if let Some(entry) = maybe_entry {
                    let entry = entry.into_value();
                    if entry.path.is_file() {
                        return Ok(moka::ops::compute::Op::Nop);
                    }
                }
                let directory = self.tmp_dir.join(uuid::Uuid::new_v4().to_string());
                if let Err(e) = std::fs::create_dir_all(&directory) {
                    tracing::warn!(
                        "Could not create kepub conversion directory {}: {e}",
                        directory.display()
                    );
                    return Err(());
                }
                let path = match convert(&directory) {
                    Some(path) => path,
                    None => {
                        let _ = std::fs::remove_dir_all(directory);
                        return Err(());
                    }
                };
                Ok(moka::ops::compute::Op::Put(CacheEntry { path, directory }))
            })
            .ok()
            .and_then(|result| result.into_entry())
            .map(|entry| entry.into_value().path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> ServerConfig {
        ServerConfig::from_env()
    }

    fn executable_script(path: &Path, content: &str) {
        std::fs::write(path, content).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    #[test]
    fn unavailable_without_any_path() {
        let converter = KepubConverter::new(tempfile::tempdir().unwrap().keep());
        assert!(!converter.is_available(&config()));
    }

    #[test]
    fn config_path_is_probed() {
        let dir = tempfile::tempdir().unwrap();
        let valid = dir.path().join("kepubify");
        executable_script(&valid, "#!/bin/sh\nexit 0\n");

        let converter = KepubConverter::new(tempfile::tempdir().unwrap().keep());
        let mut config = config();
        config.kepubify_path = Some(valid.clone());
        assert_eq!(converter.kepubify_path(&config), Some(valid));
        assert!(converter.is_available(&config));

        config.kepubify_path = Some(PathBuf::from("/does/not/exist"));
        assert_eq!(converter.kepubify_path(&config), None);
    }

    #[test]
    fn cached_or_convert_reuses_and_reloads_missing_files() {
        let dir = tempfile::tempdir().unwrap();
        let converter = KepubConverter::new(dir.path().to_path_buf());
        let calls = std::sync::atomic::AtomicUsize::new(0);
        let make = |tmp: &Path| {
            let n = calls.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let path = tmp.join(format!("book-{n}.kepub.epub"));
            std::fs::write(&path, b"x").unwrap();
            Some(path)
        };
        let calls = || calls.load(std::sync::atomic::Ordering::Relaxed);
        let first = converter.cached_or_convert("k1", make).unwrap();
        assert_eq!(calls(), 1);
        let second = converter.cached_or_convert("k1", make).unwrap();
        assert_eq!(first, second);
        assert_eq!(calls(), 1, "cache hit skips conversion");

        // a deleted cached file is a miss
        std::fs::remove_file(&first).unwrap();
        let third = converter.cached_or_convert("k1", make).unwrap();
        assert_eq!(calls(), 2);
        assert!(third.exists());

        assert_ne!(
            first, third,
            "a replacement must not reuse the deleted path"
        );
    }

    #[test]
    fn failed_conversion_is_retried() {
        let dir = tempfile::tempdir().unwrap();
        let converter = KepubConverter::new(dir.path().to_path_buf());
        let calls = std::sync::atomic::AtomicUsize::new(0);

        assert!(converter
            .cached_or_convert("k1", |_| {
                calls.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                None
            })
            .is_none());
        let converted = converter
            .cached_or_convert("k1", |tmp| {
                calls.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let path = tmp.join("book.kepub.epub");
                std::fs::write(&path, b"x").unwrap();
                Some(path)
            })
            .unwrap();

        assert!(converted.exists());
        assert_eq!(calls.load(std::sync::atomic::Ordering::Relaxed), 2);
    }

    #[test]
    fn concurrent_requests_share_one_conversion_per_key() {
        let dir = tempfile::tempdir().unwrap();
        let converter = KepubConverter::new(dir.path().to_path_buf());
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let (second_call_tx, second_call_rx) = std::sync::mpsc::channel();
        let (duplicate_tx, duplicate_rx) = std::sync::mpsc::channel();

        let first = {
            let converter = converter.clone();
            let calls = calls.clone();
            std::thread::spawn(move || {
                converter.cached_or_convert("k1", move |tmp| {
                    calls.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    started_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                    let path = tmp.join("book.kepub.epub");
                    std::fs::write(&path, b"x").unwrap();
                    Some(path)
                })
            })
        };
        started_rx.recv_timeout(Duration::from_secs(2)).unwrap();

        let second = {
            let converter = converter.clone();
            let calls = calls.clone();
            std::thread::spawn(move || {
                second_call_tx.send(()).unwrap();
                converter.cached_or_convert("k1", move |tmp| {
                    calls.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    duplicate_tx.send(()).unwrap();
                    Some(tmp.join("duplicate.kepub.epub"))
                })
            })
        };
        second_call_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let duplicate_started = duplicate_rx
            .recv_timeout(Duration::from_millis(100))
            .is_ok();
        release_tx.send(()).unwrap();

        let first_path = first.join().unwrap().unwrap();
        let second_path = second.join().unwrap().unwrap();
        assert_eq!(first_path, second_path);
        assert!(
            !duplicate_started,
            "a second conversion must not start while the key is in flight"
        );
        assert_eq!(calls.load(std::sync::atomic::Ordering::Relaxed), 1);
    }

    #[test]
    fn missing_cached_file_is_rebuilt_once() {
        let dir = tempfile::tempdir().unwrap();
        let converter = KepubConverter::new(dir.path().to_path_buf());
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let make = |tmp: &Path| {
            let n = calls.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let path = tmp.join("book.kepub.epub");
            std::fs::write(&path, n.to_string()).unwrap();
            Some(path)
        };
        let cached = converter.cached_or_convert("k1", make).unwrap();
        std::fs::remove_file(cached).unwrap();
        let calls_before = calls.load(std::sync::atomic::Ordering::Relaxed);
        let barrier = Arc::new(std::sync::Barrier::new(17));

        let requests: Vec<_> = (0..16)
            .map(|_| {
                let converter = converter.clone();
                let calls = calls.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    converter.cached_or_convert("k1", move |tmp| {
                        let n = calls.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        let path = tmp.join("book.kepub.epub");
                        std::fs::write(&path, n.to_string()).unwrap();
                        Some(path)
                    })
                })
            })
            .collect();
        barrier.wait();

        let paths: Vec<_> = requests
            .into_iter()
            .map(|request| request.join().unwrap().unwrap())
            .collect();
        assert!(paths.iter().all(|path| path == &paths[0]));
        assert!(paths[0].is_file(), "the shared result must not be deleted");
        assert_eq!(
            calls.load(std::sync::atomic::Ordering::Relaxed),
            calls_before + 1
        );
    }

    #[test]
    fn different_keys_convert_concurrently() {
        let dir = tempfile::tempdir().unwrap();
        let converter = KepubConverter::new(dir.path().to_path_buf());
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let release_rx = Arc::new(std::sync::Mutex::new(release_rx));

        let first = {
            let converter = converter.clone();
            let started_tx = started_tx.clone();
            let release_rx = release_rx.clone();
            std::thread::spawn(move || {
                converter.cached_or_convert("k1", move |tmp| {
                    started_tx.send("k1").unwrap();
                    let _ = release_rx.lock().unwrap().recv();
                    let path = tmp.join("same.kepub.epub");
                    std::fs::write(&path, "k1").unwrap();
                    Some(path)
                })
            })
        };
        assert_eq!(
            started_rx.recv_timeout(Duration::from_secs(2)).unwrap(),
            "k1"
        );

        let second = {
            let converter = converter.clone();
            let started_tx = started_tx.clone();
            let release_rx = release_rx.clone();
            std::thread::spawn(move || {
                converter.cached_or_convert("k2", move |tmp| {
                    started_tx.send("k2").unwrap();
                    let _ = release_rx.lock().unwrap().recv();
                    let path = tmp.join("same.kepub.epub");
                    std::fs::write(&path, "k2").unwrap();
                    Some(path)
                })
            })
        };
        let concurrent = started_rx.recv_timeout(Duration::from_secs(2)).is_ok();

        release_tx.send(()).unwrap();
        release_tx.send(()).unwrap();
        let first_path = first.join().unwrap().unwrap();
        let second_path = second.join().unwrap().unwrap();
        assert!(concurrent, "one conversion must not block another key");
        assert_eq!(std::fs::read_to_string(first_path).unwrap(), "k1");
        assert_eq!(std::fs::read_to_string(second_path).unwrap(), "k2");
    }
}
