//! File opening shared by the container caches.
//!
//! Why a custom open: cached handles keep book files open for the cache's lifetime, and
//! the Rust standard library opens files on Windows without `FILE_SHARE_DELETE` — a
//! cached handle would then block deleting or renaming the book (kmrs-side deletes like
//! rar→cbz conversion, or the user moving a file away) until eviction. The extra share
//! mode makes Windows grant deletion while the handle lives (delete-pending semantics:
//! the name leaves the namespace at once, the object closes with the last handle). Unix
//! has no sharing modes; open fds never block unlink or rename there.

use std::path::Path;

pub fn open_book_file(path: &Path) -> std::io::Result<std::fs::File> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // std's Windows default is FILE_SHARE_READ | FILE_SHARE_WRITE; the cached
        // handles require DELETE too, or every delete of a cached book fails sharing-violation
        const FILE_SHARE_READ: u32 = 0x1;
        const FILE_SHARE_WRITE: u32 = 0x2;
        const FILE_SHARE_DELETE: u32 = 0x4;
        options.share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE);
    }
    options.open(path)
}
