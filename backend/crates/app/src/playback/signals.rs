// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::sync::LazyLock;

use chrono::{DateTime, Duration, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::AppResult;

const MAX_BACKLOG: Duration = Duration::days(7);
const MAX_SECONDS: i32 = 86_400;
const MAX_EVENTS_PER_REQUEST: usize = 100;
const MAX_SOURCE_LENGTH: usize = 64;

static SOURCE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new("^[A-Za-z0-9:_-]+$").unwrap_or_else(|error| unreachable!("valid pattern: {error}")));

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventType {
    TrackStarted = 1,
    TrackPlayed = 2,
    TrackCompleted = 3,
    TrackSkipped = 4,
    TrackReplayed = 6,
    TrackLiked = 7,
    TrackUnliked = 8,
    TrackAddedToPlaylist = 9,
    TrackRemovedFromPlaylist = 10,
    TrackAddedToQueue = 11,
    ArtistOpened = 12,
    AlbumOpened = 13,

    ShelfShown = 15,
}

impl EventType {
    const ALL: [Self; 13] = [
        Self::TrackStarted,
        Self::TrackPlayed,
        Self::TrackCompleted,
        Self::TrackSkipped,
        Self::TrackReplayed,
        Self::TrackLiked,
        Self::TrackUnliked,
        Self::TrackAddedToPlaylist,
        Self::TrackRemovedFromPlaylist,
        Self::TrackAddedToQueue,
        Self::ArtistOpened,
        Self::AlbumOpened,
        Self::ShelfShown,
    ];

    fn name(self) -> &'static str {
        match self {
            Self::TrackStarted => "trackstarted",
            Self::TrackPlayed => "trackplayed",
            Self::TrackCompleted => "trackcompleted",
            Self::TrackSkipped => "trackskipped",
            Self::TrackReplayed => "trackreplayed",
            Self::TrackLiked => "trackliked",
            Self::TrackUnliked => "trackunliked",
            Self::TrackAddedToPlaylist => "trackaddedtoplaylist",
            Self::TrackRemovedFromPlaylist => "trackremovedfromplaylist",
            Self::TrackAddedToQueue => "trackaddedtoqueue",
            Self::ArtistOpened => "artistopened",
            Self::AlbumOpened => "albumopened",
            Self::ShelfShown => "shelfshown",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        let value = value.trim();
        if let Ok(number) = value.parse::<i32>() {
            return Self::ALL.into_iter().find(|kind| *kind as i32 == number);
        }
        let lower = value.to_ascii_lowercase();
        Self::ALL.into_iter().find(|kind| kind.name() == lower)
    }

    pub fn about_track(self) -> bool {
        !matches!(self, Self::ArtistOpened | Self::AlbumOpened | Self::ShelfShown)
    }
}

pub fn normalize_source(source: Option<&str>) -> Option<String> {
    let trimmed = source?.trim();
    (!trimmed.is_empty() && trimmed.chars().count() <= MAX_SOURCE_LENGTH && SOURCE.is_match(trimmed))
        .then(|| trimmed.to_owned())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackEventRequest {
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub track_id: Option<Uuid>,
    pub entity_id: Option<Uuid>,
    pub occurred_at: Option<DateTime<Utc>>,
    pub position_seconds: Option<i32>,
    pub listened_seconds: Option<i32>,
    pub duration_seconds: Option<i32>,
    pub session_id: Option<Uuid>,
    pub source: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RecordEventsRequest {
    pub events: Option<Vec<PlaybackEventRequest>>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct RecordEventsResult {
    pub accepted: usize,
    pub rejected: usize,
}

struct Event {
    kind: EventType,
    track_id: Option<Uuid>,
    entity_id: Option<Uuid>,
    occurred_at: DateTime<Utc>,
    position: i32,
    listened: i32,
    duration: i32,
    session_id: Uuid,
    source: Option<String>,
}

fn clamp_seconds(value: Option<i32>) -> i32 {
    value.filter(|&v| v >= 0).map_or(0, |v| v.min(MAX_SECONDS))
}

fn validate(item: PlaybackEventRequest, now: DateTime<Utc>) -> Option<Event> {
    let kind = EventType::parse(item.kind.as_deref()?)?;
    let source = normalize_source(item.source.as_deref());
    let needs_track = kind.about_track();
    if (needs_track && item.track_id.is_none())
        || (kind == EventType::ShelfShown && source.is_none())
        || (matches!(kind, EventType::ArtistOpened | EventType::AlbumOpened) && item.entity_id.is_none())
    {
        return None;
    }

    let floor = now - MAX_BACKLOG;
    let occurred_at = item.occurred_at.unwrap_or(now).clamp(floor, now);
    Some(Event {
        kind,
        track_id: if needs_track { item.track_id } else { None },
        entity_id: item.entity_id,
        occurred_at,
        position: clamp_seconds(item.position_seconds),
        listened: clamp_seconds(item.listened_seconds),
        duration: clamp_seconds(item.duration_seconds),
        session_id: item.session_id.unwrap_or(Uuid::nil()),
        source,
    })
}

pub async fn record(db: &PgPool, user: Uuid, request: RecordEventsRequest) -> AppResult<RecordEventsResult> {
    let reported = request.events.unwrap_or_default();
    if reported.is_empty() {
        return Ok(RecordEventsResult { accepted: 0, rejected: 0 });
    }
    let total = reported.len();
    let now = Utc::now();

    let created: Vec<Event> =
        reported.into_iter().take(MAX_EVENTS_PER_REQUEST).filter_map(|item| validate(item, now)).collect();
    let referenced: Vec<Uuid> = created.iter().filter_map(|event| event.track_id).collect();
    let existing: std::collections::HashSet<Uuid> = if referenced.is_empty() {
        std::collections::HashSet::new()
    } else {
        sqlx::query_scalar!("SELECT id FROM tracks WHERE id = ANY($1)", &referenced)
            .fetch_all(db)
            .await?
            .into_iter()
            .collect()
    };
    let accepted: Vec<Event> =
        created.into_iter().filter(|event| event.track_id.is_none_or(|id| existing.contains(&id))).collect();

    if !accepted.is_empty() {
        let mut tx = db.begin().await?;
        for event in &accepted {
            sqlx::query!(
                "INSERT INTO playback_events (id, user_id, track_id, entity_id, type, occurred_at, position_seconds,
                                              listened_seconds, duration_seconds, session_id, source)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
                Uuid::now_v7(),
                user,
                event.track_id,
                event.entity_id,
                event.kind as i32,
                event.occurred_at,
                event.position,
                event.listened,
                event.duration,
                event.session_id,
                event.source
            )
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
    }

    let rejected = total - accepted.len();
    if rejected > 0 {
        tracing::debug!("Discarded {rejected} of {total} reported events");
    }
    Ok(RecordEventsResult { accepted: accepted.len(), rejected })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_types_parse_by_name_or_number() {
        assert_eq!(
            [
                EventType::parse("trackCompleted"),
                EventType::parse("3"),
                EventType::parse("5"),
                EventType::parse("Unknown")
            ],
            [Some(EventType::TrackCompleted), Some(EventType::TrackCompleted), None, None]
        );
    }

    #[test]
    fn sources_are_restricted_to_keys() {
        assert_eq!(
            [normalize_source(Some(" home:forYou ")), normalize_source(Some("bad source")), normalize_source(Some(""))],
            [Some("home:forYou".to_owned()), None, None]
        );
    }

    #[test]
    fn old_events_are_clamped_to_a_week() {
        let now = Utc::now();
        let item = PlaybackEventRequest {
            kind: Some("TrackPlayed".to_owned()),
            track_id: Some(Uuid::nil()),
            entity_id: None,
            occurred_at: Some(now - Duration::days(30)),
            position_seconds: Some(-5),
            listened_seconds: Some(100_000),
            duration_seconds: None,
            session_id: None,
            source: None,
        };
        let event = validate(item, now).unwrap();
        assert_eq!((event.occurred_at, event.position, event.listened), (now - MAX_BACKLOG, 0, MAX_SECONDS));
    }
}
