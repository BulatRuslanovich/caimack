// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::{HashMap, HashSet};

use uuid::Uuid;

use crate::snapshot::Snapshot;
use crate::vector::{self, dot};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Play {
    pub track: Uuid,

    pub day: u32,

    pub hour: u32,
    pub seconds: i64,
}

#[derive(Debug, Clone, Default)]
pub struct TrackFacts {
    pub artists: Vec<Uuid>,
    pub genre: Option<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ranking {
    pub id: Uuid,
    pub plays: i32,
    pub seconds: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Totals {
    pub seconds: i64,
    pub plays: i32,
    pub distinct_tracks: i32,
    pub distinct_artists: i32,
    pub tracks: Vec<Ranking>,

    pub artists: Vec<Ranking>,
    pub genres: Vec<(Uuid, f64)>,
    pub day_seconds: Vec<i64>,
    pub hour_seconds: Vec<i64>,
}

pub fn totals(
    plays: &[Play],
    facts: &HashMap<Uuid, TrackFacts>,
    days_in_month: usize,
    top: usize,
    threshold: i64,
) -> Totals {
    let mut days = vec![0; days_in_month];
    let mut hours = vec![0; 24];
    let mut tracks: HashMap<Uuid, (i32, i64)> = HashMap::new();
    let mut artists: HashMap<Uuid, (i32, i64)> = HashMap::new();
    let mut genres: HashMap<Uuid, i64> = HashMap::new();
    let (mut total, mut counted) = (0, 0);

    for play in plays {
        total += play.seconds;
        if let Some(day) = days.get_mut(play.day.saturating_sub(1) as usize) {
            *day += play.seconds;
        }
        if let Some(hour) = hours.get_mut(play.hour as usize) {
            *hour += play.seconds;
        }

        let full = i32::from(play.seconds >= threshold);
        counted += full;
        let entry = tracks.entry(play.track).or_default();
        *entry = (entry.0 + full, entry.1 + play.seconds);

        let Some(fact) = facts.get(&play.track) else { continue };
        for artist in &fact.artists {
            let entry = artists.entry(*artist).or_default();
            *entry = (entry.0 + full, entry.1 + play.seconds);
        }
        if let Some(genre) = fact.genre {
            *genres.entry(genre).or_default() += play.seconds;
        }
    }

    let ranked = |map: HashMap<Uuid, (i32, i64)>| -> Vec<Ranking> {
        map.into_iter()
            .filter(|(_, (plays, _))| *plays > 0)
            .map(|(id, (plays, seconds))| Ranking { id, plays, seconds })
            .collect()
    };
    let mut top_tracks = ranked(tracks);
    let distinct_tracks = i32::try_from(top_tracks.len()).unwrap_or(i32::MAX);
    top_tracks.sort_by(|a, b| b.plays.cmp(&a.plays).then(b.seconds.cmp(&a.seconds)).then(a.id.cmp(&b.id)));
    top_tracks.truncate(top);

    let mut all_artists = ranked(artists);
    all_artists.sort_by(|a, b| b.seconds.cmp(&a.seconds).then(b.plays.cmp(&a.plays)).then(a.id.cmp(&b.id)));

    let genre_total: i64 = genres.values().sum();
    let mut top_genres: Vec<(Uuid, i64)> = genres.into_iter().collect();
    top_genres.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    #[expect(clippy::cast_precision_loss, reason = "a share")]
    let genres = if genre_total == 0 {
        vec![]
    } else {
        top_genres.into_iter().take(top).map(|(id, seconds)| (id, seconds as f64 / genre_total as f64)).collect()
    };

    Totals {
        seconds: total,
        plays: counted,
        distinct_tracks,
        distinct_artists: i32::try_from(all_artists.len()).unwrap_or(i32::MAX),
        tracks: top_tracks,
        artists: all_artists,
        genres,
        day_seconds: days,
        hour_seconds: hours,
    }
}

pub fn sound_of(plays: &[Play], snapshot: &Snapshot) -> Option<Uuid> {
    let mut centre = vec![0.0; snapshot.dimension()];
    let mut rows = HashSet::new();
    for play in plays.iter().filter(|play| play.seconds > 0) {
        if let Some(row) = snapshot.row_of(play.track) {
            rows.insert(row);
            #[expect(clippy::cast_precision_loss, reason = "a weight")]
            vector::add_scaled(&mut centre, snapshot.vector(row), play.seconds as f32);
        }
    }
    vector::normalize(&mut centre);
    rows.into_iter()
        .max_by(|&a, &b| dot(&centre, snapshot.vector(a)).total_cmp(&dot(&centre, snapshot.vector(b))).then(b.cmp(&a)))
        .map(|row| snapshot.meta(row).track_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn play(track: u128, day: u32, hour: u32, seconds: i64) -> Play {
        Play { track: Uuid::from_u128(track), day, hour, seconds }
    }

    #[test]
    fn short_attempts_add_time_but_not_plays() {
        let artist = Uuid::from_u128(100);
        let facts = HashMap::from([
            (Uuid::from_u128(1), TrackFacts { artists: vec![artist], genre: Some(Uuid::from_u128(9)) }),
            (Uuid::from_u128(2), TrackFacts { artists: vec![artist], genre: None }),
        ]);
        let plays = [play(1, 1, 8, 200), play(1, 2, 8, 180), play(2, 31, 23, 10)];
        let totals = totals(&plays, &facts, 31, 5, 30);

        assert_eq!((totals.seconds, totals.plays, totals.distinct_tracks, totals.distinct_artists), (390, 2, 1, 1));
        assert_eq!(totals.tracks, [Ranking { id: Uuid::from_u128(1), plays: 2, seconds: 380 }]);
        assert_eq!(totals.artists[0].seconds, 390);
        assert_eq!((totals.day_seconds[0], totals.day_seconds[30], totals.hour_seconds[23]), (200, 10, 10));
        assert_eq!(totals.genres, [(Uuid::from_u128(9), 1.0)]);
    }
}
