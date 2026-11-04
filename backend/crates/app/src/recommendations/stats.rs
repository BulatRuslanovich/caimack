// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use chrono::Utc;
use serde::Serialize;
use uuid::Uuid;

use super::Recommendations;
use super::impressions::{self, ImpressionStatsDto};
use super::listener::{EVENT_RETENTION_DAYS, is_recommendation};
use crate::library::history::THRESHOLD_SECONDS;
use crate::{AppError, AppResult};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceStatsDto {
    pub source: Option<String>,
    pub recommended: bool,
    pub impressions: i32,
    pub starts: i32,
    pub completed: i32,
    pub skipped: i32,
    pub skipped_early: i32,
    pub liked: i32,
    pub listened_seconds: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationStatsDto {
    pub days: i32,
    pub listened_seconds: i64,
    pub recommended_seconds: i64,
    pub sources: Vec<SourceStatsDto>,
    pub radio: Vec<ImpressionStatsDto>,
}

impl Recommendations {
    pub async fn stats(&self, user: Uuid, days: i32) -> AppResult<RecommendationStatsDto> {
        if !(1..=EVENT_RETENTION_DAYS).contains(&days) {
            return Err(AppError::validation("Days must be between 1 and {0}.").arg(EVENT_RETENTION_DAYS));
        }
        let since = Utc::now() - chrono::Duration::days(i64::from(days));
        impressions::resolve(&self.db).await?;
        let radio = impressions::stats(&self.db, user, since).await?;

        let rows = sqlx::query!(
            r#"WITH likes AS (
                   SELECT s.source, COUNT(DISTINCT s.track_id)::int AS liked
                   FROM playback_events s
                   WHERE s.user_id = $1 AND s.type = 1 AND s.occurred_at >= $2 AND s.source IS NOT NULL
                     AND EXISTS (SELECT 1 FROM playback_events l
                                 WHERE l.user_id = s.user_id AND l.track_id = s.track_id AND l.type = 7
                                   AND l.occurred_at >= s.occurred_at AND l.occurred_at <= s.occurred_at + interval '1 day')
                   GROUP BY s.source
               )
               SELECT e.source,
                      (COUNT(*) FILTER (WHERE e.type = 15))::int AS "impressions!",
                      (COUNT(*) FILTER (WHERE e.type = 1))::int AS "starts!",
                      (COUNT(*) FILTER (WHERE e.type = 3))::int AS "completed!",
                      (COUNT(*) FILTER (WHERE e.type = 4))::int AS "skipped!",
                      (COUNT(*) FILTER (WHERE e.type = 4 AND e.listened_seconds < $3))::int AS "skipped_early!",
                      COALESCE(SUM(GREATEST(e.listened_seconds, 0)) FILTER (WHERE e.type IN (3, 4)), 0)::bigint AS "listened_seconds!",
                      COALESCE(MAX(l.liked), 0) AS "liked!"
               FROM playback_events e
               LEFT JOIN likes l ON l.source = e.source
               WHERE e.user_id = $1 AND e.occurred_at >= $2 AND e.type IN (1, 3, 4, 15)
               GROUP BY e.source"#,
            user,
            since,
            THRESHOLD_SECONDS
        )
        .fetch_all(&self.db)
        .await?;

        let mut sources: Vec<SourceStatsDto> = rows
            .into_iter()
            .filter(|row| row.starts > 0 || row.impressions > 0)
            .map(|row| SourceStatsDto {
                recommended: row.source.as_deref().is_some_and(is_recommendation),
                liked: if row.source.is_some() { row.liked } else { 0 },
                source: row.source,
                impressions: row.impressions,
                starts: row.starts,
                completed: row.completed,
                skipped: row.skipped,
                skipped_early: row.skipped_early,
                listened_seconds: row.listened_seconds,
            })
            .collect();
        sources.sort_by(|a, b| {
            b.listened_seconds.cmp(&a.listened_seconds).then(b.starts.cmp(&a.starts)).then(a.source.cmp(&b.source))
        });

        Ok(RecommendationStatsDto {
            days,
            listened_seconds: sources.iter().map(|row| row.listened_seconds).sum(),
            recommended_seconds: sources.iter().filter(|row| row.recommended).map(|row| row.listened_seconds).sum(),
            sources,
            radio,
        })
    }
}
