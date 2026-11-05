// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::{HashMap, HashSet};

use chrono::{Datelike, NaiveDate};
use reco::recap::{self, Play, TrackFacts};
use serde::Serialize;
use uuid::Uuid;

use super::Recommendations;
use crate::catalog::artists;
use crate::catalog::dto::{ArtistDto, TrackDto};
use crate::catalog::tracks;
use crate::library::history::THRESHOLD_SECONDS;
use crate::{AppResult, json};

const TOP: usize = 5;
const NEW_ARTIST_PICKS: usize = 3;
const SHOWN_DAYS: u32 = 7;

#[derive(Debug, Serialize)]
pub struct RecapTrackDto {
    pub track: TrackDto,
    pub plays: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecapArtistDto {
    pub artist: ArtistDto,
    pub plays: i32,
    pub listened_seconds: i64,
}

#[derive(Debug, Serialize)]
pub struct RecapMoodDto {
    pub key: String,
    #[serde(serialize_with = "json::number")]
    pub share: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecapDto {
    pub year: i32,
    pub month: u32,
    pub listened_seconds: i64,
    pub plays: i32,
    pub distinct_tracks: i32,
    pub distinct_artists: i32,
    pub previous_listened_seconds: Option<i64>,
    pub top_tracks: Vec<RecapTrackDto>,
    pub top_artists: Vec<RecapArtistDto>,
    pub top_genre: Option<String>,
    pub moods: Vec<RecapMoodDto>,
    pub day_seconds: Vec<i64>,
    pub hour_seconds: Vec<i64>,
    pub sound_of_month: Option<TrackDto>,
    pub new_artists: Option<i32>,
    pub new_artist_picks: Vec<ArtistDto>,
}

fn previous_month(year: i32, month: u32) -> (i32, u32) {
    if month == 1 { (year - 1, 12) } else { (year, month - 1) }
}

fn days_in(year: i32, month: u32) -> usize {
    let (next_year, next_month) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    match (NaiveDate::from_ymd_opt(year, month, 1), NaiveDate::from_ymd_opt(next_year, next_month, 1)) {
        (Some(first), Some(next)) => usize::try_from((next - first).num_days()).unwrap_or(31),
        _ => 31,
    }
}

impl Recommendations {
    pub async fn recap(&self, user: Uuid) -> AppResult<Option<RecapDto>> {
        let zone = sqlx::query_scalar!("SELECT time_zone FROM user_settings WHERE user_id = $1", user)
            .fetch_optional(&self.db)
            .await?
            .unwrap_or_else(|| "UTC".to_owned());
        let today = sqlx::query_scalar!(r#"SELECT (now() AT TIME ZONE $1)::date AS "today!""#, zone)
            .fetch_one(&self.db)
            .await?;
        if today.day() > SHOWN_DAYS {
            return Ok(None);
        }
        let (year, month) = previous_month(today.year(), today.month());
        let (before_year, before_month) = previous_month(year, month);
        let month_i32 = i32::try_from(month).unwrap_or(1);
        let before_month_i32 = i32::try_from(before_month).unwrap_or(1);

        let plays: Vec<Play> = sqlx::query!(
            r#"WITH bounds AS (
                   SELECT make_timestamp($3, $4, 1, 0, 0, 0) AT TIME ZONE $2 AS "from",
                          make_timestamp($5, $6, 1, 0, 0, 0) AT TIME ZONE $2 AS "to"
               )
               SELECT e.track_id AS "track_id!",
                      EXTRACT(DAY FROM e.occurred_at AT TIME ZONE $2)::int AS "day!",
                      EXTRACT(HOUR FROM e.occurred_at AT TIME ZONE $2)::int AS "hour!",
                      GREATEST(e.listened_seconds, 0)::bigint AS "seconds!"
               FROM playback_events e, bounds b
               WHERE e.user_id = $1 AND e.track_id IS NOT NULL AND e.type IN (3, 4)
                 AND e.occurred_at >= b."from" AND e.occurred_at < b."to""#,
            user,
            zone,
            year,
            month_i32,
            today.year(),
            i32::try_from(today.month()).unwrap_or(1)
        )
        .fetch_all(&self.db)
        .await?
        .into_iter()
        .map(|row| Play {
            track: row.track_id,
            day: u32::try_from(row.day).unwrap_or(1),
            hour: u32::try_from(row.hour).unwrap_or(0),
            seconds: row.seconds,
        })
        .collect();

        let threshold = i64::from(THRESHOLD_SECONDS);
        if !plays.iter().any(|play| play.seconds >= threshold) {
            return Ok(None);
        }

        let track_ids: Vec<Uuid> = plays.iter().map(|play| play.track).collect::<HashSet<_>>().into_iter().collect();
        let facts: HashMap<Uuid, TrackFacts> = sqlx::query!(
            r#"SELECT t.id, t.artist_id, t.genre_id,
                      ARRAY(SELECT ta.artist_id FROM track_artists ta WHERE ta.track_id = t.id ORDER BY ta.position) AS "credits!"
               FROM tracks t WHERE t.id = ANY($1)"#,
            &track_ids
        )
        .fetch_all(&self.db)
        .await?
        .into_iter()
        .map(|row| {
            let artists = if row.credits.is_empty() { vec![row.artist_id] } else { row.credits };
            (row.id, TrackFacts { artists, genre: row.genre_id })
        })
        .collect();

        let library = self.index.library();
        let (totals, sound) = self
            .compute
            .run(move || {
                (
                    recap::totals(&plays, &facts, days_in(year, month), TOP, threshold),
                    recap::sound_of(&plays, &library.snapshot),
                )
            })
            .await?;

        let previous = sqlx::query_scalar!(
            r#"SELECT COALESCE(SUM(e.listened_seconds), 0)::bigint AS "seconds!"
               FROM playback_events e
               WHERE e.user_id = $1 AND e.track_id IS NOT NULL AND e.type IN (3, 4) AND e.listened_seconds > 0
                 AND e.occurred_at >= make_timestamp($3, $4, 1, 0, 0, 0) AT TIME ZONE $2
                 AND e.occurred_at < make_timestamp($5, $6, 1, 0, 0, 0) AT TIME ZONE $2"#,
            user,
            zone,
            before_year,
            before_month_i32,
            year,
            month_i32
        )
        .fetch_one(&self.db)
        .await?;

        let month_artists: Vec<Uuid> = totals.artists.iter().map(|ranking| ranking.id).collect();
        let earlier = sqlx::query!(
            r#"WITH earlier AS (
                   SELECT DISTINCT track_id FROM playback_events
                   WHERE user_id = $1 AND track_id IS NOT NULL AND type IN (3, 4) AND listened_seconds >= $5
                     AND occurred_at < make_timestamp($3, $4, 1, 0, 0, 0) AT TIME ZONE $2
               )
               SELECT EXISTS (SELECT 1 FROM earlier) AS "any!",
                      ARRAY(SELECT ta.artist_id FROM track_artists ta JOIN earlier e ON e.track_id = ta.track_id
                            WHERE ta.artist_id = ANY($6)
                            UNION SELECT t.artist_id FROM tracks t JOIN earlier e ON e.track_id = t.id
                            WHERE t.artist_id = ANY($6)) AS "known!""#,
            user,
            zone,
            year,
            month_i32,
            THRESHOLD_SECONDS,
            &month_artists
        )
        .fetch_one(&self.db)
        .await?;
        let (new_artists, new_artist_ids): (Option<i32>, Vec<Uuid>) = if earlier.any {
            let known: HashSet<Uuid> = earlier.known.into_iter().collect();
            let fresh: Vec<Uuid> = month_artists.iter().copied().filter(|id| !known.contains(id)).collect();
            (Some(i32::try_from(fresh.len()).unwrap_or(i32::MAX)), fresh.into_iter().take(NEW_ARTIST_PICKS).collect())
        } else {
            (None, vec![])
        };

        let wanted_tracks: Vec<Uuid> = totals.tracks.iter().map(|ranking| ranking.id).chain(sound).collect();
        let found_tracks = tracks::by_ids(&self.db, user, &wanted_tracks).await?;
        let wanted_artists: Vec<Uuid> =
            totals.artists.iter().take(TOP).map(|ranking| ranking.id).chain(new_artist_ids.iter().copied()).collect();
        let found_artists: HashMap<Uuid, ArtistDto> = artists::fetch_where(
            &self.db,
            |query| {
                query.push(" WHERE a.id = ANY(").push_bind(wanted_artists.clone()).push(")");
            },
            "a.name",
            i64::try_from(wanted_artists.len()).unwrap_or(1).max(1),
        )
        .await?
        .into_iter()
        .map(|artist| (artist.id, artist))
        .collect();

        let top_genre = match totals.genres.first() {
            Some((genre, _)) => {
                sqlx::query_scalar!("SELECT name FROM genres WHERE id = $1", genre).fetch_optional(&self.db).await?
            }
            None => None,
        };

        Ok(Some(RecapDto {
            year,
            month,
            listened_seconds: totals.seconds,
            plays: totals.plays,
            distinct_tracks: totals.distinct_tracks,
            distinct_artists: totals.distinct_artists,
            previous_listened_seconds: (previous > 0).then_some(previous),
            top_tracks: totals
                .tracks
                .iter()
                .filter_map(|ranking| {
                    Some(RecapTrackDto { track: found_tracks.get(&ranking.id)?.clone(), plays: ranking.plays })
                })
                .collect(),
            top_artists: totals
                .artists
                .iter()
                .take(TOP)
                .filter_map(|ranking| {
                    Some(RecapArtistDto {
                        artist: found_artists.get(&ranking.id)?.clone(),
                        plays: ranking.plays,
                        listened_seconds: ranking.seconds,
                    })
                })
                .collect(),
            top_genre,
            moods: vec![],
            day_seconds: totals.day_seconds,
            hour_seconds: totals.hour_seconds,
            sound_of_month: sound.and_then(|id| found_tracks.get(&id).cloned()),
            new_artists,
            new_artist_picks: new_artist_ids.iter().filter_map(|id| found_artists.get(id).cloned()).collect(),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn months_roll_over_the_year() {
        assert_eq!(previous_month(2026, 1), (2025, 12));
        assert_eq!(days_in(2024, 2), 29);
        assert_eq!(days_in(2026, 12), 31);
    }
}
