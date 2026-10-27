use crate::dto::common::Page;
use komga_core::tracker::TrackUpdate;
use komga_db::dao::tracker_link::TrackerLink;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackerLinkDto {
    pub series_id: String,
    pub provider: String,
    pub track_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub track_mode: String,
    pub chapter_offset: i32,
    pub created_date: String,
    pub last_modified_date: String,
}

impl From<TrackerLink> for TrackerLinkDto {
    fn from(link: TrackerLink) -> Self {
        TrackerLinkDto {
            series_id: link.series_id,
            provider: link.provider,
            track_id: link.track_id,
            title: link.title,
            track_mode: link.track_mode.as_str().to_string(),
            chapter_offset: link.chapter_offset,
            created_date: komga_core::time_codec::format_datetime(link.created_date),
            last_modified_date: komga_core::time_codec::format_datetime(link.last_modified_date),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackerLinkGroupDto {
    pub series_id: String,
    pub links: Vec<TrackerLinkDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackerLinkCountsDto {
    pub series: u64,
    pub providers: BTreeMap<String, u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackerLinkPageDto {
    #[serde(flatten)]
    pub page: Page<TrackerLinkGroupDto>,
    pub counts: TrackerLinkCountsDto,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackerLinkUpsertDto {
    pub provider: String,
    pub track_id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub track_mode: Option<String>,
    #[serde(default)]
    pub chapter_offset: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackerPreferencesDto {
    #[serde(default)]
    pub libraries: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_tracker: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackerUpdateRequestDto {
    pub track_id: String,
    #[serde(flatten)]
    pub update: TrackUpdate,
}
