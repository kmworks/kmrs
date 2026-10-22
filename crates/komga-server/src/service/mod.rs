//! Domain services (komga's `domain/service` equivalents): lifecycle logic that spans DAOs,
//! the filesystem, the task queue, and the event bus.

pub mod book;
pub mod collection;
pub mod convert;
pub mod import;
pub mod kepub;
pub mod kobo_proxy;
pub mod komf;
pub mod library;
pub mod library_content;
pub mod maintenance;
pub mod metadata;
pub mod metrics;
pub mod page_hash;
pub mod processor;
pub mod reading_stats;
pub mod readlist;
pub mod scheduler;
pub mod series;
pub mod smart_list;
pub mod sync_point;
pub mod tasks;
pub mod tracker_sync;
pub mod transient_book;
pub mod update_check;
pub mod user;
pub use tasks::{TaskEmitter, TaskNotify};

pub(crate) fn io_error(
    action: &str,
    path: &std::path::Path,
    error: std::io::Error,
) -> komga_db::Error {
    let kind = error.kind();
    komga_db::Error::Io(std::io::Error::new(
        kind,
        format!("{action} {}: {error}", path.display()),
    ))
}
