// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

use chrono::{DateTime, Utc};
use reco::radio::Features;
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::library::history::THRESHOLD_SECONDS;

pub const FEATURES_VERSION: i32 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Finished = 1,
    Partial = 2,
    EarlySkip = 3,
    Superseded = 4,
    Abandoned = 5,
}

pub struct Shown {
    pub track: Uuid,
    pub explore: bool,
    pub score: f32,
    pub features: Features,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImpressionStatsDto {
    pub explore: bool,
    pub shown: i64,
    pub finished: i64,
    pub partial: i64,
    pub early_skips: i64,
    pub unplayed: i64,
    pub pending: i64,
}

pub async fn record(db: &PgPool, user: Uuid, source: &str, shown: &[Shown]) -> sqlx::Result<()> {
    let request = Uuid::now_v7();
    let now: DateTime<Utc> = Utc::now();
    let mut tx = db.begin().await?;
    for (position, item) in shown.iter().enumerate() {
        let features = serde_json::json!({ "version": FEATURES_VERSION, "values": item.features });
        sqlx::query!(
            "INSERT INTO recommendation_impressions (id, request_id, user_id, track_id, source, position, explore, score,
                                                     features, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
            Uuid::now_v7(),
            request,
            user,
            item.track,
            source,
            i16::try_from(position).unwrap_or(i16::MAX),
            item.explore,
            item.score,
            features,
            now
        )
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await
}

pub async fn resolve(db: &PgPool) -> sqlx::Result<u64> {
    let done = sqlx::query!(
        r#"UPDATE recommendation_impressions i SET outcome = r.outcome, resolved_at = now()
           FROM (
               SELECT p.id,
                      CASE
                          WHEN s.started_at IS NULL AND p.created_at > now() - interval '6 hours' THEN NULL
                          WHEN s.started_at IS NULL AND EXISTS (
                              SELECT 1 FROM recommendation_impressions n
                              WHERE n.user_id = p.user_id AND n.created_at > p.created_at AND n.request_id <> p.request_id)
                              THEN $2::int2
                          WHEN s.started_at IS NULL THEN $3::int2
                          WHEN t.type = 3 THEN $4::int2
                          WHEN t.type = 4 AND (t.listened_seconds < $1 OR (t.duration_seconds > 0
                               AND t.listened_seconds::float8 / t.duration_seconds < 0.2)) THEN $5::int2
                          WHEN t.type = 4 OR s.started_at < now() - interval '6 hours' THEN $6::int2
                      END AS outcome
               FROM recommendation_impressions p
               LEFT JOIN LATERAL (
                   SELECT min(e.occurred_at) AS started_at FROM playback_events e
                   WHERE e.user_id = p.user_id AND e.track_id = p.track_id AND e.type = 1 AND e.source LIKE 'radio%'
                     AND e.occurred_at >= p.created_at - interval '1 minute'
                     AND e.occurred_at < p.created_at + interval '6 hours'
               ) s ON true
               LEFT JOIN LATERAL (
                   SELECT e.type, e.listened_seconds, e.duration_seconds FROM playback_events e
                   WHERE e.user_id = p.user_id AND e.track_id = p.track_id AND e.type IN (3, 4)
                     AND e.occurred_at >= s.started_at
                   ORDER BY e.occurred_at LIMIT 1
               ) t ON s.started_at IS NOT NULL
               WHERE p.outcome IS NULL
           ) r
           WHERE i.id = r.id AND r.outcome IS NOT NULL"#,
        THRESHOLD_SECONDS,
        Outcome::Superseded as i16,
        Outcome::Abandoned as i16,
        Outcome::Finished as i16,
        Outcome::EarlySkip as i16,
        Outcome::Partial as i16
    )
    .execute(db)
    .await?;
    Ok(done.rows_affected())
}

pub async fn stats(db: &PgPool, user: Uuid, since: DateTime<Utc>) -> sqlx::Result<Vec<ImpressionStatsDto>> {
    let rows = sqlx::query!(
        r#"SELECT explore,
                  count(*) AS "shown!",
                  count(*) FILTER (WHERE outcome = $3) AS "finished!",
                  count(*) FILTER (WHERE outcome = $4) AS "partial!",
                  count(*) FILTER (WHERE outcome = $5) AS "early_skips!",
                  count(*) FILTER (WHERE outcome IN ($6, $7)) AS "unplayed!",
                  count(*) FILTER (WHERE outcome IS NULL) AS "pending!"
           FROM recommendation_impressions
           WHERE user_id = $1 AND created_at >= $2
           GROUP BY explore ORDER BY explore"#,
        user,
        since,
        Outcome::Finished as i16,
        Outcome::Partial as i16,
        Outcome::EarlySkip as i16,
        Outcome::Superseded as i16,
        Outcome::Abandoned as i16
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| ImpressionStatsDto {
            explore: row.explore,
            shown: row.shown,
            finished: row.finished,
            partial: row.partial,
            early_skips: row.early_skips,
            unplayed: row.unplayed,
            pending: row.pending,
        })
        .collect())
}

pub async fn prune(db: &PgPool, days: i32) -> sqlx::Result<()> {
    sqlx::query!("DELETE FROM recommendation_impressions WHERE created_at < now() - make_interval(days => $1)", days)
        .execute(db)
        .await?;
    Ok(())
}
