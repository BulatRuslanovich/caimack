// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Utc;
use media::analysis::Analysis;
use media::clap::{self, ClapEmbedder};
use media::cues;
use media::key::MusicalKey;
use media::loudness::Loudness;
use sqlx::PgPool;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::config::ModelConfig;
use crate::recommendations::index::EmbeddingIndex;
use crate::storage::Storage;

const STARTUP_DELAY: Duration = Duration::from_secs(20);
const POLL: Duration = Duration::from_secs(30);
const BATCH: i64 = 16;
const RETRY_FAILED_AFTER: chrono::Duration = chrono::Duration::days(7);

pub fn spawn(
    db: PgPool,
    storage: Storage,
    model: ModelConfig,
    index: EmbeddingIndex,
    cancel: CancellationToken,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let Some(embedder) = crate::clap_model::load_when_ready(&model, &cancel).await else { return };
        tokio::select! {
            () = cancel.cancelled() => return,
            () = tokio::time::sleep(STARTUP_DELAY) => {}
        }
        loop {
            match run_pass(&db, &storage, &embedder, &cancel).await {
                Ok(analysed) if analysed > 0 => index.request_reload(),
                Ok(_) => {}
                Err(error) => tracing::error!("Track analysis pass failed: {error:#}"),
            }
            tokio::select! {
                () = cancel.cancelled() => return,
                () = tokio::time::sleep(POLL) => {}
            }
        }
    })
}

async fn run_pass(
    db: &PgPool,
    storage: &Storage,
    embedder: &Arc<ClapEmbedder>,
    cancel: &CancellationToken,
) -> anyhow::Result<usize> {
    let mut analysed = 0;
    loop {
        let retry_before = Utc::now() - RETRY_FAILED_AFTER;
        let batch = sqlx::query!(
            r#"SELECT t.id, t.file_path, t.content_hash, t.duration_seconds,
                    (e.track_id IS NULL OR e.model_id <> $2 OR e.strategy <> $3 OR e.source_hash <> t.content_hash
                     OR (NOT e.succeeded AND e.analyzed_at <= $4)) AS "embed!"
             FROM tracks t
             LEFT JOIN track_cues c ON c.track_id = t.id
             LEFT JOIN track_embeddings e ON e.track_id = t.id
             WHERE c.track_id IS NULL OR c.version <> $1 OR c.source_hash <> t.content_hash
                OR (NOT c.succeeded AND c.analyzed_at <= $4)
                OR e.track_id IS NULL OR e.model_id <> $2 OR e.strategy <> $3 OR e.source_hash <> t.content_hash
                OR (NOT e.succeeded AND e.analyzed_at <= $4)
             ORDER BY t.created_at DESC
             LIMIT $5"#,
            cues::VERSION,
            clap::MODEL_ID,
            clap::windows::STRATEGY,
            retry_before,
            BATCH
        )
        .fetch_all(db)
        .await?;
        if batch.is_empty() {
            return Ok(analysed);
        }

        for track in batch {
            if cancel.is_cancelled() {
                return Ok(analysed);
            }
            let started = Instant::now();
            let outcome =
                analyze(storage, embedder, &track.file_path, f64::from(track.duration_seconds), track.embed).await;
            match save(db, track.id, &track.content_hash, &outcome).await {
                Err(sqlx::Error::Database(error)) if error.is_foreign_key_violation() => {
                    tracing::debug!("Track {} was deleted during analysis", track.id);
                    continue;
                }
                other => other?,
            }
            analysed += 1;
            tracing::debug!(
                "Analysed track {} in {:.1} s: cues {}, loudness {}, key {}, fingerprint {}, embedding {}",
                track.id,
                started.elapsed().as_secs_f64(),
                found(outcome.cues.is_some()),
                found(outcome.loudness.is_some()),
                found(outcome.key.is_some()),
                found(outcome.fingerprint.is_some()),
                match &outcome.vector {
                    Some(Ok(_)) => "succeeded",
                    Some(Err(_)) => "failed",
                    None => "kept",
                }
            );
        }
    }
}

fn found(present: bool) -> &'static str {
    if present { "found" } else { "missing" }
}

struct Outcome {
    cues: Option<cues::TrackCuePoints>,
    loudness: Option<Loudness>,
    key: Option<MusicalKey>,
    fingerprint: Option<Vec<u32>>,

    vector: Option<Result<Vec<f32>, &'static str>>,
}

impl Outcome {
    fn failed(embed: bool, code: &'static str) -> Self {
        Self { cues: None, loudness: None, key: None, fingerprint: None, vector: embed.then_some(Err(code)) }
    }
}

async fn analyze(
    storage: &Storage,
    embedder: &Arc<ClapEmbedder>,
    file_path: &str,
    duration: f64,
    embed: bool,
) -> Outcome {
    let Some(source) = storage.existing(file_path) else {
        tracing::warn!("Track at {file_path} cannot be analysed: the file is missing from storage");
        return Outcome::failed(embed, "source_missing");
    };

    let embedder = Arc::clone(embedder);
    let Ok(permit) = crate::background::permit().await else { return Outcome::failed(embed, "worker_closed") };
    let work = tokio::task::spawn_blocking(move || -> anyhow::Result<(Analysis, Option<anyhow::Result<Vec<f32>>>)> {
        let _permit = permit;
        let analysis = media::analysis::analyze(&source, duration, embed)?;
        let vector = embed.then(|| embedder.embed(&analysis.windows));
        Ok((analysis, vector))
    })
    .await;

    match work {
        Ok(Ok((analysis, vector))) => Outcome {
            cues: analysis.cues,
            loudness: analysis.loudness,
            key: analysis.key,
            fingerprint: analysis.fingerprint,
            vector: vector.map(|vector| {
                vector.map_err(|error| {
                    tracing::warn!("Embedding of {file_path} failed: {error:#}");
                    "embedding_failed"
                })
            }),
        },
        Ok(Err(error)) => {
            tracing::warn!("Analysis of {file_path} failed: {error:#}");
            Outcome::failed(embed, "embedding_failed")
        }
        Err(error) => {
            tracing::error!("Analysis of {file_path} crashed: {error}");
            Outcome::failed(embed, "embedding_failed")
        }
    }
}

fn milliseconds(seconds: f64) -> f64 {
    (seconds * 1000.0).round_ties_even() / 1000.0
}

fn hundredths(value: f64) -> f64 {
    (value * 100.0).round_ties_even() / 100.0
}

async fn save(db: &PgPool, track: Uuid, content_hash: &str, outcome: &Outcome) -> Result<(), sqlx::Error> {
    let now = Utc::now();
    let cues = outcome.cues.as_ref();
    let mut tx = db.begin().await?;

    let loudness = outcome.loudness.as_ref();
    sqlx::query!(
        "INSERT INTO track_cues (track_id, source_hash, version, succeeded, audio_start_seconds, audio_end_seconds,
                                 outro_start_seconds, tempo_bpm, waveform, loudness_lufs, true_peak_db,
                                 loudness_range_lu, musical_key, key_confidence, analyzed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (track_id) DO UPDATE SET
             source_hash = EXCLUDED.source_hash, version = EXCLUDED.version, succeeded = EXCLUDED.succeeded,
             audio_start_seconds = EXCLUDED.audio_start_seconds, audio_end_seconds = EXCLUDED.audio_end_seconds,
             outro_start_seconds = EXCLUDED.outro_start_seconds, tempo_bpm = EXCLUDED.tempo_bpm,
             waveform = EXCLUDED.waveform, loudness_lufs = EXCLUDED.loudness_lufs,
             true_peak_db = EXCLUDED.true_peak_db, loudness_range_lu = EXCLUDED.loudness_range_lu,
             musical_key = EXCLUDED.musical_key, key_confidence = EXCLUDED.key_confidence,
             analyzed_at = EXCLUDED.analyzed_at",
        track,
        content_hash,
        cues::VERSION,
        cues.is_some(),
        cues.map(|c| milliseconds(c.audio_start_seconds)),
        cues.map(|c| milliseconds(c.audio_end_seconds)),
        cues.map(|c| milliseconds(c.outro_start_seconds)),
        cues.and_then(|c| c.tempo_bpm),
        cues.map(|c| c.waveform.clone()),
        loudness.map(|l| hundredths(l.integrated_lufs)),
        loudness.map(|l| hundredths(l.true_peak_db)),
        loudness.and_then(|l| l.range_lu).map(hundredths),
        outcome.key.map(|k| i16::from(k.index)),
        outcome.key.map(|k| k.confidence),
        now
    )
    .execute(&mut *tx)
    .await?;

    match &outcome.fingerprint {
        Some(fingerprint) => {
            let stored: Vec<i32> = fingerprint.iter().map(|&item| i32::from_ne_bytes(item.to_ne_bytes())).collect();
            sqlx::query!(
                "INSERT INTO track_fingerprints (track_id, fingerprint) VALUES ($1, $2)
                 ON CONFLICT (track_id) DO UPDATE SET fingerprint = EXCLUDED.fingerprint",
                track,
                &stored
            )
            .execute(&mut *tx)
            .await?;
        }
        None => {
            sqlx::query!("DELETE FROM track_fingerprints WHERE track_id = $1", track).execute(&mut *tx).await?;
        }
    }

    let Some(vector) = &outcome.vector else {
        tx.commit().await?;
        return Ok(());
    };
    let (vector, error) = match vector {
        Ok(vector) => (vector.clone(), None),
        Err(code) => (Vec::new(), Some(*code)),
    };
    sqlx::query!(
        "INSERT INTO track_embeddings (track_id, vector, dimension, model_id, strategy, source_hash, succeeded, error, analyzed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (track_id) DO UPDATE SET
             vector = EXCLUDED.vector, dimension = EXCLUDED.dimension, model_id = EXCLUDED.model_id,
             strategy = EXCLUDED.strategy, source_hash = EXCLUDED.source_hash, succeeded = EXCLUDED.succeeded,
             error = EXCLUDED.error, analyzed_at = EXCLUDED.analyzed_at",
        track,
        &vector,
        i32::try_from(vector.len()).unwrap_or(0),
        clap::MODEL_ID,
        clap::windows::STRATEGY,
        content_hash,
        error.is_none(),
        error,
        now
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cue_seconds_keep_three_decimals() {
        assert_eq!(milliseconds(36.014_149_659_863_946), 36.014);
    }
}
