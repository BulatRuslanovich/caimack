// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

use crate::AppResult;
use crate::catalog::dto::TrackDto;
use crate::catalog::tracks;
use crate::paging::{PageRequest, Paged};

pub async fn list(db: &PgPool, user: Uuid, page: PageRequest) -> AppResult<Paged<TrackDto>> {
    tracks::page(
        db,
        user,
        |query| {
            query.push(" JOIN favorites fav ON fav.track_id = t.id WHERE fav.user_id = ").push_bind(user);
        },
        |query| {
            query.push("fav.created_at DESC");
        },
        page,
    )
    .await
}

pub async fn add(db: &PgPool, user: Uuid, track_id: Uuid) -> AppResult<()> {
    tracks::require(db, track_id).await?;
    sqlx::query!(
        "INSERT INTO favorites (user_id, track_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (user_id, track_id) DO NOTHING",
        user,
        track_id,
        Utc::now()
    )
    .execute(db)
    .await?;
    Ok(())
}

pub async fn remove(db: &PgPool, user: Uuid, track_id: Uuid) -> AppResult<()> {
    sqlx::query!("DELETE FROM favorites WHERE user_id = $1 AND track_id = $2", user, track_id).execute(db).await?;
    Ok(())
}
