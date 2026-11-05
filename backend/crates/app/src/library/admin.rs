// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::auth::{AuthService, password};
use crate::paging::{PageRequest, Paged};
use crate::text::normalize_username;
use crate::{AppError, AppResult, json};

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AuthUserDto {
    pub id: Uuid,
    pub username: String,
    pub is_admin: bool,
    pub is_active: bool,
    #[serde(serialize_with = "json::time")]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateUserRequest {
    pub username: String,
    pub password: String,
    pub is_admin: bool,
}

pub async fn list(db: &PgPool, page: PageRequest) -> AppResult<Paged<AuthUserDto>> {
    let total = sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM users"#).fetch_one(db).await?;
    let users = sqlx::query_as!(
        AuthUserDto,
        "SELECT id, username, is_admin, is_active, created_at FROM users ORDER BY username LIMIT $1 OFFSET $2",
        page.limit(),
        page.offset()
    )
    .fetch_all(db)
    .await?;
    Ok(Paged::new(users, total, page))
}

pub async fn create(db: &PgPool, request: CreateUserRequest) -> AppResult<AuthUserDto> {
    let username = normalize_username(&request.username);
    let hash = password::hash(request.password).await?;

    let user = sqlx::query_as!(
        AuthUserDto,
        "INSERT INTO users (id, username, password_hash, is_admin, is_active, created_at)
         VALUES ($1, $2, $3, $4, TRUE, $5)
         RETURNING id, username, is_admin, is_active, created_at",
        Uuid::now_v7(),
        username,
        hash,
        request.is_admin,
        Utc::now()
    )
    .fetch_one(db)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::conflict("A user with that username already exists.")
        }
        _ => error.into(),
    })?;

    tracing::info!("Created user {} (admin: {})", user.username, user.is_admin);
    Ok(user)
}

pub async fn set_active(db: &PgPool, auth: &AuthService, id: Uuid, active: bool) -> AppResult<AuthUserDto> {
    let mut tx = db.begin().await?;
    let user = sqlx::query_as!(
        AuthUserDto,
        "UPDATE users SET is_active = $2 WHERE id = $1 RETURNING id, username, is_admin, is_active, created_at",
        id,
        active
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::not_found("User not found."))?;
    if !active {
        revoke_tokens(&mut tx, id).await?;
    }
    tx.commit().await?;
    if !active {
        auth.forget_user_sessions(id);
    }

    tracing::info!("User {} was {}", user.username, if active { "reactivated" } else { "deactivated" });
    Ok(user)
}

pub async fn set_admin(db: &PgPool, auth: &AuthService, id: Uuid, is_admin: bool) -> AppResult<AuthUserDto> {
    let mut tx = db.begin().await?;
    let previous = sqlx::query_scalar!("SELECT is_admin FROM users WHERE id = $1 FOR UPDATE", id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::not_found("User not found."))?;
    let user = sqlx::query_as!(
        AuthUserDto,
        "UPDATE users SET is_admin = $2 WHERE id = $1 RETURNING id, username, is_admin, is_active, created_at",
        id,
        is_admin
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::not_found("User not found."))?;
    if previous != is_admin {
        revoke_tokens(&mut tx, id).await?;
    }
    tx.commit().await?;
    if previous != is_admin {
        auth.forget_user_sessions(id);
    }

    tracing::info!("User {} is {} an administrator", user.username, if is_admin { "now" } else { "no longer" });
    Ok(user)
}

pub async fn reset_password(db: &PgPool, auth: &AuthService, id: Uuid, new_password: String) -> AppResult<()> {
    let hash = password::hash(new_password).await?;
    let mut tx = db.begin().await?;
    let user = sqlx::query!("UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING username", id, hash)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::not_found("User not found."))?;
    revoke_tokens(&mut tx, id).await?;
    tx.commit().await?;
    auth.forget_user_sessions(id);

    tracing::info!("Password of user {} was reset by an administrator", user.username);
    Ok(())
}

pub async fn revoke_sessions(db: &PgPool, auth: &AuthService, id: Uuid) -> AppResult<()> {
    let user = sqlx::query!("SELECT username FROM users WHERE id = $1", id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::not_found("User not found."))?;
    let mut tx = db.begin().await?;
    crate::auth::lock_user(&mut tx, id).await?;
    revoke_tokens(&mut tx, id).await?;
    tx.commit().await?;
    auth.forget_user_sessions(id);

    tracing::info!("All sessions of user {} were revoked", user.username);
    Ok(())
}

async fn revoke_tokens(conn: &mut sqlx::PgConnection, id: Uuid) -> AppResult<()> {
    sqlx::query!("DELETE FROM refresh_tokens WHERE user_id = $1", id).execute(&mut *conn).await?;
    Ok(())
}
