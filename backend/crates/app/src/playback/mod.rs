// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

pub mod connect;
pub mod registry;
pub mod signals;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::catalog::dto::TrackDto;
use crate::catalog::tracks;
use crate::{AppError, AppResult, json};
use registry::{PlaybackRegistry, PlaybackState};

const KEPT_BEHIND: usize = 100;
const KEPT_AHEAD: usize = 400;
const DEVICE_NAME_LENGTH: usize = 64;
const REPEAT_MODES: [&str; 3] = ["off", "all", "one"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStateReport {
    pub device_id: Option<String>,
    pub device_name: Option<String>,
    pub track_ids: Option<Vec<Uuid>>,
    #[serde(default)]
    pub index: i32,
    #[serde(default)]
    pub position_seconds: f64,
    #[serde(default)]
    pub is_playing: bool,
    #[serde(default)]
    pub shuffle: bool,
    pub repeat: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayingElsewhereDto {
    pub device_id: String,
    pub device_name: String,
    pub track: TrackDto,
    #[serde(serialize_with = "json::number")]
    pub position_seconds: f64,
    pub is_playing: bool,
    #[serde(serialize_with = "json::time")]
    pub reported_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackHandoffDto {
    pub device_id: String,
    pub device_name: String,
    pub tracks: Vec<TrackDto>,
    pub index: usize,
    #[serde(serialize_with = "json::number")]
    pub position_seconds: f64,
    pub shuffle: bool,
    pub repeat: String,
}

pub fn require_device(device_id: Option<&str>) -> AppResult<&str> {
    device_id.filter(|id| !id.trim().is_empty()).ok_or_else(|| AppError::validation("A deviceId is required."))
}

pub fn device_name(name: Option<&str>) -> String {
    name.unwrap_or_default().trim().chars().take(DEVICE_NAME_LENGTH).collect()
}

pub fn report(registry: &PlaybackRegistry, user: Uuid, report: PlaybackStateReport) -> AppResult<()> {
    let device_id = require_device(report.device_id.as_deref())?.to_owned();
    let track_ids = report.track_ids.unwrap_or_default();
    let index = usize::try_from(report.index).ok().filter(|&i| i < track_ids.len());
    let Some(index) = index else {
        return Err(AppError::validation("The index must point into the queue."));
    };
    let repeat = report.repeat.unwrap_or_else(|| "off".to_owned());
    if !REPEAT_MODES.contains(&repeat.as_str()) {
        return Err(AppError::validation("Repeat must be off, all or one."));
    }

    let from = index.saturating_sub(KEPT_BEHIND);
    let kept: Vec<Uuid> = track_ids.into_iter().skip(from).take(index - from + 1 + KEPT_AHEAD).collect();
    let accepted = registry.report(
        user,
        PlaybackState {
            device_id,
            device_name: device_name(report.device_name.as_deref()),
            track_ids: kept,
            index: index - from,
            position_seconds: report.position_seconds.max(0.0),
            is_playing: report.is_playing,
            shuffle: report.shuffle,
            repeat,
            reported_at: Utc::now(),
        },
    );
    if accepted { Ok(()) } else { Err(AppError::conflict("Another device holds playback.")) }
}

struct RestoredQueue {
    tracks: Vec<TrackDto>,
    index: usize,
    position_seconds: f64,
}

async fn restore(db: &PgPool, user: Uuid, state: &PlaybackState) -> AppResult<Option<RestoredQueue>> {
    let known = tracks::by_ids(db, user, &state.track_ids).await?;
    let mut queue = Vec::with_capacity(state.track_ids.len());
    let mut index = None;
    let mut position = state.position_seconds;

    for (i, id) in state.track_ids.iter().enumerate() {
        let Some(track) = known.get(id).cloned() else { continue };
        if index.is_none() && i >= state.index {
            index = Some(queue.len());
            position = if i == state.index { position.min(f64::from(track.duration_seconds)) } else { 0.0 };
        }
        queue.push(track);
    }
    Ok(index.map(|index| RestoredQueue { tracks: queue, index, position_seconds: position }))
}

pub async fn elsewhere(
    db: &PgPool,
    registry: &PlaybackRegistry,
    user: Uuid,
    device_id: Option<&str>,
) -> AppResult<Option<PlayingElsewhereDto>> {
    let Some(state) = registry.elsewhere(user, require_device(device_id)?) else { return Ok(None) };
    let Some(mut queue) = restore(db, user, &state).await? else { return Ok(None) };

    Ok(Some(PlayingElsewhereDto {
        track: queue.tracks.swap_remove(queue.index),
        device_id: state.device_id,
        device_name: state.device_name,
        position_seconds: queue.position_seconds,
        is_playing: state.is_playing,
        reported_at: state.reported_at,
    }))
}

pub async fn handoff(
    db: &PgPool,
    registry: &PlaybackRegistry,
    user: Uuid,
    device_id: Option<&str>,
) -> AppResult<PlaybackHandoffDto> {
    let state = registry
        .elsewhere(user, require_device(device_id)?)
        .ok_or_else(|| AppError::not_found("Nothing is playing on another device."))?;
    let queue = restore(db, user, &state)
        .await?
        .ok_or_else(|| AppError::not_found("The tracks that were playing are gone."))?;

    Ok(PlaybackHandoffDto {
        device_id: state.device_id,
        device_name: state.device_name,
        tracks: queue.tracks,
        index: queue.index,
        position_seconds: queue.position_seconds,
        shuffle: state.shuffle,
        repeat: state.repeat,
    })
}
