// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::HashMap;

use rand::seq::SliceRandom;
use sqlx::types::Json;
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder};
use uuid::Uuid;

use super::dto::{ArtistRefDto, LoudnessDto, TrackCuesDto, TrackDto};
use super::search::{SearchTerm, push_track_match};
use crate::paging::{PageRequest, Paged};
use crate::{AppError, AppResult};
use media::key::MusicalKey;

pub const MAX_SHUFFLE_TRACKS: i64 = 200;
pub const MAX_LOOKUP: usize = 500;

const TRACK_FROM: &str = "
    FROM tracks t
    JOIN artists ar ON ar.id = t.artist_id
    LEFT JOIN albums al ON al.id = t.album_id
    LEFT JOIN genres g ON g.id = t.genre_id
    LEFT JOIN track_cues c ON c.track_id = t.id
    LEFT JOIN track_stats s ON s.track_id = t.id";

pub const POPULARITY: &str = "COALESCE(s.popularity_score, 0)";

#[derive(FromRow)]
struct TrackRow {
    id: Uuid,
    title: String,
    artist_id: Uuid,
    artist_name: String,
    artists: Json<Vec<ArtistRefDto>>,
    album_id: Option<Uuid>,
    album_title: Option<String>,
    genre_name: Option<String>,
    track_number: Option<i32>,
    disc_number: Option<i32>,
    year: Option<i32>,
    duration_seconds: i32,
    original_file_name: String,
    is_favorite: bool,
    has_cover: bool,
    has_lyrics: bool,
    created_at: chrono::DateTime<chrono::Utc>,
    codec: Option<String>,
    bitrate_kbps: Option<i32>,
    sample_rate_hz: Option<i32>,
    bits_per_sample: Option<i32>,
    cues_succeeded: Option<bool>,
    audio_start_seconds: Option<f64>,
    audio_end_seconds: Option<f64>,
    outro_start_seconds: Option<f64>,
    tempo_bpm: Option<f64>,
    loudness_lufs: Option<f64>,
    true_peak_db: Option<f64>,
    loudness_range_lu: Option<f64>,
    musical_key: Option<i16>,
}

impl From<TrackRow> for TrackDto {
    fn from(row: TrackRow) -> Self {
        let cues = match (row.cues_succeeded, row.audio_start_seconds, row.audio_end_seconds, row.outro_start_seconds) {
            (Some(true), Some(audio_start), Some(audio_end), Some(outro_start)) => {
                Some(TrackCuesDto { audio_start, audio_end, outro_start, bpm: row.tempo_bpm })
            }
            _ => None,
        };
        let loudness = match (row.loudness_lufs, row.true_peak_db) {
            (Some(lufs), Some(true_peak)) => Some(LoudnessDto { lufs, true_peak, range: row.loudness_range_lu }),
            _ => None,
        };

        Self {
            id: row.id,
            title: row.title,
            artist_id: row.artist_id,
            artist_name: row.artist_name,
            artists: row.artists.0,
            album_id: row.album_id,
            album_title: row.album_title,
            genre_name: row.genre_name,
            track_number: row.track_number,
            disc_number: row.disc_number,
            year: row.year,
            duration_seconds: row.duration_seconds,
            original_file_name: row.original_file_name,
            is_favorite: row.is_favorite,
            has_cover: row.has_cover,
            has_lyrics: row.has_lyrics,
            created_at: row.created_at,
            codec: row.codec,
            bitrate_kbps: row.bitrate_kbps,
            sample_rate_hz: row.sample_rate_hz,
            bits_per_sample: row.bits_per_sample,
            cues,
            key: row.musical_key.and_then(MusicalKey::from_index).map(Into::into),
            loudness,
        }
    }
}

pub fn select(user: Uuid) -> QueryBuilder<Postgres> {
    let mut query = QueryBuilder::new(
        "SELECT t.id, t.title, t.artist_id, ar.name AS artist_name,
            COALESCE((SELECT json_agg(json_build_object('id', ta.artist_id, 'name', ca.name) ORDER BY ta.position)
                      FROM track_artists ta JOIN artists ca ON ca.id = ta.artist_id
                      WHERE ta.track_id = t.id), '[]'::json) AS artists,
            t.album_id, al.title AS album_title, g.name AS genre_name,
            t.track_number, t.disc_number, t.year, t.duration_seconds, t.original_file_name,
            EXISTS (SELECT 1 FROM favorites f WHERE f.track_id = t.id AND f.user_id = ",
    );
    query.push_bind(user);
    query.push(
        ") AS is_favorite,
            al.cover_path IS NOT NULL AS has_cover,
            EXISTS (SELECT 1 FROM track_lyrics l WHERE l.track_id = t.id) AS has_lyrics,
            t.created_at, t.codec, t.bitrate_kbps, t.sample_rate_hz, t.bits_per_sample,
            c.succeeded AS cues_succeeded, c.audio_start_seconds, c.audio_end_seconds,
            c.outro_start_seconds, c.tempo_bpm, c.loudness_lufs, c.true_peak_db, c.loudness_range_lu,
            c.musical_key",
    );
    query.push(TRACK_FROM);
    query
}

pub async fn fetch(db: &PgPool, mut query: QueryBuilder<Postgres>) -> AppResult<Vec<TrackDto>> {
    let rows: Vec<TrackRow> = query.build_query_as().fetch_all(db).await?;
    Ok(rows.into_iter().map(TrackDto::from).collect())
}

pub async fn page(
    db: &PgPool,
    user: Uuid,
    filter: impl Fn(&mut QueryBuilder<Postgres>),
    order: impl Fn(&mut QueryBuilder<Postgres>),
    page: PageRequest,
) -> AppResult<Paged<TrackDto>> {
    let mut count = QueryBuilder::new("SELECT count(*)");
    count.push(TRACK_FROM);
    filter(&mut count);
    let total: i64 = count.build_query_scalar().fetch_one(db).await?;

    let mut query = select(user);
    filter(&mut query);
    query.push(" ORDER BY ");
    order(&mut query);
    query.push(" LIMIT ").push_bind(page.limit());
    query.push(" OFFSET ").push_bind(page.offset());

    Ok(Paged::new(fetch(db, query).await?, total, page))
}

pub async fn by_ids(db: &PgPool, user: Uuid, ids: &[Uuid]) -> AppResult<HashMap<Uuid, TrackDto>> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let mut query = select(user);
    query.push(" WHERE t.id = ANY(").push_bind(ids.to_vec()).push(")");
    Ok(fetch(db, query).await?.into_iter().map(|track| (track.id, track)).collect())
}

pub async fn get(db: &PgPool, user: Uuid, id: Uuid) -> AppResult<TrackDto> {
    by_ids(db, user, &[id]).await?.remove(&id).ok_or_else(|| AppError::not_found("Track not found."))
}

pub async fn require(db: &PgPool, id: Uuid) -> AppResult<()> {
    let exists = sqlx::query_scalar!(r#"SELECT EXISTS (SELECT 1 FROM tracks WHERE id = $1) AS "exists!""#, id)
        .fetch_one(db)
        .await?;
    if exists { Ok(()) } else { Err(AppError::not_found("Track not found.")) }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum TrackSort {
    #[default]
    Title,
    Recent,
    Artist,
    Album,
    Bpm,
    Key,
    Loudness,
}

impl TrackSort {
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value.trim().to_ascii_lowercase().as_str() {
            "title" | "0" => Self::Title,
            "recent" | "1" => Self::Recent,
            "artist" | "2" => Self::Artist,
            "album" | "3" => Self::Album,
            "bpm" | "4" => Self::Bpm,
            "key" | "5" => Self::Key,
            "loudness" | "6" => Self::Loudness,
            _ => return None,
        })
    }

    fn order_by(self) -> &'static str {
        match self {
            Self::Title => "t.title, ar.name",
            Self::Recent => "t.created_at DESC, t.title",
            Self::Artist => "ar.name, t.title",
            Self::Album => "al.title, t.disc_number, t.track_number",
            Self::Bpm => "c.tempo_bpm NULLS LAST, t.title",
            Self::Key => CAMELOT_ORDER,
            Self::Loudness => "c.loudness_lufs DESC NULLS LAST, t.title",
        }
    }
}

const CAMELOT_ORDER: &str = "(((c.musical_key % 12 + 3 * (c.musical_key / 12)) % 12 * 7 % 12 + 7) % 12) * 2
        + (c.musical_key < 12)::int NULLS LAST, t.title";

#[derive(Debug, Clone, Default, PartialEq)]
pub struct TrackFilter {
    pub bpm_min: Option<f64>,
    pub bpm_max: Option<f64>,
    pub keys: Vec<MusicalKey>,
}

pub async fn list(
    db: &PgPool,
    user: Uuid,
    page_request: PageRequest,
    sort: TrackSort,
    search: Option<&str>,
    filter: &TrackFilter,
) -> AppResult<Paged<TrackDto>> {
    let term = SearchTerm::for_filter(search);
    let keys: Vec<i16> = filter.keys.iter().map(|key| i16::from(key.index)).collect();
    page(
        db,
        user,
        |query| {
            let mut first = true;
            let mut and = |query: &mut QueryBuilder<Postgres>| {
                query.push(if std::mem::take(&mut first) { " WHERE " } else { " AND " });
            };
            if let Some(term) = &term {
                and(query);
                push_track_match(query, term);
            }
            if let Some(min) = filter.bpm_min {
                and(query);
                query.push("c.tempo_bpm >= ").push_bind(min);
            }
            if let Some(max) = filter.bpm_max {
                and(query);
                query.push("c.tempo_bpm <= ").push_bind(max);
            }
            if !keys.is_empty() {
                and(query);
                query.push("c.musical_key = ANY(").push_bind(keys.clone()).push(")");
            }
        },
        |query| {
            query.push(sort.order_by());
        },
        page_request,
    )
    .await
}

pub async fn shuffle(db: &PgPool, user: Uuid, limit: Option<i64>, search: Option<&str>) -> AppResult<Vec<TrackDto>> {
    let take = match limit {
        Some(limit) if limit >= 1 => limit.min(MAX_SHUFFLE_TRACKS),
        _ => MAX_SHUFFLE_TRACKS,
    };
    let pivot: f64 = rand::random();
    let term = SearchTerm::for_filter(search);

    let slice = |at_or_after: bool, take: i64| {
        let mut query = select(user);
        query.push(if at_or_after { " WHERE t.shuffle_key >= " } else { " WHERE t.shuffle_key < " });
        query.push_bind(pivot);
        if let Some(term) = &term {
            query.push(" AND ");
            push_track_match(&mut query, term);
        }
        query.push(" ORDER BY t.shuffle_key, t.id LIMIT ").push_bind(take);
        query
    };

    let mut selected = fetch(db, slice(true, take)).await?;
    let missing = take - i64::try_from(selected.len()).unwrap_or(take);
    if missing > 0 {
        selected.extend(fetch(db, slice(false, missing)).await?);
    }

    selected.shuffle(&mut rand::rng());
    Ok(selected)
}

pub async fn lookup(db: &PgPool, user: Uuid, ids: &[Uuid]) -> AppResult<Vec<TrackDto>> {
    if ids.len() > MAX_LOOKUP {
        return Err(AppError::validation("At most {0} tracks can be looked up at once.").arg(MAX_LOOKUP));
    }

    let mut found = by_ids(db, user, ids).await?;
    let mut seen = std::collections::HashSet::new();
    Ok(ids.iter().filter(|id| seen.insert(**id)).filter_map(|id| found.remove(id)).collect())
}
