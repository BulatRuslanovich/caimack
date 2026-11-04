// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use chrono::Utc;
use serde::de::{self, Deserializer};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{AppError, AppResult};

const DEFAULT_TIME_ZONE: &str = "UTC";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
pub enum AudioQuality {
    Low,
    Normal,
    Original,
}

impl AudioQuality {
    pub fn from_db(value: i32) -> Option<Self> {
        Some(match value {
            0 => Self::Low,
            1 => Self::Normal,
            3 => Self::Original,
            _ => return None,
        })
    }

    pub fn to_db(self) -> i32 {
        match self {
            Self::Low => 0,
            Self::Normal => 1,
            Self::Original => 3,
        }
    }

    pub fn hls_kbps(self) -> Option<u32> {
        match self {
            Self::Low => Some(64),
            Self::Normal => Some(128),
            Self::Original => None,
        }
    }

    pub fn slug(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Normal => "normal",
            Self::Original => "original",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "low" => Some(Self::Low),
            "normal" => Some(Self::Normal),
            "original" => Some(Self::Original),
            number => number.parse().ok().and_then(Self::from_db),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestedQuality {
    Known(AudioQuality),
    Unknown,
}

impl<'de> Deserialize<'de> for RequestedQuality {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(deserializer)?;
        match &value {
            serde_json::Value::String(name) => match AudioQuality::parse(name) {
                Some(quality) => Ok(Self::Known(quality)),
                None if name.trim().parse::<i64>().is_ok() => Ok(Self::Unknown),
                None => Err(de::Error::custom(format!("unknown audio quality '{name}'"))),
            },
            serde_json::Value::Number(number) => Ok(number
                .as_i64()
                .and_then(|n| i32::try_from(n).ok())
                .and_then(AudioQuality::from_db)
                .map_or(Self::Unknown, Self::Known)),
            _ => Err(de::Error::custom("audio quality must be a name or a number")),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSettingsDto {
    pub quality: AudioQuality,
    pub time_zone: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateUserSettingsRequest {
    pub quality: Option<RequestedQuality>,
    pub time_zone: Option<String>,
}

pub async fn get(db: &PgPool, user: Uuid) -> AppResult<UserSettingsDto> {
    let row = sqlx::query!("SELECT quality, time_zone FROM user_settings WHERE user_id = $1", user)
        .fetch_optional(db)
        .await?;
    Ok(match row {
        Some(row) => UserSettingsDto {
            quality: AudioQuality::from_db(row.quality).unwrap_or(AudioQuality::Normal),
            time_zone: row.time_zone,
        },
        None => UserSettingsDto { quality: AudioQuality::Normal, time_zone: DEFAULT_TIME_ZONE.to_owned() },
    })
}

pub async fn update(db: &PgPool, user: Uuid, request: UpdateUserSettingsRequest) -> AppResult<UserSettingsDto> {
    let mut settings = get(db, user).await?;

    match request.quality {
        Some(RequestedQuality::Known(quality)) => settings.quality = quality,
        Some(RequestedQuality::Unknown) => return Err(AppError::validation("Unknown audio quality.")),
        None => {}
    }

    if let Some(time_zone) = request.time_zone.as_deref().map(str::trim) {
        if time_zone.is_empty() || time_zone.chars().count() > 64 {
            return Err(AppError::validation("The time zone name is not valid."));
        }
        let known = sqlx::query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = $1) AS "exists!""#,
            time_zone
        )
        .fetch_one(db)
        .await?;
        if !known {
            return Err(AppError::validation("Unknown time zone '{0}'.").arg(time_zone));
        }
        settings.time_zone = time_zone.to_owned();
    }

    sqlx::query!(
        "INSERT INTO user_settings (user_id, quality, time_zone, updated_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET quality = EXCLUDED.quality, time_zone = EXCLUDED.time_zone,
                                             updated_at = EXCLUDED.updated_at",
        user,
        settings.quality.to_db(),
        settings.time_zone,
        Utc::now()
    )
    .execute(db)
    .await?;
    Ok(settings)
}
