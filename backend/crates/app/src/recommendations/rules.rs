// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use uuid::Uuid;

use super::Recommendations;
use crate::{AppError, AppResult, json};

const DEFAULT_COOLDOWN_DAYS: i64 = 30;
const MAX_COOLDOWN_DAYS: i64 = 365;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Block = 1,
    Downrank = 2,
    Cooldown = 3,
}

impl Action {
    fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "block" => Self::Block,
            "downrank" => Self::Downrank,
            "cooldown" => Self::Cooldown,
            _ => return None,
        })
    }

    fn name(value: i16) -> &'static str {
        match value {
            2 => "downrank",
            3 => "cooldown",
            _ => "block",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Target {
    Track = 1,
    Artist = 2,
    Album = 3,
    Genre = 4,
}

impl Target {
    fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "track" => Self::Track,
            "artist" => Self::Artist,
            "album" => Self::Album,
            "genre" => Self::Genre,
            _ => return None,
        })
    }

    fn name(value: i16) -> &'static str {
        match value {
            1 => "track",
            3 => "album",
            4 => "genre",
            _ => "artist",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRuleRequest {
    pub action: String,
    pub target_type: String,
    pub target_id: Uuid,
    pub days: Option<i64>,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleDto {
    pub id: Uuid,
    pub action: &'static str,
    pub target_type: &'static str,
    pub target_id: Uuid,
    pub name: String,
    pub artist_name: Option<String>,
    #[serde(serialize_with = "json::optional_time")]
    pub until: Option<DateTime<Utc>>,
    #[serde(serialize_with = "json::time")]
    pub created_at: DateTime<Utc>,
}

impl Recommendations {
    pub async fn rules(&self, user: Uuid) -> AppResult<Vec<RuleDto>> {
        sqlx::query!("DELETE FROM taste_rules WHERE user_id = $1 AND until <= now()", user).execute(&self.db).await?;
        let rows = sqlx::query!(
            r#"SELECT r.id, r.action, r.target_type, r.target_id, r.until, r.created_at,
                      COALESCE(t.title, ar.name, al.title, g.name) AS name,
                      COALESCE(ta.name, ala.name) AS artist_name
               FROM taste_rules r
               LEFT JOIN tracks t ON r.target_type = 1 AND t.id = r.target_id
               LEFT JOIN artists ta ON ta.id = t.artist_id
               LEFT JOIN artists ar ON r.target_type = 2 AND ar.id = r.target_id
               LEFT JOIN albums al ON r.target_type = 3 AND al.id = r.target_id
               LEFT JOIN artists ala ON ala.id = al.artist_id
               LEFT JOIN genres g ON r.target_type = 4 AND g.id = r.target_id
               WHERE r.user_id = $1
               ORDER BY r.created_at DESC"#,
            user
        )
        .fetch_all(&self.db)
        .await?;
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                Some(RuleDto {
                    id: row.id,
                    action: Action::name(row.action),
                    target_type: Target::name(row.target_type),
                    target_id: row.target_id,
                    name: row.name?,
                    artist_name: row
                        .artist_name
                        .filter(|_| row.target_type == Target::Track as i16 || row.target_type == Target::Album as i16),
                    until: row.until,
                    created_at: row.created_at,
                })
            })
            .collect())
    }

    pub async fn add_rule(&self, user: Uuid, request: CreateRuleRequest) -> AppResult<RuleDto> {
        let action = Action::parse(&request.action)
            .ok_or_else(|| AppError::validation("Unknown rule '{0}'.").arg(&request.action))?;
        let target = Target::parse(&request.target_type)
            .ok_or_else(|| AppError::validation("Unknown rule target '{0}'.").arg(&request.target_type))?;
        let until = match action {
            Action::Cooldown => {
                let days = request.days.unwrap_or(DEFAULT_COOLDOWN_DAYS);
                if !(1..=MAX_COOLDOWN_DAYS).contains(&days) {
                    return Err(AppError::validation("A pause lasts from 1 to {0} days.").arg(MAX_COOLDOWN_DAYS));
                }
                Some(Utc::now() + Duration::days(days))
            }
            Action::Block | Action::Downrank => None,
        };

        let exists = sqlx::query_scalar!(
            r#"SELECT CASE $1::int2
                   WHEN 1 THEN EXISTS (SELECT 1 FROM tracks WHERE id = $2)
                   WHEN 2 THEN EXISTS (SELECT 1 FROM artists WHERE id = $2)
                   WHEN 3 THEN EXISTS (SELECT 1 FROM albums WHERE id = $2)
                   ELSE EXISTS (SELECT 1 FROM genres WHERE id = $2) END AS "exists!""#,
            target as i16,
            request.target_id
        )
        .fetch_one(&self.db)
        .await?;
        if !exists {
            return Err(AppError::not_found("The requested resource was not found."));
        }

        let id = sqlx::query_scalar!(
            "INSERT INTO taste_rules (id, user_id, action, target_type, target_id, until, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (user_id, target_type, target_id) DO UPDATE SET
                 action = EXCLUDED.action, until = EXCLUDED.until, created_at = EXCLUDED.created_at
             RETURNING id",
            Uuid::now_v7(),
            user,
            action as i16,
            target as i16,
            request.target_id,
            until,
            Utc::now()
        )
        .fetch_one(&self.db)
        .await?;
        self.listeners.forget(user);

        self.rules(user)
            .await?
            .into_iter()
            .find(|rule| rule.id == id)
            .ok_or_else(|| AppError::not_found("The requested resource was not found."))
    }

    pub async fn remove_rule(&self, user: Uuid, id: Uuid) -> AppResult<()> {
        let removed = sqlx::query!("DELETE FROM taste_rules WHERE id = $1 AND user_id = $2", id, user)
            .execute(&self.db)
            .await?
            .rows_affected();
        if removed == 0 {
            return Err(AppError::not_found("The requested resource was not found."));
        }
        self.listeners.forget(user);
        Ok(())
    }
}
