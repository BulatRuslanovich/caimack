// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use reco::listening::{self, End, Grade};
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use super::listener::is_recommendation;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningStatsDto {
    pub source: String,
    pub early_skips: i64,
    pub partial: i64,
    pub near_complete: i64,
    pub unrated: i64,
}

#[derive(FromRow)]
struct Listen {
    source: Option<String>,
    kind: Option<i32>,
    listened: Option<i32>,
    duration: i32,
}

/// One terminal event per attempt, bounded by the next start on the same device.
/// A pause, missing end or a completion reached by seeking is not a dislike.
pub async fn load(db: &PgPool, user: Uuid, since: DateTime<Utc>) -> sqlx::Result<Vec<ListeningStatsDto>> {
    let listens = sqlx::query_as::<_, Listen>(
        r#"WITH starts AS (
            SELECT id, user_id, session_id, track_id, source, duration_seconds, occurred_at,
                   lead(occurred_at) OVER device AS next_at,
                   lead(id) OVER device AS next_id
            FROM playback_events
            WHERE user_id = $1 AND occurred_at >= $2 AND type = 1 AND track_id IS NOT NULL
            WINDOW device AS (PARTITION BY session_id ORDER BY occurred_at, id)
        )
        SELECT s.source, t.type AS kind, t.listened_seconds AS listened,
               COALESCE(NULLIF(t.duration_seconds, 0), s.duration_seconds) AS duration
        FROM starts s
        LEFT JOIN LATERAL (
            SELECT e.type, e.listened_seconds, e.duration_seconds
            FROM playback_events e
            WHERE e.user_id = $1 AND e.session_id = s.session_id AND e.track_id = s.track_id
              AND (e.occurred_at, e.id) > (s.occurred_at, s.id)
              AND e.occurred_at < s.occurred_at + interval '1 day'
              AND (s.next_at IS NULL OR (e.occurred_at, e.id) < (s.next_at, s.next_id))
              AND e.type IN (3, 4)
            ORDER BY e.occurred_at, e.id LIMIT 1
        ) t ON true"#,
    )
    .bind(user)
    .bind(since)
    .fetch_all(db)
    .await?;

    let mut sources = BTreeMap::new();
    for listen in listens {
        let Some(source) = listen.source.filter(|source| is_recommendation(source)) else { continue };
        let row = sources
            .entry(source.clone())
            .or_insert_with(|| ListeningStatsDto { source, ..ListeningStatsDto::default() });
        let end = match listen.kind {
            Some(3) => Some(End::Completed),
            Some(4) => Some(End::Skipped),
            _ => None,
        };
        let grade = end.zip(listen.listened).and_then(|(end, heard)| listening::grade(end, heard, listen.duration));
        match grade {
            Some(Grade::EarlySkip) => row.early_skips += 1,
            Some(Grade::Partial) => row.partial += 1,
            Some(Grade::NearComplete) => row.near_complete += 1,
            None => row.unrated += 1,
        }
    }
    Ok(sources.into_values().collect())
}
