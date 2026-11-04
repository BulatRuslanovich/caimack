// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use uuid::Uuid;

use crate::json;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistRefDto {
    pub id: Uuid,
    pub name: String,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackCuesDto {
    #[serde(serialize_with = "json::number")]
    pub audio_start: f64,
    #[serde(serialize_with = "json::number")]
    pub audio_end: f64,
    #[serde(serialize_with = "json::number")]
    pub outro_start: f64,
    #[serde(serialize_with = "json::optional_number")]
    pub bpm: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicalKeyDto {
    pub tonic: &'static str,
    pub minor: bool,
    pub camelot: String,
}

impl From<media::key::MusicalKey> for MusicalKeyDto {
    fn from(key: media::key::MusicalKey) -> Self {
        Self { tonic: key.tonic(), minor: key.is_minor(), camelot: key.camelot() }
    }
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoudnessDto {
    #[serde(serialize_with = "json::number")]
    pub lufs: f64,
    #[serde(serialize_with = "json::number")]
    pub true_peak: f64,
    #[serde(serialize_with = "json::optional_number")]
    pub range: Option<f64>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackDto {
    pub id: Uuid,
    pub title: String,
    pub artist_id: Uuid,
    pub artist_name: String,
    pub artists: Vec<ArtistRefDto>,
    pub album_id: Option<Uuid>,
    pub album_title: Option<String>,
    pub genre_name: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    pub year: Option<i32>,
    pub duration_seconds: i32,
    pub original_file_name: String,
    pub is_favorite: bool,
    pub has_cover: bool,
    pub has_lyrics: bool,
    #[serde(serialize_with = "json::time")]
    pub created_at: DateTime<Utc>,
    pub codec: Option<String>,
    pub bitrate_kbps: Option<i32>,
    pub sample_rate_hz: Option<i32>,
    pub bits_per_sample: Option<i32>,
    pub cues: Option<TrackCuesDto>,
    pub key: Option<MusicalKeyDto>,
    pub loudness: Option<LoudnessDto>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ArtistDto {
    pub id: Uuid,
    pub name: String,
    pub album_count: i32,
    pub track_count: i32,
    pub has_image: bool,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AlbumDto {
    pub id: Uuid,
    pub title: String,
    pub artist_id: Uuid,
    pub artist_name: String,
    pub year: Option<i32>,
    pub track_count: i32,
    pub duration_seconds: i32,
    pub has_cover: bool,
    #[serde(serialize_with = "json::time")]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct GenreDto {
    pub id: Uuid,
    pub name: String,
    pub track_count: i32,
    #[sqlx(skip)]
    pub cover_album_ids: Vec<Uuid>,
}
