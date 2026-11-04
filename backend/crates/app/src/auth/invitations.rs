// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use sqlx::PgPool;
use uuid::Uuid;

use super::journal::{self, Attempt, Method};
use super::tokens::hash_refresh_token;
use super::{AuthResult, AuthService, Client, SessionStart, UserDto, password};
use crate::text::{normalize_username, valid_username};
use crate::{AppError, AppResult, json};

const DEFAULT_DAYS: i64 = 7;
const MAX_DAYS: i64 = 30;
const PASSWORD_LENGTH: std::ops::RangeInclusive<usize> = 8..=72;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInvitationRequest {
    pub is_admin: Option<bool>,
    pub days: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterRequest {
    pub token: String,
    pub username: String,
    pub password: String,
    pub device_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedInvitationDto {
    pub id: Uuid,
    pub token: String,
    #[serde(serialize_with = "json::time")]
    pub expires_at: DateTime<Utc>,
}

#[skip_serializing_none]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvitationDto {
    pub id: Uuid,
    pub is_admin: bool,
    pub created_by: Option<String>,
    #[serde(serialize_with = "json::time")]
    pub created_at: DateTime<Utc>,
    #[serde(serialize_with = "json::time")]
    pub expires_at: DateTime<Utc>,
    #[serde(serialize_with = "json::optional_time")]
    pub used_at: Option<DateTime<Utc>>,
    pub used_by: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvitationInfoDto {
    #[serde(serialize_with = "json::time")]
    pub expires_at: DateTime<Utc>,
}

pub async fn create(db: &PgPool, admin: Uuid, request: CreateInvitationRequest) -> AppResult<CreatedInvitationDto> {
    let days = request.days.unwrap_or(DEFAULT_DAYS);
    if !(1..=MAX_DAYS).contains(&days) {
        return Err(AppError::validation("An invitation lasts from 1 to {0} days.").arg(MAX_DAYS));
    }
    let token = URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>());
    let id = Uuid::now_v7();
    let now = Utc::now();
    let expires_at = now + Duration::days(days);
    sqlx::query!(
        "INSERT INTO invitations (id, token_hash, created_by, is_admin, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)",
        id,
        hash_refresh_token(&token),
        admin,
        request.is_admin.unwrap_or(false),
        now,
        expires_at
    )
    .execute(db)
    .await?;
    tracing::info!("Invitation {id} created by {admin}");
    Ok(CreatedInvitationDto { id, token, expires_at })
}

pub async fn list(db: &PgPool) -> AppResult<Vec<InvitationDto>> {
    let rows = sqlx::query!(
        r#"SELECT i.id, i.is_admin, i.created_at, i.expires_at, i.used_at, c.username AS "created_by?", u.username AS "used_by?"
           FROM invitations i
           LEFT JOIN users c ON c.id = i.created_by
           LEFT JOIN users u ON u.id = i.used_by
           WHERE (i.used_at IS NULL AND i.expires_at > now()) OR i.used_at > now() - interval '30 days'
           ORDER BY i.created_at DESC"#
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| InvitationDto {
            id: row.id,
            is_admin: row.is_admin,
            created_by: row.created_by,
            created_at: row.created_at,
            expires_at: row.expires_at,
            used_at: row.used_at,
            used_by: row.used_by,
        })
        .collect())
}

pub async fn revoke(db: &PgPool, id: Uuid) -> AppResult<()> {
    let removed = sqlx::query!("DELETE FROM invitations WHERE id = $1 AND used_at IS NULL", id)
        .execute(db)
        .await?
        .rows_affected();
    if removed == 0 {
        return Err(AppError::not_found("The invitation was not found or has already been used."));
    }
    Ok(())
}

pub async fn check(db: &PgPool, token: &str) -> AppResult<InvitationInfoDto> {
    let expires_at = sqlx::query_scalar!(
        "SELECT expires_at FROM invitations WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()",
        hash_refresh_token(token.trim())
    )
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::not_found("The invitation link is invalid or has expired."))?;
    Ok(InvitationInfoDto { expires_at })
}

impl AuthService {
    pub async fn register(&self, request: RegisterRequest, client: &Client) -> AppResult<AuthResult> {
        self.throttle.check_registration(client.address)?;
        let username = normalize_username(&request.username);
        if !valid_username(&username) {
            return Err(AppError::validation(
                "Use 5–20 characters for the username: lower-case letters, digits, . - _",
            ));
        }
        if !PASSWORD_LENGTH.contains(&request.password.len()) {
            return Err(AppError::validation("The password must be 8 to 72 characters long."));
        }

        let mut tx = self.db.begin().await?;
        let invitation = sqlx::query!(
            "SELECT id, is_admin FROM invitations
             WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE",
            hash_refresh_token(request.token.trim())
        )
        .fetch_optional(&mut *tx)
        .await?;
        let Some(invitation) = invitation else {
            self.throttle.registration_failed(client.address);
            return Err(AppError::not_found("The invitation link is invalid or has expired."));
        };

        let hash = password::hash(request.password).await?;
        let id = Uuid::now_v7();
        let now = Utc::now();
        let created = sqlx::query!(
            "INSERT INTO users (id, username, password_hash, is_admin, is_active, created_at) VALUES ($1, $2, $3, $4, TRUE, $5)",
            id,
            username,
            hash,
            invitation.is_admin,
            now
        )
        .execute(&mut *tx)
        .await;
        match created {
            Err(sqlx::Error::Database(error)) if error.is_unique_violation() => {
                return Err(AppError::conflict("A user with that username already exists."));
            }
            other => other?,
        };
        sqlx::query!("UPDATE invitations SET used_at = $2, used_by = $3 WHERE id = $1", invitation.id, now, id)
            .execute(&mut *tx)
            .await?;

        let client =
            Client { device_name: request.device_name.or_else(|| client.device_name.clone()), ..client.clone() };
        let user = UserDto { id, username: username.clone(), is_admin: invitation.is_admin };
        let result = self.issue(&mut tx, user, SessionStart::new(&client)).await?;
        tx.commit().await?;

        journal::record(
            &self.db,
            Attempt { user: Some(id), username: &username, method: Method::Invitation, failure: None },
            &client,
        )
        .await;
        tracing::info!("User {username} registered with invitation {}", invitation.id);
        Ok(result)
    }
}
