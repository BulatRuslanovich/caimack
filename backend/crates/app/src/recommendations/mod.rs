// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

mod compute;
pub mod duplicates;
pub mod evaluation;
pub mod home;
pub mod impressions;
pub mod index;
pub mod listener;
pub mod maintenance;
pub mod map;
pub mod moods;
pub mod radio;
pub mod recap;
pub mod rules;
mod session;
pub mod sound;
pub mod stats;

use serde::Serialize;
use serde_with::skip_serializing_none;
use sqlx::PgPool;
use uuid::Uuid;

use self::index::EmbeddingIndex;
use self::listener::Listeners;
use self::map::MapCache;
use crate::catalog::dto::TrackDto;

#[derive(Clone)]
pub struct Recommendations {
    pub db: PgPool,
    pub enabled: bool,
    pub index: EmbeddingIndex,
    pub listeners: Listeners,
    pub map: MapCache,
    compute: compute::ComputePool,
}

impl Recommendations {
    pub fn new(db: PgPool) -> Self {
        Self {
            db,
            enabled: true,
            index: EmbeddingIndex::default(),
            listeners: Listeners::default(),
            map: MapCache::default(),
            compute: compute::ComputePool::default(),
        }
    }
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReasonDto {
    pub kind: &'static str,
    pub subject: Option<String>,
    pub subject_id: Option<Uuid>,
}

impl ReasonDto {
    pub fn new(kind: &'static str) -> Self {
        Self { kind, subject: None, subject_id: None }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SignalsDto {
    pub explore: bool,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendedTrackDto {
    pub track: TrackDto,
    pub reason: ReasonDto,
    pub score: Option<f64>,
    pub signals: Option<SignalsDto>,
}

pub mod reasons {
    pub const BECAUSE_YOU_LISTENED: &str = "becauseYouListened";
    pub const FRESH_IN_LIBRARY: &str = "freshInLibrary";
    pub const SOUNDS_LIKE: &str = "soundsLike";
    pub const MATCHES_YOUR_TASTE: &str = "matchesYourTaste";
    pub const DISCOVERY: &str = "discovery";
}
