// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use anyhow::{Context, bail};
use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::password;
use crate::config::OwnerConfig;
use crate::text::normalize_username;

pub async fn ensure_owner(db: &PgPool, owner: &OwnerConfig) -> anyhow::Result<()> {
    let username = normalize_username(&owner.username);

    let existing = sqlx::query!("SELECT id, is_admin, is_active FROM users WHERE username = $1", username)
        .fetch_optional(db)
        .await
        .context("Could not look up the owner account")?;

    if let Some(user) = existing {
        if !user.is_admin || !user.is_active {
            sqlx::query!("UPDATE users SET is_admin = TRUE, is_active = TRUE WHERE id = $1", user.id)
                .execute(db)
                .await?;
            tracing::info!("Restored administrator access for the owner account {username}");
        }

        if let Some(password) = owner.password.as_ref().filter(|_| owner.reset_password) {
            let hash = password::hash(password.clone()).await?;
            let mut tx = db.begin().await?;
            sqlx::query!("UPDATE users SET password_hash = $2 WHERE id = $1", user.id, hash).execute(&mut *tx).await?;
            sqlx::query!("DELETE FROM refresh_tokens WHERE user_id = $1", user.id).execute(&mut *tx).await?;
            tx.commit().await?;
            tracing::warn!("Password for user {username} was reset from configuration");
        }

        return Ok(());
    }

    let Some(password) = owner.password.as_ref() else {
        bail!(
            "No user exists yet and OWNER_PASSWORD is not set. Set it (see .env.example) so the first account can be created."
        );
    };

    let hash = password::hash(password.clone()).await?;
    sqlx::query!(
        "INSERT INTO users (id, username, password_hash, is_admin, is_active, created_at) VALUES ($1, $2, $3, TRUE, TRUE, $4)",
        Uuid::now_v7(),
        username,
        hash,
        Utc::now()
    )
    .execute(db)
    .await
    .context("Could not create the owner account")?;

    tracing::info!("Created initial user {username}");
    Ok(())
}
