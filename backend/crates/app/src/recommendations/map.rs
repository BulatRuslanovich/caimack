// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::HashMap;
use std::sync::Arc;

use reco::map::{self, MapLayout};
use serde::Serialize;
use serde_with::skip_serializing_none;
use tokio::sync::Mutex;
use uuid::Uuid;

use super::index::Library;
use super::{Recommendations, compute::ComputePool};
use crate::{AppResult, json};

const LANDMARK_TRACKS: usize = 30;

#[derive(Default)]
struct MapState {
    generation: u64,
    layout: Option<Arc<MapLayout>>,
    building: bool,
}

#[derive(Clone, Default)]
pub struct MapCache(Arc<Mutex<MapState>>);

#[skip_serializing_none]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapPointDto {
    pub id: Uuid,
    #[serde(serialize_with = "json::number")]
    pub x: f64,
    #[serde(serialize_with = "json::number")]
    pub y: f64,
    pub title: String,
    pub artist: String,
    pub album_id: Option<Uuid>,
    pub has_cover: bool,
    pub genre: Option<String>,
    pub plays: i64,
}

#[derive(Debug, Serialize)]
pub struct MapLandmarkDto {
    pub mood: String,
    #[serde(serialize_with = "json::number")]
    pub x: f64,
    #[serde(serialize_with = "json::number")]
    pub y: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryMapDto {
    pub points: Vec<MapPointDto>,
    pub landmarks: Vec<MapLandmarkDto>,
    pub total_tracks: i64,
}

struct PointTrack {
    id: Uuid,
    title: String,
    artist: String,
    album_id: Option<Uuid>,
    has_cover: bool,
    genre: Option<String>,
}

fn rounded(value: f32) -> f64 {
    (f64::from(value) * 10_000.0).round() / 10_000.0
}

async fn build(
    pool: &ComputePool,
    library: Arc<Library>,
    previous: Option<Arc<MapLayout>>,
) -> AppResult<Arc<MapLayout>> {
    let started = std::time::Instant::now();
    let layout = pool.run(move || map::layout(&library.snapshot, previous.as_deref())).await?;
    tracing::info!("Library map laid out: {} tracks in {} ms", layout.len(), started.elapsed().as_millis());
    Ok(Arc::new(layout))
}

impl MapCache {
    async fn layout(&self, pool: &ComputePool, library: &Arc<Library>) -> AppResult<Arc<MapLayout>> {
        let mut state = self.0.lock().await;
        if let Some(layout) = &state.layout {
            if state.generation == library.generation {
                return Ok(Arc::clone(layout));
            }

            if !layout.is_empty() {
                let stale = Arc::clone(layout);
                if !state.building {
                    state.building = true;
                    let (cache, library, previous) = (self.clone(), Arc::clone(library), Arc::clone(&stale));
                    let pool = pool.clone();
                    tokio::spawn(async move {
                        let built = build(&pool, Arc::clone(&library), Some(previous)).await;
                        let mut state = cache.0.lock().await;
                        state.building = false;
                        match built {
                            Ok(layout) => {
                                state.generation = library.generation;
                                state.layout = Some(layout);
                            }
                            Err(error) => tracing::error!("Library map layout failed: {error:#}"),
                        }
                    });
                }
                return Ok(stale);
            }
        }

        let previous = state.layout.clone().filter(|layout| !layout.is_empty());
        let layout = build(pool, Arc::clone(library), previous).await?;
        state.generation = library.generation;
        state.layout = Some(Arc::clone(&layout));
        Ok(layout)
    }
}

impl Recommendations {
    pub async fn map(&self, user: Uuid) -> AppResult<LibraryMapDto> {
        let library = self.index.library();
        let layout = self.map.layout(&self.compute, &library).await?;

        let tracks: HashMap<Uuid, PointTrack> = sqlx::query_as!(
            PointTrack,
            r#"SELECT t.id, t.title, ar.name AS artist, t.album_id, al.cover_path IS NOT NULL AS "has_cover!", g.name AS "genre?"
               FROM tracks t JOIN artists ar ON ar.id = t.artist_id
               LEFT JOIN albums al ON al.id = t.album_id LEFT JOIN genres g ON g.id = t.genre_id"#
        )
        .fetch_all(&self.db)
        .await?
        .into_iter()
        .map(|row| (row.id, row))
        .collect();
        let plays: HashMap<Uuid, i64> = sqlx::query!(
            r#"SELECT track_id, count(*) AS "count!" FROM listening_history WHERE user_id = $1 GROUP BY track_id"#,
            user
        )
        .fetch_all(&self.db)
        .await?
        .into_iter()
        .map(|row| (row.track_id, row.count))
        .collect();

        self.compute
            .run(move || {
                let mut points = Vec::with_capacity(layout.len());
                let mut positions: HashMap<Uuid, (f32, f32)> = HashMap::with_capacity(layout.len());
                for (index, id) in layout.tracks.iter().enumerate() {
                    let Some(track) = tracks.get(id) else { continue };
                    let (x, y) = (layout.x[index], layout.y[index]);
                    positions.insert(*id, (x, y));
                    points.push(MapPointDto {
                        id: *id,
                        x: rounded(x),
                        y: rounded(y),
                        title: track.title.clone(),
                        artist: track.artist.clone(),
                        album_id: track.album_id,
                        has_cover: track.has_cover,
                        genre: track.genre.clone(),
                        plays: plays.get(id).copied().unwrap_or(0),
                    });
                }

                let snapshot = &library.snapshot;
                let landmarks = library
                    .moods
                    .playable()
                    .filter_map(|(mood, scores)| {
                        let spots: Vec<(f32, f32, f32)> = scores
                            .top_members()
                            .into_iter()
                            .filter_map(|row| {
                                positions.get(&snapshot.meta(row).track_id).map(|&(x, y)| (x, y, scores.ranks[row]))
                            })
                            .take(LANDMARK_TRACKS)
                            .collect();
                        let (x, y) = map::densest_spot(&spots)?;
                        Some(MapLandmarkDto { mood: mood.to_owned(), x: rounded(x), y: rounded(y) })
                    })
                    .collect();

                LibraryMapDto { points, landmarks, total_tracks: i64::try_from(tracks.len()).unwrap_or(i64::MAX) }
            })
            .await
    }
}
