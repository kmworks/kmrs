//! Portable EPUB bookmark locations, independent of reader pagination.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubBookmark {
    pub id: String,
    pub book_id: String,
    #[serde(flatten)]
    pub location: EpubBookmarkLocation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubBookmarkLocation {
    pub chapter_index: i32,
    pub chapter_href: String,
    pub chapter_fraction: f64,
    pub total_progression: f64,
    pub chapter_title: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: time::OffsetDateTime,
}
