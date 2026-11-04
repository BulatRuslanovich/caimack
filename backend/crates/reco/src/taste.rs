// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::HashMap;

use uuid::Uuid;

use crate::rules::Rules;
use crate::snapshot::Snapshot;
use crate::vector::{self, dot};

const DAY: i64 = 86_400;
const JUST_PLAYED: i64 = DAY;
const RECENTLY_PLAYED: i64 = 7 * DAY;
const JUST_PLAYED_PENALTY: f64 = 0.15;
const RECENTLY_PLAYED_PENALTY: f64 = 0.6;
const DISLIKED_ARTIST_PENALTY: f64 = 0.3;

const REJECTED_SCORE: f64 = -0.3;
const FRESHNESS_DAYS: f64 = 30.0;

const ESTABLISHED_PLAYS: i32 = 3;
const MAX_MODES: usize = 4;

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct TrackSignal {
    pub score: f64,

    pub plays: i32,

    pub early_skips: i32,
    pub last_played: Option<i64>,
}

impl TrackSignal {
    pub fn rejected(&self) -> bool {
        self.score < REJECTED_SCORE || (self.early_skips >= 4 && self.plays == 0)
    }

    pub fn familiar(&self) -> bool {
        self.plays > 0 || self.last_played.is_some()
    }
}

#[derive(Debug, Clone, Default)]
pub struct Listener {
    pub user: Uuid,

    pub now: i64,

    pub day: i64,
    pub tracks: HashMap<Uuid, TrackSignal>,
    pub rules: Rules,
}

#[derive(Debug, Clone)]
pub struct Mode {
    pub centre: Vec<f32>,
    pub share: f64,
}

#[derive(Debug, Default)]
pub struct Taste {
    pub modes: Vec<Mode>,
    pub centre: Option<Vec<f32>>,
    pub artists: HashMap<Uuid, f64>,
    pub genres: HashMap<Uuid, f64>,

    pub artist_plays: HashMap<Uuid, i32>,

    pub fit: Vec<f32>,
}

impl Taste {
    pub fn is_empty(&self) -> bool {
        self.modes.is_empty()
    }

    pub fn top_artists(&self) -> Vec<(Uuid, f64)> {
        let mut artists: Vec<(Uuid, f64)> =
            self.artists.iter().filter(|(_, s)| **s > 0.0).map(|(&a, &s)| (a, s)).collect();
        artists.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        artists
    }

    pub fn is_established(&self, artist: Uuid) -> bool {
        self.artist_plays.get(&artist).is_some_and(|&plays| plays >= ESTABLISHED_PLAYS)
    }

    pub fn nearest_mode(&self, vector: &[f32]) -> Option<usize> {
        (0..self.modes.len()).max_by(|&a, &b| {
            dot(&self.modes[a].centre, vector).total_cmp(&dot(&self.modes[b].centre, vector)).then(b.cmp(&a))
        })
    }
}

pub fn taste(snapshot: &Snapshot, listener: &Listener) -> Taste {
    let mut artists: HashMap<Uuid, f64> = HashMap::new();
    let mut genres: HashMap<Uuid, f64> = HashMap::new();
    let mut artist_plays: HashMap<Uuid, i32> = HashMap::new();
    let mut positive: Vec<(usize, f64)> = Vec::new();

    for (track, signal) in &listener.tracks {
        let Some(row) = snapshot.row_of(*track) else { continue };
        let meta = snapshot.meta(row);

        for (position, artist) in meta.artists.iter().enumerate() {
            let share = if position == 0 { 1.0 } else { 0.5 };
            *artists.entry(*artist).or_default() += signal.score * share;
            *artist_plays.entry(*artist).or_default() += signal.plays;
        }
        if let Some(genre) = meta.genre_id {
            *genres.entry(genre).or_default() += signal.score;
        }
        if signal.score > 0.0 {
            positive.push((row, signal.score));
        }
    }
    positive.sort_by_key(|&(row, _)| row);
    scale_to_unit(&mut artists);
    scale_to_unit(&mut genres);

    let modes = modes(snapshot, &positive);
    let centre = (!positive.is_empty()).then(|| {
        let mut centre = vec![0.0; snapshot.dimension()];
        for &(row, weight) in &positive {
            #[expect(clippy::cast_possible_truncation, reason = "a weight")]
            vector::add_scaled(&mut centre, snapshot.vector(row), weight as f32);
        }
        vector::normalize(&mut centre);
        centre
    });

    let fit = if modes.is_empty() {
        vec![0.0; snapshot.len()]
    } else {
        let mut best = vec![f32::MIN; snapshot.len()];
        for mode in &modes {
            for (row, similarity) in snapshot.similarities(&mode.centre).into_iter().enumerate() {
                best[row] = best[row].max(similarity);
            }
        }
        vector::percentile_ranks(&best)
    };

    Taste { modes, centre, artists, genres, artist_plays, fit }
}

fn scale_to_unit(scores: &mut HashMap<Uuid, f64>) {
    let reach = scores.values().fold(1.0_f64, |reach, score| reach.max(score.abs()));
    if reach > 0.0 {
        scores.values_mut().for_each(|score| *score /= reach);
    }
}

fn modes(snapshot: &Snapshot, positive: &[(usize, f64)]) -> Vec<Mode> {
    if positive.is_empty() {
        return vec![];
    }
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        clippy::cast_precision_loss,
        reason = "a small count"
    )]
    let k = ((positive.len() as f64 / 3.0).sqrt().round() as usize).clamp(1, MAX_MODES);

    let heaviest = positive.iter().max_by(|a, b| a.1.total_cmp(&b.1).then(b.0.cmp(&a.0))).map_or(0, |&(row, _)| row);
    let mut centres: Vec<Vec<f32>> = vec![snapshot.vector(heaviest).to_vec()];
    while centres.len() < k {
        let farthest = positive.iter().min_by(|a, b| {
            let closest = |row: usize| centres.iter().map(|c| dot(c, snapshot.vector(row))).fold(f32::MIN, f32::max);
            closest(a.0).total_cmp(&closest(b.0)).then(a.0.cmp(&b.0))
        });
        match farthest {
            Some(&(row, _)) => centres.push(snapshot.vector(row).to_vec()),
            None => break,
        }
    }

    let mut assignment = vec![0; positive.len()];
    for _ in 0..8 {
        for (index, &(row, _)) in positive.iter().enumerate() {
            let vector = snapshot.vector(row);
            assignment[index] = (0..centres.len())
                .max_by(|&a, &b| dot(&centres[a], vector).total_cmp(&dot(&centres[b], vector)).then(b.cmp(&a)))
                .unwrap_or(0);
        }
        let mut next = vec![vec![0.0; snapshot.dimension()]; centres.len()];
        for (index, &(row, weight)) in positive.iter().enumerate() {
            #[expect(clippy::cast_possible_truncation, reason = "a weight")]
            vector::add_scaled(&mut next[assignment[index]], snapshot.vector(row), weight as f32);
        }
        for (centre, mut sum) in centres.iter_mut().zip(next) {
            if vector::norm(&sum) > 0.0 {
                vector::normalize(&mut sum);
                *centre = sum;
            }
        }
    }

    let total: f64 = positive.iter().map(|&(_, weight)| weight).sum();
    let mut shares = vec![0.0; centres.len()];
    for (index, &(_, weight)) in positive.iter().enumerate() {
        shares[assignment[index]] += weight / total;
    }
    centres
        .into_iter()
        .zip(shares)
        .filter(|(_, share)| *share > 0.0)
        .map(|(centre, share)| Mode { centre, share })
        .collect()
}

pub fn score(snapshot: &Snapshot, listener: &Listener, taste: &Taste, row: usize, noise: f64) -> Option<f64> {
    let meta = snapshot.meta(row);
    let signal = listener.tracks.get(&meta.track_id).copied().unwrap_or_default();
    if signal.rejected() {
        return None;
    }
    let allowed = listener.rules.weight(meta)?;

    #[expect(clippy::cast_precision_loss, reason = "ages in days")]
    let age_days = (listener.now - meta.added_at).max(0) as f64 / DAY as f64;
    let freshness = (-age_days / FRESHNESS_DAYS).exp();
    let popularity = f64::from(meta.popularity);
    let behaviour = behaviour(taste, meta.artists.as_slice(), meta.genre_id);

    let merit = if taste.is_empty() {
        0.45 * freshness + 0.35 * popularity + 0.2 * noise
    } else {
        0.55 * f64::from(taste.fit[row])
            + 0.2 * (behaviour + 1.0) / 2.0
            + 0.1 * popularity
            + 0.1 * freshness
            + 0.05 * noise
    };

    let mut penalty = 1.0;
    if let Some(last) = signal.last_played {
        let since = listener.now - last;
        if since < JUST_PLAYED {
            penalty *= JUST_PLAYED_PENALTY;
        } else if since < RECENTLY_PLAYED {
            penalty *= RECENTLY_PLAYED_PENALTY;
        }
    }
    if behaviour < -0.3 {
        penalty *= DISLIKED_ARTIST_PENALTY;
    }
    Some(merit * penalty * allowed)
}

pub fn behaviour(taste: &Taste, artists: &[Uuid], genre: Option<Uuid>) -> f64 {
    let (mut total, mut weight) = (0.0, 0.0);
    for (position, artist) in artists.iter().enumerate() {
        if let Some(score) = taste.artists.get(artist) {
            let share = if position == 0 { 1.0 } else { 0.5 };
            total += score * share;
            weight += share;
        }
    }
    let artist = if weight > 0.0 { total / weight } else { 0.0 };
    let genre = genre.and_then(|g| taste.genres.get(&g)).copied().unwrap_or(0.0);
    (artist * 0.7 + genre * 0.3).clamp(-1.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::tests::snapshot;

    fn listener(signals: &[(u128, f64, i32)]) -> Listener {
        Listener {
            user: Uuid::nil(),
            now: 100 * DAY,
            day: 100,
            tracks: signals
                .iter()
                .map(|&(id, score, plays)| {
                    (Uuid::from_u128(id), TrackSignal { score, plays, ..TrackSignal::default() })
                })
                .collect(),
            rules: Rules::default(),
        }
    }

    fn library() -> Snapshot {
        snapshot(&[
            (1, 10, "a", [1.0, 0.0, 0.0]),
            (2, 10, "b", [0.95, 0.1, 0.0]),
            (3, 20, "c", [0.0, 1.0, 0.0]),
            (4, 30, "d", [0.0, 0.0, 1.0]),
            (5, 30, "e", [0.1, 0.0, 0.95]),
        ])
    }

    #[test]
    fn liked_sound_ranks_higher() {
        let snapshot = library();
        let listener = listener(&[(1, 2.0, 3)]);
        let taste = taste(&snapshot, &listener);
        assert_eq!(taste.modes.len(), 1);
        assert!(taste.fit[1] > taste.fit[3]);
        let near = score(&snapshot, &listener, &taste, 1, 0.0).unwrap_or_default();
        let far = score(&snapshot, &listener, &taste, 3, 0.0).unwrap_or_default();
        assert!(near > far, "{near} vs {far}");
        assert_eq!(taste.top_artists()[0].0, Uuid::from_u128(10));
        assert!(taste.is_established(Uuid::from_u128(10)));
    }

    #[test]
    fn two_distant_loves_make_two_modes() {
        let rows: Vec<(u128, u128, &str, [f32; 3])> = (1..=12u8)
            .map(|id| {
                let wobble = f32::from(id) * 0.01;
                let vector = if id <= 6 { [1.0, wobble, 0.0] } else { [0.0, wobble, 1.0] };
                (u128::from(id), u128::from(id), "t", vector)
            })
            .collect();
        let snapshot = snapshot(&rows);
        let listener = listener(&(1..=12).map(|id| (id, 1.0, 1)).collect::<Vec<_>>());
        let taste = taste(&snapshot, &listener);

        assert_eq!(taste.modes.len(), 2);
        assert!(taste.modes.iter().all(|mode| (mode.share - 0.5).abs() < 1e-9));
        let first = taste.nearest_mode(&[1.0, 0.0, 0.0]);
        assert_ne!(first, taste.nearest_mode(&[0.0, 0.0, 1.0]));
    }

    #[test]
    fn rules_hide_or_lower_a_track() {
        let snapshot = library();
        let mut listener = listener(&[(1, 2.0, 3)]);
        let taste = taste(&snapshot, &listener);
        let open = score(&snapshot, &listener, &taste, 1, 0.0).unwrap_or_default();

        listener.rules = Rules::new([], [Uuid::from_u128(10)]);
        let lowered = score(&snapshot, &listener, &taste, 1, 0.0).unwrap_or_default();
        assert!((lowered - open * crate::rules::DOWNRANK).abs() < 1e-9);

        listener.rules = Rules::new([Uuid::from_u128(2)], []);
        assert!(score(&snapshot, &listener, &taste, 1, 0.0).is_none());
    }

    #[test]
    fn rejected_tracks_are_not_offered() {
        let snapshot = library();
        let listener = listener(&[(3, -1.0, 0)]);
        let taste = taste(&snapshot, &listener);
        assert!(score(&snapshot, &listener, &taste, 2, 0.0).is_none());
        assert!(taste.artists[&Uuid::from_u128(20)] < 0.0);
    }

    #[test]
    fn an_isolated_skip_does_not_reject_a_song_but_repeated_rejection_does() {
        let once = TrackSignal { score: -0.1, early_skips: 1, ..TrackSignal::default() };
        assert!(!once.rejected());
        let repeated = TrackSignal { score: -0.2, early_skips: 4, ..TrackSignal::default() };
        assert!(repeated.rejected());
        let library = library();
        let listener = listener(&[(3, -0.1, 0)]);
        let taste = taste(&library, &listener);
        assert!(
            behaviour(&taste, &[Uuid::from_u128(20)], None) > -0.2,
            "a weak signal must not normalize into maximum artist rejection"
        );
    }
}
