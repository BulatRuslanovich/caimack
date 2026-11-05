// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use super::Recommendations;
use crate::AppResult;
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoodDto {
    pub key: String,
    pub album_ids: Vec<Uuid>,
}

impl Recommendations {
    // Older mobile clients still request this endpoint. MERT has no text/mood
    // space; keep an empty response while those clients are upgraded.
    pub async fn moods(&self) -> AppResult<Vec<MoodDto>> {
        Ok(vec![])
    }
}
