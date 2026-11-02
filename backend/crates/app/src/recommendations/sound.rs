// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use reco::duplicates::{self, DuplicateGroup, Match, Recording};
use reco::snapshot;
use sqlx::PgPool;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::index::EmbeddingIndex;
use crate::{AppError, AppResult};

const STARTUP_DELAY: Duration = Duration::from_secs(90);
const INTERVAL: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Signature {
    tracks: i64,
    fingerprints: i64,
    analyzed_at: Option<DateTime<Utc>>,
}

type Cached = (Signature, Arc<Vec<Match>>);

#[derive(Clone, Default)]
pub struct SoundAlikes {
    current: Arc<Mutex<Option<Cached>>>,
    computing: Arc<tokio::sync::Mutex<()>>,
}

impl SoundAlikes {
    pub fn cached(&self) -> Arc<Vec<Match>> {
        self.current
            .lock()
            .ok()
            .and_then(|current| current.as_ref().map(|(_, found)| Arc::clone(found)))
            .unwrap_or_default()
    }

    pub async fn refresh(&self, db: &PgPool) -> AppResult<(Arc<Vec<Match>>, bool)> {
        let _computing = self.computing.lock().await;
        let signature = signature(db).await?;
        if let Some(found) = self.known(signature) {
            return Ok((found, false));
        }

        let started = Instant::now();
        let recordings = load(db).await?;
        let count = recordings.len();
        let found = tokio::task::spawn_blocking(move || duplicates::matches(&recordings))
            .await
            .map_err(|error| AppError::internal(anyhow::anyhow!("Comparing fingerprints crashed: {error}")))?;
        tracing::info!(
            "Compared {count} recordings by sound: {} matches in {} ms",
            found.len(),
            started.elapsed().as_millis()
        );

        let found = Arc::new(found);
        let changed = self.cached().as_slice() != found.as_slice();
        if let Ok(mut current) = self.current.lock() {
            *current = Some((signature, Arc::clone(&found)));
        }
        Ok((found, changed))
    }

    fn known(&self, signature: Signature) -> Option<Arc<Vec<Match>>> {
        let current = self.current.lock().ok()?;
        current.as_ref().filter(|(known, _)| *known == signature).map(|(_, found)| Arc::clone(found))
    }
}

pub async fn dismissed(db: &PgPool) -> sqlx::Result<HashSet<(Uuid, Uuid)>> {
    Ok(sqlx::query!("SELECT first_track_id, second_track_id FROM duplicate_dismissals")
        .fetch_all(db)
        .await?
        .into_iter()
        .map(|row| (row.first_track_id, row.second_track_id))
        .collect())
}

pub fn groups(found: &[Match], dismissed: &HashSet<(Uuid, Uuid)>) -> Vec<DuplicateGroup> {
    duplicates::group(found, dismissed)
}

async fn signature(db: &PgPool) -> sqlx::Result<Signature> {
    let row = sqlx::query!(
        r#"SELECT (SELECT count(*) FROM tracks) AS "tracks!",
                  (SELECT count(*) FROM track_fingerprints) AS "fingerprints!",
                  (SELECT max(analyzed_at) FROM track_cues) AS analyzed_at"#
    )
    .fetch_one(db)
    .await?;
    Ok(Signature { tracks: row.tracks, fingerprints: row.fingerprints, analyzed_at: row.analyzed_at })
}

async fn load(db: &PgPool) -> sqlx::Result<Vec<Recording>> {
    let rows = sqlx::query!(
        r#"SELECT t.id AS "id!", t.duration_seconds AS "duration_seconds!", t.title AS "title!",
                  ar.name AS "artist_name!", f.fingerprint AS "fingerprint?"
           FROM tracks t
           JOIN artists ar ON ar.id = t.artist_id
           LEFT JOIN track_fingerprints f ON f.track_id = t.id"#
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| Recording {
            track_id: row.id,
            duration_seconds: row.duration_seconds,
            song_key: snapshot::song_key(&row.artist_name, &row.title),
            fingerprint: row
                .fingerprint
                .map(|items| items.into_iter().map(|item| u32::from_ne_bytes(item.to_ne_bytes())).collect()),
        })
        .collect())
}

pub fn spawn(db: PgPool, index: EmbeddingIndex, cancel: CancellationToken) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut delay = STARTUP_DELAY;
        loop {
            tokio::select! {
                () = cancel.cancelled() => return,
                () = tokio::time::sleep(delay) => {}
            }
            delay = INTERVAL;
            match index.sound.refresh(&db).await {
                Ok((_, true)) => index.request_reload(),
                Ok(_) => {}
                Err(error) => tracing::error!("Comparing recordings by sound failed: {error:#}"),
            }
        }
    })
}
