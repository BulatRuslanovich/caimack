// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use chrono::{DateTime, Utc};
use reco::evaluation::{self, Case};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use super::{index, listener, sound};
use crate::catalog::{dto::TrackDto, tracks};
use crate::{AppError, AppResult};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub schema_version: u8,
    pub created_at: DateTime<Utc>,
    pub username: String,
    pub model_id: &'static str,
    pub strategy: &'static str,
    pub track_count: usize,
    pub cases: Vec<Case>,
    pub tracks: Vec<TrackDto>,
}

/// Local server tooling only: no HTTP endpoint, audio analysis, or database writes.
pub async fn report(db: &PgPool, username: &str, seeds: &[Uuid]) -> AppResult<Report> {
    if seeds.len() > 30 {
        return Err(AppError::validation("Provide at most 30 seed tracks."));
    }
    let user: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE username = $1")
        .bind(username)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::not_found("User not found."))?;
    let now = Utc::now();
    let mut snapshot = index::load(db).await?;
    if snapshot.is_empty() {
        return Err(AppError::validation(
            "No current MERT embeddings found. Wait for analysis to finish before evaluating.",
        ));
    }
    let (matches, _) = sound::SoundAlikes::default().refresh(db).await?;
    snapshot.set_sound_alikes(&sound::groups(&matches, &sound::dismissed(db).await?));
    let listener = listener::load(db, user, now).await?;
    let seeds = if seeds.is_empty() {
        evaluation::seeds(&snapshot, &listener, 20)
    } else {
        let mut unique = std::collections::HashSet::new();
        if seeds.iter().any(|id| snapshot.row_of(*id).is_none() || !unique.insert(*id)) {
            return Err(AppError::validation("Seed tracks must be distinct and have current MERT embeddings."));
        }
        seeds.to_vec()
    };
    if seeds.is_empty() {
        return Err(AppError::validation("No eligible seed tracks remain after applying your recommendation rules."));
    }
    let count = snapshot.len();
    let cases = tokio::task::spawn_blocking(move || evaluation::compare(&snapshot, &listener, &seeds))
        .await
        .map_err(AppError::internal)?;
    let mut ids: Vec<Uuid> = cases
        .iter()
        .flat_map(|case| {
            std::iter::once(case.seed_track_id)
                .chain(case.variants.iter().flat_map(|variant| variant.picks.iter().map(|pick| pick.track_id)))
        })
        .collect();
    ids.sort_unstable();
    ids.dedup();
    let found = tracks::by_ids(db, user, &ids).await?;
    let tracks = ids.iter().filter_map(|id| found.get(id).cloned()).collect();
    Ok(Report {
        schema_version: 1,
        created_at: now,
        username: username.to_owned(),
        model_id: media::mert::MODEL_ID,
        strategy: media::mert::windows::STRATEGY,
        track_count: count,
        cases,
        tracks,
    })
}
