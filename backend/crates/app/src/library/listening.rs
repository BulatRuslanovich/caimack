// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::HashMap;

use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::AppResult;
use crate::catalog::dto::{ArtistDto, TrackDto};
use crate::catalog::{artists, tracks};
use crate::recommendations::listener::EVENT_RETENTION_DAYS;

// Keep the oldest displayed calendar week wholly inside event retention even
// when the current week is almost over (25 * 7 <= 180).
const WEEKS: usize = EVENT_RETENTION_DAYS as usize / 7;
const TOP: usize = 20;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningOverview {
    pub updated_at: Option<DateTime<Utc>>,
    pub time_zone: String,
    pub retention_days: i32,
    pub weeks: Vec<ListeningWeek>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningWeek {
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub current: bool,
    pub listened_seconds: i64,
    pub plays: i32,
    pub distinct_tracks: usize,
    pub distinct_artists: usize,
    pub previous_listened_seconds: Option<i64>,
    pub day_seconds: [i64; 7],
    pub top_tracks: Vec<ListeningTrack>,
    pub top_artists: Vec<ListeningArtist>,
    pub decade: Option<i32>,
    pub decade_share: Option<i64>,
    pub artist_share: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningTrack {
    pub track: TrackDto,
    pub plays: i32,
    pub listened_seconds: i64,
    pub previous_rank: Option<usize>,
    pub weeks_in_top5: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningArtist {
    pub artist: ArtistDto,
    pub plays: i32,
    pub listened_seconds: i64,
    pub previous_rank: Option<usize>,
    pub weeks_in_top5: usize,
}

#[derive(Debug, sqlx::FromRow)]
struct Event {
    session_id: Uuid,
    track_id: Uuid,
    kind: i32,
    occurred_at: DateTime<Utc>,
    local_date: NaiveDate,
    listened_seconds: i32,
    duration_seconds: i32,
}

#[derive(Debug, Default, Clone, Copy)]
struct Count {
    plays: i32,
    seconds: i64,
}

#[derive(Default)]
struct Totals {
    tracks: HashMap<Uuid, Count>,
    artists: HashMap<Uuid, Count>,
    decades: HashMap<i32, i64>,
    days: [i64; 7],
}

fn monday(day: NaiveDate) -> NaiveDate {
    day - Duration::days(i64::from(day.weekday().num_days_from_monday()))
}

/// Progress reports contain a cumulative counter, not additional listening time.
/// A start bounds one attempt; repeated reports and terminal events add no time.
/// Keep the state across week boundaries, so a heartbeat cannot count twice.
fn accumulate(events: &[Event], first: NaiveDate, weeks: usize) -> Vec<Totals> {
    let mut totals: Vec<Totals> = (0..weeks).map(|_| Totals::default()).collect();
    let mut attempts: HashMap<Uuid, (Uuid, i32, bool)> = HashMap::new();
    for event in events {
        if event.kind == 1 {
            attempts.insert(event.session_id, (event.track_id, 0, false));
            continue;
        }
        let attempt = attempts.entry(event.session_id).or_insert((event.track_id, 0, false));
        if attempt.0 != event.track_id {
            *attempt = (event.track_id, 0, false);
        }
        let heard = event.listened_seconds.clamp(0, 86_400);
        let delta = heard.saturating_sub(attempt.1).max(0);
        attempt.1 = attempt.1.max(heard);
        let threshold = super::history::THRESHOLD_SECONDS.min(event.duration_seconds.saturating_sub(1).max(1));
        let play = !attempt.2 && heard >= threshold;
        attempt.2 |= play;
        let day = (event.local_date - first).num_days();
        let Ok(day) = usize::try_from(day) else { continue };
        let Some(week) = totals.get_mut(day / 7) else { continue };
        let count = week.tracks.entry(event.track_id).or_default();
        count.seconds += i64::from(delta);
        count.plays += i32::from(play);
        week.days[day % 7] += i64::from(delta);
    }
    totals
}

fn ranked(counts: &HashMap<Uuid, Count>, by_time: bool) -> Vec<(Uuid, Count)> {
    let mut ranked: Vec<_> = counts.iter().filter(|(_, count)| count.plays > 0).map(|(&id, &c)| (id, c)).collect();
    ranked.sort_by(|a, b| {
        if by_time {
            b.1.seconds.cmp(&a.1.seconds).then(b.1.plays.cmp(&a.1.plays)).then(a.0.cmp(&b.0))
        } else {
            b.1.plays.cmp(&a.1.plays).then(b.1.seconds.cmp(&a.1.seconds)).then(a.0.cmp(&b.0))
        }
    });
    ranked
}

fn position(ranking: &[(Uuid, Count)], id: Uuid) -> Option<usize> {
    ranking.iter().position(|(candidate, _)| *candidate == id).map(|index| index + 1)
}

pub async fn overview(db: &PgPool, user: Uuid) -> AppResult<ListeningOverview> {
    let zone: String =
        sqlx::query_scalar("SELECT COALESCE((SELECT time_zone FROM user_settings WHERE user_id=$1), 'UTC')")
            .bind(user)
            .fetch_one(db)
            .await?;
    let today: NaiveDate = sqlx::query_scalar("SELECT (now() AT TIME ZONE $1)::date").bind(&zone).fetch_one(db).await?;
    let current = monday(today);
    let first = current - Duration::weeks((WEEKS - 1) as i64);
    // Deduplicate retries from clients predating stable event identifiers. The
    // timestamp and cumulative counter identify the same report, not a repeat play.
    let events = sqlx::query_as::<_, Event>(
        "SELECT e.session_id, e.track_id, e.type AS kind, e.occurred_at,
                (e.occurred_at AT TIME ZONE $2)::date AS local_date,
                e.listened_seconds, t.duration_seconds
         FROM (SELECT DISTINCT ON (session_id, track_id, type, occurred_at, listened_seconds) *
               FROM playback_events WHERE user_id=$1 AND track_id IS NOT NULL AND type IN (1,2,3,4)
                 AND occurred_at >= now() - make_interval(days => $3) AND occurred_at <= now()
               ORDER BY session_id, track_id, type, occurred_at, listened_seconds, id) e
         JOIN tracks t ON t.id=e.track_id
         ORDER BY e.session_id, e.occurred_at, e.id",
    )
    .bind(user)
    .bind(&zone)
    .bind(EVENT_RETENTION_DAYS)
    .fetch_all(db)
    .await?;
    let updated_at = events.iter().map(|event| event.occurred_at).max();
    let mut totals = accumulate(&events, first, WEEKS);
    let ids: Vec<Uuid> =
        events.iter().map(|event| event.track_id).collect::<std::collections::HashSet<_>>().into_iter().collect();
    let found = tracks::by_ids(db, user, &ids).await?;
    for week in &mut totals {
        for (id, count) in &week.tracks {
            let Some(track) = found.get(id) else { continue };
            let credits: Vec<_> = if track.artists.is_empty() {
                vec![track.artist_id]
            } else {
                track.artists.iter().map(|a| a.id).collect()
            };
            for artist in credits {
                let target = week.artists.entry(artist).or_default();
                target.plays += count.plays;
                target.seconds += count.seconds;
            }
            if let Some(year) = track.year.filter(|year| (1000..=today.year()).contains(year)) {
                *week.decades.entry(year / 10 * 10).or_default() += count.seconds;
            }
        }
    }
    let track_rankings: Vec<_> = totals.iter().map(|week| ranked(&week.tracks, false)).collect();
    let artist_rankings: Vec<_> = totals.iter().map(|week| ranked(&week.artists, true)).collect();
    let wanted_artists: Vec<_> = artist_rankings
        .iter()
        .flat_map(|r| r.iter().take(TOP).map(|r| r.0))
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    let artist_map: HashMap<_, _> = artists::fetch_where(
        db,
        |query| {
            query.push(" WHERE a.id = ANY(").push_bind(wanted_artists.clone()).push(")");
        },
        "a.name",
        wanted_artists.len().max(1) as i64,
    )
    .await?
    .into_iter()
    .map(|a| (a.id, a))
    .collect();
    let mut weeks = Vec::with_capacity(WEEKS);
    for index in (0..WEEKS).rev() {
        let week = &totals[index];
        let seconds: i64 = week.days.iter().sum();
        let previous = index.checked_sub(1);
        let previous_tracks = previous.map_or(&[][..], |i| track_rankings[i].as_slice());
        let previous_artists = previous.map_or(&[][..], |i| artist_rankings[i].as_slice());
        let weeks_in_top5 = |rankings: &[Vec<(Uuid, Count)>], id| {
            rankings[..=index].iter().filter(|ranking| position(ranking, id).is_some_and(|rank| rank <= 5)).count()
        };
        let start = first + Duration::weeks(index as i64);
        let decade = week.decades.iter().max_by(|a, b| a.1.cmp(b.1).then_with(|| b.0.cmp(a.0)));
        weeks.push(ListeningWeek {
            start_date: start,
            end_date: start + Duration::days(6),
            current: start == current,
            listened_seconds: seconds,
            plays: week.tracks.values().map(|count| count.plays).sum(),
            distinct_tracks: track_rankings[index].len(),
            distinct_artists: artist_rankings[index].len(),
            previous_listened_seconds: previous.map(|i| totals[i].days.iter().sum()),
            day_seconds: week.days,
            top_tracks: track_rankings[index]
                .iter()
                .take(TOP)
                .filter_map(|(id, count)| {
                    Some(ListeningTrack {
                        track: found.get(id)?.clone(),
                        plays: count.plays,
                        listened_seconds: count.seconds,
                        previous_rank: position(previous_tracks, *id),
                        weeks_in_top5: weeks_in_top5(&track_rankings, *id),
                    })
                })
                .collect(),
            top_artists: artist_rankings[index]
                .iter()
                .take(TOP)
                .filter_map(|(id, count)| {
                    Some(ListeningArtist {
                        artist: artist_map.get(id)?.clone(),
                        plays: count.plays,
                        listened_seconds: count.seconds,
                        previous_rank: position(previous_artists, *id),
                        weeks_in_top5: weeks_in_top5(&artist_rankings, *id),
                    })
                })
                .collect(),
            decade: decade.map(|(&decade, _)| decade),
            decade_share: decade.filter(|_| seconds > 0).map(|(_, listened)| listened * 100 / seconds),
            artist_share: artist_rankings[index]
                .first()
                .filter(|_| seconds > 0)
                .map(|(_, count)| count.seconds * 100 / seconds),
        });
    }
    Ok(ListeningOverview { updated_at, time_zone: zone, retention_days: EVENT_RETENTION_DAYS, weeks })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(track: u128, kind: i32, seconds: i32, day: NaiveDate) -> Event {
        Event {
            session_id: Uuid::nil(),
            track_id: Uuid::from_u128(track),
            kind,
            occurred_at: DateTime::UNIX_EPOCH,
            local_date: day,
            listened_seconds: seconds,
            duration_seconds: 180,
        }
    }

    #[test]
    fn progress_pause_retries_repeat_and_week_boundary() {
        let first = monday(NaiveDate::from_ymd_opt(2026, 11, 15).unwrap_or_default());
        let next = first + Duration::weeks(1);
        let events = [
            event(1, 1, 0, first),
            event(1, 2, 20, first),
            event(1, 2, 30, first),
            event(1, 2, 30, first),
            event(1, 2, 60, next),
            event(1, 3, 90, next),
            event(1, 3, 90, next),
            event(1, 1, 0, next),
            event(1, 2, 30, next),
            event(1, 4, 40, next),
        ];
        let totals = accumulate(&events, first, 2);
        assert_eq!(totals[0].days[0], 30);
        assert_eq!(totals[1].days[0], 100);
        assert_eq!(totals[0].tracks[&Uuid::from_u128(1)].plays, 1);
        assert_eq!(totals[1].tracks[&Uuid::from_u128(1)].plays, 1);
    }

    #[test]
    fn short_tracks_separate_devices_and_partial_attempts() {
        let day = monday(NaiveDate::from_ymd_opt(2026, 11, 15).unwrap_or_default());
        let mut short = event(2, 3, 11, day);
        short.duration_seconds = 12;
        let mut other = event(1, 2, 30, day);
        other.session_id = Uuid::from_u128(2);
        let totals = accumulate(&[event(1, 1, 0, day), event(1, 2, 5, day), other, short], day, 1);
        assert_eq!(totals[0].days[0], 46);
        assert_eq!(totals[0].tracks.values().map(|c| c.plays).sum::<i32>(), 2);
    }
}
