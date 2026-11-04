// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_with::skip_serializing_none;
use sqlx::PgPool;
use uuid::Uuid;

use super::Client;
use crate::json;

const RECENT: i64 = 30;
const MAX_USERNAME: usize = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Password = 1,
    Invitation = 2,
}

impl Method {
    fn name(value: i16) -> &'static str {
        match value {
            2 => "invitation",
            _ => "password",
        }
    }
}

#[skip_serializing_none]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInDto {
    pub method: &'static str,
    pub success: bool,
    pub reason: Option<String>,
    pub ip: Option<String>,
    pub user_agent: Option<String>,
    pub device_name: Option<String>,
    #[serde(serialize_with = "json::time")]
    pub occurred_at: DateTime<Utc>,
}

pub struct Attempt<'a> {
    pub user: Option<Uuid>,
    pub username: &'a str,
    pub method: Method,
    pub failure: Option<&'a str>,
}

pub async fn record(db: &PgPool, attempt: Attempt<'_>, client: &Client) {
    let username: String = attempt.username.chars().take(MAX_USERNAME).collect();
    let result = sqlx::query!(
        "INSERT INTO auth_events (id, user_id, username, method, success, reason, ip, user_agent, device_name, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        Uuid::now_v7(),
        attempt.user,
        username,
        attempt.method as i16,
        attempt.failure.is_none(),
        attempt.failure,
        client.address.map(|address| address.to_string()),
        client.user_agent(),
        client.device_name(),
        Utc::now()
    )
    .execute(db)
    .await;
    if let Err(error) = result {
        tracing::error!("Recording a sign-in for {username} failed: {error}");
    }
}

pub async fn recent(db: &PgPool, user: Uuid, username: &str) -> sqlx::Result<Vec<SignInDto>> {
    let rows = sqlx::query!(
        "SELECT method, success, reason, ip, user_agent, device_name, occurred_at FROM auth_events
         WHERE user_id = $1 OR (user_id IS NULL AND username = $2)
         ORDER BY occurred_at DESC LIMIT $3",
        user,
        username,
        RECENT
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| SignInDto {
            method: Method::name(row.method),
            success: row.success,
            reason: row.reason,
            ip: row.ip,
            user_agent: row.user_agent,
            device_name: row.device_name,
            occurred_at: row.occurred_at,
        })
        .collect())
}

pub async fn prune(db: &PgPool, days: i32) -> sqlx::Result<()> {
    sqlx::query!("DELETE FROM auth_events WHERE occurred_at < now() - make_interval(days => $1)", days)
        .execute(db)
        .await?;
    Ok(())
}
