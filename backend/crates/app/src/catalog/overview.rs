// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::sync::Arc;
use std::time::Duration;

use moka::sync::Cache;
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use super::dto::{AlbumDto, ArtistDto, GenreDto, TrackDto};
use super::{albums, artists, genres, tracks};
use crate::AppResult;
use crate::storage::Storage;

const TOP_GENRE_COUNT: usize = 8;
const MAX_SECTION_SIZE: i64 = 50;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    pub track_count: i32,
    pub album_count: i32,
    pub total_duration_seconds: i64,
    pub total_bytes: i64,
    pub free_bytes: i64,
    pub favorite_count: i32,
}

#[derive(Clone)]
pub struct StatsCache(Arc<Cache<Uuid, LibraryStats>>);

impl Default for StatsCache {
    fn default() -> Self {
        Self(Arc::new(Cache::builder().max_capacity(1_000).time_to_live(Duration::from_secs(60)).build()))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryOverviewDto {
    pub stats: LibraryStats,
    pub recent_tracks: Vec<TrackDto>,
    pub recent_albums: Vec<AlbumDto>,
    pub recent_artists: Vec<ArtistDto>,
    pub top_genres: Vec<GenreDto>,
}

pub async fn overview(
    db: &PgPool,
    storage: &Storage,
    cache: &StatsCache,
    user: Uuid,
    section_size: i64,
) -> AppResult<LibraryOverviewDto> {
    let size = section_size.clamp(1, MAX_SECTION_SIZE);

    let mut track_query = tracks::select(user);
    track_query.push(" ORDER BY t.created_at DESC LIMIT ").push_bind(size);
    let mut album_query = albums::select();
    album_query.push(" ORDER BY a.created_at DESC LIMIT ").push_bind(size);

    let (stats, recent_tracks, recent_albums, recent_artists, mut top_genres) = tokio::try_join!(
        stats(db, storage, cache, user),
        tracks::fetch(db, track_query),
        albums::fetch(db, album_query),
        artists::fetch_where(db, |_| {}, "a.created_at DESC", size),
        genres::list(db),
    )?;
    top_genres.sort_by(|a, b| b.track_count.cmp(&a.track_count).then_with(|| a.name.cmp(&b.name)));
    top_genres.truncate(TOP_GENRE_COUNT);

    Ok(LibraryOverviewDto { stats, recent_tracks, recent_albums, recent_artists, top_genres })
}

pub async fn stats(db: &PgPool, storage: &Storage, cache: &StatsCache, user: Uuid) -> AppResult<LibraryStats> {
    if let Some(cached) = cache.0.get(&user) {
        return Ok(cached);
    }

    let row = sqlx::query!(
        r#"SELECT (SELECT COUNT(*) FROM tracks)::int                              AS "tracks!",
                  (SELECT COUNT(*) FROM albums)::int                              AS "albums!",
                  (SELECT COALESCE(SUM(duration_seconds), 0) FROM tracks)::bigint AS "duration_seconds!",
                  (SELECT COALESCE(SUM(file_size), 0) FROM tracks)::bigint        AS "total_bytes!",
                  (SELECT COUNT(*) FROM favorites WHERE user_id = $1)::int        AS "favorites!""#,
        user
    )
    .fetch_one(db)
    .await?;

    let stats = LibraryStats {
        track_count: row.tracks,
        album_count: row.albums,
        total_duration_seconds: row.duration_seconds,
        total_bytes: row.total_bytes,
        free_bytes: i64::try_from(storage.available_bytes()).unwrap_or(i64::MAX),
        favorite_count: row.favorites,
    };
    cache.0.insert(user, stats);
    Ok(stats)
}
