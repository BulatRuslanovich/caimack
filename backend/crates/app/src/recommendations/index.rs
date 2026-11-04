// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use reco::moods::{LibraryMoods, MoodCatalog};
use reco::snapshot::{self, Snapshot, TrackMeta};
use sqlx::PgPool;
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

use super::sound::{self, SoundAlikes};

const CHECK_EVERY: Duration = Duration::from_secs(60);

#[derive(Debug, Default)]
pub struct Library {
    pub generation: u64,
    pub snapshot: Snapshot,
    pub moods: LibraryMoods,
}

#[derive(Clone)]
pub struct EmbeddingIndex {
    current: Arc<RwLock<Arc<Library>>>,
    reload: Arc<Notify>,
    generation: Arc<AtomicU64>,
    pub sound: SoundAlikes,
}

impl Default for EmbeddingIndex {
    fn default() -> Self {
        Self {
            current: Arc::default(),
            reload: Arc::new(Notify::new()),
            generation: Arc::new(AtomicU64::new(0)),
            sound: SoundAlikes::default(),
        }
    }
}

impl EmbeddingIndex {
    pub fn library(&self) -> Arc<Library> {
        self.current.read().map_or_else(|poisoned| Arc::clone(&poisoned.into_inner()), |current| Arc::clone(&current))
    }

    pub fn request_reload(&self) {
        self.reload.notify_one();
    }

    fn publish(&self, snapshot: Snapshot, moods: &MoodCatalog) {
        let library = Library {
            generation: self.generation.fetch_add(1, Ordering::Relaxed) + 1,
            moods: moods.score(&snapshot),
            snapshot,
        };
        match self.current.write() {
            Ok(mut current) => *current = Arc::new(library),
            Err(poisoned) => *poisoned.into_inner() = Arc::new(library),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
struct Signature {
    revision: i64,
    vectors: i64,
    analyzed_at: Option<DateTime<Utc>>,
    tracks: i64,
}

async fn signature(db: &PgPool) -> sqlx::Result<Signature> {
    let row = sqlx::query!(
        r#"SELECT (SELECT count(*) FROM track_embeddings WHERE succeeded) AS "vectors!",
                  (SELECT max(analyzed_at) FROM track_embeddings WHERE succeeded) AS analyzed_at,
                  (SELECT count(*) FROM tracks) AS "tracks!""#
    )
    .fetch_one(db)
    .await?;
    let revision = sqlx::query_scalar("SELECT last_value FROM catalog_revision").fetch_one(db).await?;
    Ok(Signature { revision, vectors: row.vectors, analyzed_at: row.analyzed_at, tracks: row.tracks })
}

pub async fn load(db: &PgPool) -> sqlx::Result<Snapshot> {
    let rows = sqlx::query!(
        r#"SELECT e.track_id, e.vector, e.dimension, t.artist_id, t.album_id, t.genre_id, t.duration_seconds, t.year,
                  t.created_at, t.content_hash, t.title, ar.name AS artist_name,
                  COALESCE(s.popularity_score, 0) AS "popularity!",
                  c.tempo_bpm AS "tempo_bpm?", c.musical_key AS "musical_key?", c.loudness_lufs AS "loudness_lufs?",
                  ARRAY(SELECT ta.artist_id FROM track_artists ta WHERE ta.track_id = t.id ORDER BY ta.position) AS "credits!"
           FROM track_embeddings e
           JOIN tracks t ON t.id = e.track_id
           JOIN artists ar ON ar.id = t.artist_id
           LEFT JOIN track_stats s ON s.track_id = t.id
           LEFT JOIN track_cues c ON c.track_id = t.id
           WHERE e.succeeded AND e.model_id = $1
           ORDER BY e.track_id"#,
        media::clap::MODEL_ID
    )
    .fetch_all(db)
    .await?;

    let dimension = rows.first().map_or(0, |row| usize::try_from(row.dimension).unwrap_or(0));
    let entries = rows
        .into_iter()
        .map(|row| {
            let mut artists = vec![row.artist_id];
            artists.extend(row.credits.into_iter().filter(|&artist| artist != row.artist_id));
            let meta = TrackMeta {
                track_id: row.track_id,
                artists,
                album_id: row.album_id,
                genre_id: row.genre_id,
                duration_seconds: row.duration_seconds,
                year: row.year,
                added_at: row.created_at.timestamp(),
                #[expect(clippy::cast_possible_truncation, reason = "a share in [0, 1]")]
                popularity: row.popularity as f32,
                content_hash: row.content_hash,
                song_key: snapshot::song_key(&row.artist_name, &row.title),
                #[expect(clippy::cast_possible_truncation, reason = "a tempo in BPM")]
                tempo_bpm: row.tempo_bpm.map(|bpm| bpm as f32),
                musical_key: row.musical_key.and_then(|key| u8::try_from(key).ok()),
                #[expect(clippy::cast_possible_truncation, reason = "a loudness in LUFS")]
                loudness_lufs: row.loudness_lufs.map(|lufs| lufs as f32),
            };
            (meta, row.vector)
        })
        .collect();
    Ok(Snapshot::new(dimension, entries))
}

pub fn spawn(
    db: PgPool,
    index: EmbeddingIndex,
    moods: Arc<MoodCatalog>,
    cancel: CancellationToken,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut last: Option<Signature> = None;
        let mut forced = true;
        loop {
            match signature(&db).await {
                Ok(current) if forced || last.as_ref() != Some(&current) => {
                    let started = Instant::now();
                    match load(&db).await {
                        Ok(mut snapshot) => {
                            match sound::dismissed(&db).await {
                                Ok(dismissed) => {
                                    snapshot.set_sound_alikes(&sound::groups(&index.sound.cached(), &dismissed));
                                }
                                Err(error) => tracing::error!("Loading dismissed duplicates failed: {error}"),
                            }
                            let (count, dimension) = (snapshot.len(), snapshot.dimension());
                            let moods = Arc::clone(&moods);
                            let index = index.clone();
                            let published = tokio::task::spawn_blocking(move || index.publish(snapshot, &moods)).await;
                            if let Err(error) = published {
                                tracing::error!("Publishing the embedding index failed: {error}");
                            } else {
                                tracing::info!(
                                    "Embedding index rebuilt: {count} tracks, {dimension} dimensions, {} ms",
                                    started.elapsed().as_millis()
                                );
                                last = Some(current);
                            }
                        }
                        Err(error) => tracing::error!("Loading the embedding index failed: {error}"),
                    }
                }
                Ok(_) => {}
                Err(error) => tracing::error!("Checking the embedding index failed: {error}"),
            }
            tokio::select! {
                () = cancel.cancelled() => return,
                () = index.reload.notified() => forced = true,
                () = tokio::time::sleep(CHECK_EVERY) => forced = false,
            }
        }
    })
}
