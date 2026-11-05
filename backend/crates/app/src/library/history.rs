// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::catalog::dto::TrackDto;
use crate::catalog::tracks;
use crate::paging::{PageRequest, Paged};
use crate::{AppError, AppResult, json};

pub const THRESHOLD_SECONDS: i32 = 30;
const RETENTION_ENTRIES: i64 = 1000;
const TRIM_SLACK: i64 = 100;
const DEDUPE_WINDOW: Duration = Duration::minutes(30);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntryDto {
    pub id: Uuid,
    pub track: TrackDto,
    #[serde(serialize_with = "json::time")]
    pub played_at: DateTime<Utc>,
    pub playback_position: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordPlayRequest {
    pub track_id: Uuid,
    pub playback_position: i32,
    pub listened_seconds: i32,
}

pub async fn list(db: &PgPool, user: Uuid, page: PageRequest) -> AppResult<Paged<HistoryEntryDto>> {
    let total = sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM listening_history WHERE user_id = $1"#, user)
        .fetch_one(db)
        .await?;
    let rows = sqlx::query!(
        "SELECT id, track_id, played_at, playback_position FROM listening_history
         WHERE user_id = $1 ORDER BY played_at DESC LIMIT $2 OFFSET $3",
        user,
        page.limit(),
        page.offset()
    )
    .fetch_all(db)
    .await?;

    let ids: Vec<Uuid> = rows.iter().map(|row| row.track_id).collect();
    let found = tracks::by_ids(db, user, &ids).await?;
    let items = rows
        .into_iter()
        .filter_map(|row| {
            let track = found.get(&row.track_id)?.clone();
            Some(HistoryEntryDto {
                id: row.id,
                track,
                played_at: row.played_at,
                playback_position: row.playback_position,
            })
        })
        .collect();
    Ok(Paged::new(items, total, page))
}

pub async fn recent(db: &PgPool, user: Uuid, page: PageRequest) -> AppResult<Paged<TrackDto>> {
    let total = sqlx::query_scalar!(
        r#"SELECT count(DISTINCT track_id) AS "count!" FROM listening_history WHERE user_id = $1"#,
        user
    )
    .fetch_one(db)
    .await?;
    let ids = sqlx::query_scalar!(
        r#"SELECT track_id AS "track_id!" FROM listening_history WHERE user_id = $1
           GROUP BY track_id ORDER BY max(played_at) DESC LIMIT $2 OFFSET $3"#,
        user,
        page.limit(),
        page.offset()
    )
    .fetch_all(db)
    .await?;

    let mut found = tracks::by_ids(db, user, &ids).await?;
    let items = ids.iter().filter_map(|id| found.remove(id)).collect();
    Ok(Paged::new(items, total, page))
}

pub async fn record(db: &PgPool, user: Uuid, request: RecordPlayRequest) -> AppResult<()> {
    let duration = sqlx::query_scalar!("SELECT duration_seconds FROM tracks WHERE id = $1", request.track_id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::not_found("Track not found."))?;
    let threshold = THRESHOLD_SECONDS.min(duration.saturating_sub(1).max(1));
    if request.playback_position < 0 || request.listened_seconds < threshold {
        return Err(AppError::validation("A play is only recorded after {0} seconds of listening.").arg(threshold));
    }

    let now = Utc::now();
    let mut tx = db.begin().await?;
    let refreshed = sqlx::query!(
        "UPDATE listening_history SET played_at = $3, playback_position = $4
         WHERE id = (SELECT id FROM listening_history
                     WHERE user_id = $1 AND track_id = $2 AND played_at >= $5
                     ORDER BY played_at DESC LIMIT 1)",
        user,
        request.track_id,
        now,
        request.playback_position,
        now - DEDUPE_WINDOW
    )
    .execute(&mut *tx)
    .await?;

    if refreshed.rows_affected() == 0 {
        sqlx::query!(
            "INSERT INTO listening_history (id, user_id, track_id, played_at, playback_position) VALUES ($1, $2, $3, $4, $5)",
            Uuid::now_v7(),
            user,
            request.track_id,
            now,
            request.playback_position
        )
        .execute(&mut *tx)
        .await?;
    }

    let overflowing = oldest_beyond(&mut tx, user, RETENTION_ENTRIES + TRIM_SLACK).await?.is_some();
    if overflowing && let Some(cutoff) = oldest_beyond(&mut tx, user, RETENTION_ENTRIES).await? {
        sqlx::query!("DELETE FROM listening_history WHERE user_id = $1 AND played_at <= $2", user, cutoff)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    tracing::debug!("Recorded play of track {} at {}s", request.track_id, request.playback_position);
    Ok(())
}

async fn oldest_beyond(conn: &mut sqlx::PgConnection, user: Uuid, keep: i64) -> AppResult<Option<DateTime<Utc>>> {
    Ok(sqlx::query_scalar!(
        "SELECT played_at FROM listening_history WHERE user_id = $1 ORDER BY played_at DESC OFFSET $2 LIMIT 1",
        user,
        keep
    )
    .fetch_optional(&mut *conn)
    .await?)
}

pub async fn clear(db: &PgPool, user: Uuid) -> AppResult<()> {
    sqlx::query!("DELETE FROM listening_history WHERE user_id = $1", user).execute(db).await?;
    Ok(())
}
