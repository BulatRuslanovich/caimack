// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::time::Duration;

use sqlx::PgPool;
use tokio_util::sync::CancellationToken;

use super::index::EmbeddingIndex;
use super::listener::EVENT_RETENTION_DAYS;

const STARTUP_DELAY: Duration = Duration::from_secs(60);
const INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const RECENT_DAYS: i32 = 30;

pub fn spawn(db: PgPool, index: EmbeddingIndex, cancel: CancellationToken) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut delay = STARTUP_DELAY;
        loop {
            tokio::select! {
                () = cancel.cancelled() => return,
                () = tokio::time::sleep(delay) => {}
            }
            delay = INTERVAL;
            match refresh_track_stats(&db).await {
                Ok(changed) if changed > 0 => index.request_reload(),
                Ok(_) => {}
                Err(error) => tracing::error!("Refreshing track statistics failed: {error}"),
            }
            if let Err(error) = prune_events(&db).await {
                tracing::error!("Pruning playback events failed: {error}");
            }
            if let Err(error) = super::impressions::resolve(&db).await {
                tracing::error!("Resolving radio impressions failed: {error}");
            }
            if let Err(error) = super::impressions::prune(&db, EVENT_RETENTION_DAYS).await {
                tracing::error!("Pruning radio impressions failed: {error}");
            }
            if let Err(error) = crate::auth::journal::prune(&db, EVENT_RETENTION_DAYS).await {
                tracing::error!("Pruning the sign-in journal failed: {error}");
            }
        }
    })
}

async fn refresh_track_stats(db: &PgPool) -> sqlx::Result<u64> {
    let done = sqlx::query!(
        "WITH plays AS (
             SELECT track_id,
                    COUNT(*) FILTER (WHERE occurred_at >= now() - make_interval(days => $1)) AS recent,
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE type = 4 AND duration_seconds > 0
                                       AND occurred_at >= now() - make_interval(days => $1)
                                       AND listened_seconds::float8 / duration_seconds < 0.2) AS drops
             FROM playback_events
             WHERE track_id IS NOT NULL AND type IN (3, 4)
             GROUP BY track_id
         )
         INSERT INTO track_stats (track_id, play_count, popularity_score, skipped_early_count)
         SELECT t.id, COALESCE(p.total, 0)::int,
                (COALESCE(p.recent, 0) * 2 + COALESCE(p.total, 0))::float8
                    / (COALESCE(p.recent, 0) * 2 + COALESCE(p.total, 0) + 10),
                COALESCE(p.drops, 0)::int
         FROM tracks t LEFT JOIN plays p ON p.track_id = t.id
         ON CONFLICT (track_id) DO UPDATE SET
             play_count = EXCLUDED.play_count,
             popularity_score = EXCLUDED.popularity_score,
             skipped_early_count = EXCLUDED.skipped_early_count
         WHERE track_stats.play_count IS DISTINCT FROM EXCLUDED.play_count
            OR track_stats.popularity_score IS DISTINCT FROM EXCLUDED.popularity_score
            OR track_stats.skipped_early_count IS DISTINCT FROM EXCLUDED.skipped_early_count",
        RECENT_DAYS
    )
    .execute(db)
    .await?;
    tracing::debug!("Refreshed statistics for {} tracks", done.rows_affected());
    Ok(done.rows_affected())
}

async fn prune_events(db: &PgPool) -> sqlx::Result<()> {
    let done = sqlx::query!(
        "DELETE FROM playback_events WHERE occurred_at < now() - make_interval(days => $1)",
        EVENT_RETENTION_DAYS
    )
    .execute(db)
    .await?;
    if done.rows_affected() > 0 {
        tracing::info!("Pruned {} playback events", done.rows_affected());
    }
    Ok(())
}
