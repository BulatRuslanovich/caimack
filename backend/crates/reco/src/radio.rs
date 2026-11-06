// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::{HashMap, HashSet};

use uuid::Uuid;

use serde::Serialize;

use crate::calibration;
use crate::random::{self, Rng};
use crate::rules::Verdict;
use crate::session::Session;
use crate::snapshot::Snapshot;
use crate::taste::{self, Listener, Taste};
use crate::transition;

const ANCHOR_CANDIDATES: usize = 20;
const ANCHOR_TEMPERATURE: f64 = 0.08;

const STUCK_WINDOW: usize = 5;
const STUCK_REPEATS: usize = 3;
const RECENT_ARTIST_WINDOW: usize = 10;
const RECENT_ARTIST_PENALTY: f64 = 0.5;

const WARM_TRACKS: usize = 10;
const POOL: usize = 150;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Focus {
    #[default]
    Balanced,
    Closer,
    Wider,
}

pub struct RadioRequest<'a> {
    pub seed: Option<Uuid>,

    pub queue: &'a [Uuid],

    pub recent: &'a [Uuid],
    pub session: Option<&'a Session>,
    pub limit: usize,
    pub focus: Focus,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
pub struct Features {
    pub similarity: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub similarity_rank: Option<f32>,
    pub fit: f32,
    pub behaviour: f32,
    pub transition: f32,
    pub sameness: f32,
    pub weight: f32,
    pub session: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RadioPick {
    pub row: usize,
    pub explore: bool,
    pub score: f32,
    pub features: Features,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct RadioBatch {
    pub anchor: Option<usize>,

    pub moved: bool,
    pub picks: Vec<RadioPick>,
}

#[derive(Debug, Clone, Copy)]
struct Weights {
    similarity: f64,
    fit: f64,
    behaviour: f64,
    sameness: f64,
}

fn weights(taste: bool, focus: Focus) -> Weights {
    let base = match taste {
        false => Weights { similarity: 0.85, fit: 0.0, behaviour: 0.0, sameness: 0.3 },
        true => Weights { similarity: 0.55, fit: 0.2, behaviour: 0.1, sameness: 0.3 },
    };
    match focus {
        Focus::Balanced => base,
        Focus::Closer => Weights { similarity: base.similarity + 0.25, fit: base.fit * 0.5, sameness: 0.1, ..base },
        Focus::Wider => Weights {
            similarity: base.similarity * 0.6,
            fit: base.fit + 0.15,
            behaviour: base.behaviour + 0.05,
            sameness: 0.5,
        },
    }
}

#[derive(Debug, Clone, Copy)]
struct Candidate {
    row: usize,
    base: f64,
    features: Features,
}

impl Candidate {
    fn similarity(&self) -> f32 {
        self.features.similarity_rank.unwrap_or(self.features.similarity)
    }
}

pub fn next(snapshot: &Snapshot, listener: &Listener, taste: &Taste, request: &RadioRequest<'_>) -> RadioBatch {
    if snapshot.is_empty() {
        return RadioBatch::default();
    }
    let mut rng =
        Rng::new(random::seed(listener.user, "radio", listener.now) ^ random::mix(request.queue.len() as u64));
    let empty_session = Session::default();
    let session = request.session.unwrap_or(&empty_session);

    let mut excluded: HashSet<usize> = HashSet::new();
    let rejected = listener.tracks.iter().filter(|(_, signal)| signal.rejected()).map(|(id, _)| *id);
    for track in request.queue.iter().chain(request.recent).copied().chain(rejected) {
        if let Some(row) = snapshot.row_of(track) {
            excluded.extend(snapshot.clones(row));
        }
    }
    if !listener.rules.is_empty() {
        excluded
            .extend((0..snapshot.len()).filter(|&row| listener.rules.verdict(snapshot.meta(row)) == Verdict::Blocked));
    }

    let heard = if session.heard.is_empty() { request.queue } else { &session.heard };
    let tail: Vec<usize> =
        heard.iter().filter(|&&id| Some(id) != request.seed).filter_map(|&id| snapshot.row_of(id)).collect();
    let tail = &tail[tail.len().saturating_sub(RECENT_ARTIST_WINDOW)..];

    let seed = if session.skip_streak >= 2 { session.last_good } else { request.seed };
    let seed = seed.and_then(|seed| snapshot.row_of(seed));
    let (anchor, moved) = match seed {
        Some(seeded) => match stuck(snapshot, seeded, tail) {
            Some(seed_artists) if !taste.is_empty() => {
                let other = other_mode(taste, snapshot.vector(seeded), &mut rng);
                let skip = |row: usize| snapshot.meta(row).artists.iter().any(|a| seed_artists.contains(a));
                match taste_anchor(snapshot, &taste.modes[other].centre, &excluded, &mut rng, skip) {
                    Some(fresh) => (Some(fresh), true),
                    None => (Some(seeded), false),
                }
            }
            _ => (Some(seeded), false),
        },
        None if !taste.is_empty() => {
            let mode = pick_mode(taste, &mut rng);
            (taste_anchor(snapshot, &taste.modes[mode].centre, &excluded, &mut rng, |_| false), false)
        }
        None => {
            let open: Vec<usize> = (0..snapshot.len()).filter(|row| !excluded.contains(row)).collect();
            if open.is_empty() {
                return RadioBatch::default();
            }
            (Some(open[rng.below(open.len())]), false)
        }
    };
    let Some(anchor) = anchor else { return RadioBatch::default() };
    excluded.extend(snapshot.clones(anchor));

    let anchor_similarity = snapshot.similarities(snapshot.vector(anchor));
    let similarity_ranks = {
        // Seed copies, blocked songs and rejected tracks are not competitors.
        let candidates: Vec<f32> = anchor_similarity
            .iter()
            .enumerate()
            .map(|(row, &score)| if excluded.contains(&row) { f32::NAN } else { score })
            .collect();
        calibration::relative_scores(&candidates)
    };
    let mut recent_artists: HashSet<Uuid> = tail.iter().flat_map(|&row| snapshot.meta(row).artists.clone()).collect();
    if moved && let Some(seeded) = request.seed.and_then(|seed| snapshot.row_of(seed)) {
        recent_artists.extend(snapshot.meta(seeded).artists.iter().copied());
    }

    let mut weights = weights(!taste.is_empty(), request.focus);
    if session.skip_streak >= 2 {
        weights.similarity *= 0.4;
    }
    // An explicitly chosen new seed takes precedence over an earlier session.
    let session_weight = if request.seed.is_some_and(|seed| Some(seed) != session.current) { 0.15 } else { 0.65 };
    let mut ranked: Vec<Candidate> = (0..snapshot.len())
        .filter(|row| !excluded.contains(row))
        .map(|row| {
            let meta = snapshot.meta(row);
            let features = Features {
                similarity: anchor_similarity[row],
                similarity_rank: Some(similarity_ranks[row]),
                fit: taste.fit.get(row).copied().unwrap_or(0.0),
                #[expect(clippy::cast_possible_truncation, reason = "a score in [0, 1]")]
                behaviour: ((taste::behaviour(taste, &meta.artists, meta.genre_id) + 1.0) / 2.0) as f32,
                transition: 0.0,
                sameness: 0.0,
                #[expect(clippy::cast_possible_truncation, reason = "a weight in [0, 1]")]
                weight: listener.rules.weight(meta).unwrap_or(0.0) as f32,
                session: session.affinity(snapshot, row),
            };
            let mut base = weights.similarity * f64::from(features.similarity_rank.unwrap_or(features.similarity))
                + weights.fit * f64::from(features.fit)
                + weights.behaviour * f64::from(features.behaviour)
                + session_weight * f64::from(features.session);
            base -= (1.0 - recency(listener, meta.track_id)) * 0.4;
            let rule_weight = f64::from(features.weight).max(0.01);
            base = if base >= 0.0 { base * rule_weight } else { base / rule_weight };
            if meta.artists.iter().any(|artist| recent_artists.contains(artist)) {
                base -= base.abs() * (1.0 - RECENT_ARTIST_PENALTY);
            }
            Candidate { row, base, features }
        })
        .collect();
    ranked.sort_by(|a, b| b.base.total_cmp(&a.base).then(a.row.cmp(&b.row)));

    let positive = listener.tracks.values().filter(|signal| signal.score > 0.0).count();
    let explore_ratio = session.exploration(positive < WARM_TRACKS);
    let size = request.limit.saturating_sub(usize::from(moved));
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        clippy::cast_precision_loss,
        reason = "a small share"
    )]
    let explore_slots = (size as f64 * explore_ratio).round() as usize;
    let per_artist = if request.limit <= 6 { 1 } else { 2 };

    let mut picks: Vec<RadioPick> = Vec::with_capacity(request.limit);
    if moved {
        picks.push(RadioPick {
            row: anchor,
            explore: unheard(listener, snapshot.meta(anchor).track_id),
            score: 1.0,
            features: Features::default(),
        });
    }
    let previous = request.queue.last().and_then(|&id| snapshot.row_of(id)).unwrap_or(anchor);
    let mut sequence = Sequence::new(snapshot, per_artist);
    if moved {
        sequence.take(anchor);
    }

    let merit_floor = ranked.first().map_or(0.0, |candidate| candidate.base - 0.3);
    let floors = if request.seed.is_some() && session.skip_streak < 2 {
        let nearest = ranked.iter().map(Candidate::similarity).fold(-1.0_f32, f32::max);
        match request.focus {
            Focus::Closer => [nearest - 0.15, nearest - 0.25, nearest - 0.35],
            Focus::Balanced => [nearest - 0.35, nearest - 0.45, nearest - 0.5],
            Focus::Wider => [-1.0; 3],
        }
    } else {
        [-1.0; 3]
    };
    let mut explored = 0;
    while picks.len() < request.limit {
        let position = picks.len().saturating_sub(usize::from(moved));
        let discover = explored < explore_slots && (2 * position + 1) * explore_slots >= (2 * explored + 1) * size;
        // Exhaust each neighborhood before expanding. Even the final fallback
        // respects its sound boundary, artist caps, and duplicate exclusions.
        let pick = floors.iter().find_map(|&floor| {
            let choose = |discovery: Option<bool>, minimum: f64| {
                sequence.best(
                    ranked.iter().filter(|candidate| {
                        candidate.similarity() >= floor
                            && candidate.base >= minimum
                            && discovery
                                .is_none_or(|wanted| unheard(listener, snapshot.meta(candidate.row).track_id) == wanted)
                    }),
                    &weights,
                )
            };
            discover
                .then(|| choose(Some(true), merit_floor))
                .flatten()
                .or_else(|| choose(Some(false), merit_floor))
                .or_else(|| choose(None, merit_floor))
                .or_else(|| choose(None, f64::NEG_INFINITY))
        });
        let Some(mut pick) = pick else {
            break;
        };
        pick.explore = unheard(listener, snapshot.meta(pick.row).track_id);
        explored += usize::from(pick.explore);
        sequence.take(pick.row);
        picks.push(pick);
    }

    // Transition metadata may reorder the selected set, never change its members.
    let fixed = usize::from(moved);
    order_for_transitions(snapshot, if moved { anchor } else { previous }, &mut picks[fixed..]);

    RadioBatch { anchor: Some(anchor), moved, picks }
}

fn unheard(listener: &Listener, track: Uuid) -> bool {
    listener.tracks.get(&track).is_none_or(|signal| !signal.familiar())
}

fn recency(listener: &Listener, track: Uuid) -> f64 {
    let Some(last) = listener.tracks.get(&track).and_then(|signal| signal.last_played) else { return 1.0 };
    match listener.now.saturating_sub(last) {
        ..1200 => 0.15,
        1200..7200 => 0.45,
        7200..86400 => 0.75,
        86400..604800 => 0.95,
        _ => 1.0,
    }
}

struct Sequence<'a> {
    snapshot: &'a Snapshot,
    picked: Vec<usize>,
    taken: HashSet<usize>,
    artists: HashMap<Uuid, usize>,
    per_artist: usize,
}

impl<'a> Sequence<'a> {
    fn new(snapshot: &'a Snapshot, per_artist: usize) -> Self {
        Self { snapshot, picked: Vec::new(), taken: HashSet::new(), artists: HashMap::new(), per_artist }
    }

    fn allows(&self, row: usize) -> bool {
        !self.taken.contains(&row)
            && self
                .snapshot
                .meta(row)
                .credited_artists()
                .all(|artist| self.artists.get(&artist).copied().unwrap_or(0) < self.per_artist)
    }

    fn take(&mut self, row: usize) {
        self.taken.extend(self.snapshot.clones(row));
        for artist in self.snapshot.meta(row).credited_artists() {
            *self.artists.entry(artist).or_default() += 1;
        }
        self.picked.push(row);
    }

    fn best<'c>(&self, candidates: impl Iterator<Item = &'c Candidate>, weights: &Weights) -> Option<RadioPick> {
        candidates
            .filter(|candidate| self.allows(candidate.row))
            .take(POOL)
            .map(|candidate| {
                let sameness = self
                    .picked
                    .iter()
                    .map(|&row| self.snapshot.between(row, candidate.row))
                    .fold(0.0_f32, f32::max)
                    .max(0.0);
                let score = candidate.base - weights.sameness * f64::from(sameness);
                let features = Features { sameness, ..candidate.features };
                (candidate.row, score, features)
            })
            .max_by(|a, b| a.1.total_cmp(&b.1).then(b.0.cmp(&a.0)))
            .map(|(row, score, features)| {
                #[expect(clippy::cast_possible_truncation, reason = "a score")]
                let score = score as f32;
                RadioPick { row, explore: false, score, features }
            })
    }
}

fn order_for_transitions(snapshot: &Snapshot, mut previous: usize, picks: &mut [RadioPick]) {
    // A small bounded batch: removing from this copy preserves relevance ties
    // while keeping discoveries in the slots assigned during selection.
    let mut remaining = picks.to_vec();
    for pick in picks {
        let smoothness = |at: usize| transition::smoothness(snapshot.meta(previous), snapshot.meta(remaining[at].row));
        let best = (0..remaining.len())
            .filter(|&at| remaining[at].explore == pick.explore)
            .max_by(|&a, &b| smoothness(a).total_cmp(&smoothness(b)).then(b.cmp(&a)));
        let Some(best) = best else { continue };
        *pick = remaining.remove(best);
        #[expect(clippy::cast_possible_truncation, reason = "a transition score in [0, 1]")]
        let transition = transition::smoothness(snapshot.meta(previous), snapshot.meta(pick.row)) as f32;
        pick.features.transition = transition;
        previous = pick.row;
    }
}

fn taste_anchor(
    snapshot: &Snapshot,
    centre: &[f32],
    excluded: &HashSet<usize>,
    rng: &mut Rng,
    skip: impl Fn(usize) -> bool,
) -> Option<usize> {
    let nearest = snapshot.top_k(centre, ANCHOR_CANDIDATES, |row| skip(row) || excluded.contains(&row));
    let scores: Vec<f64> = nearest.iter().map(|hit| f64::from(hit.score)).collect();
    let best = scores.iter().copied().fold(f64::MIN, f64::max);
    let weights: Vec<f64> = scores.iter().map(|score| ((score - best) / ANCHOR_TEMPERATURE).exp()).collect();
    let mut threshold = rng.next_f64() * weights.iter().sum::<f64>();
    for (hit, weight) in nearest.iter().zip(&weights) {
        threshold -= weight;
        if threshold <= 0.0 {
            return Some(hit.row);
        }
    }
    nearest.first().map(|hit| hit.row)
}

fn stuck(snapshot: &Snapshot, seed: usize, tail: &[usize]) -> Option<Vec<Uuid>> {
    let artists = &snapshot.meta(seed).artists;
    let window = &tail[tail.len().saturating_sub(STUCK_WINDOW)..];
    let repeats = window.iter().filter(|&&row| snapshot.meta(row).artists.iter().any(|a| artists.contains(a))).count();
    (repeats >= STUCK_REPEATS).then(|| artists.clone())
}

fn other_mode(taste: &Taste, seed: &[f32], rng: &mut Rng) -> usize {
    let nearest = taste.nearest_mode(seed).unwrap_or(0);
    let others: Vec<usize> = (0..taste.modes.len()).filter(|&index| index != nearest).collect();
    if others.is_empty() {
        return nearest;
    }
    let total: f64 = others.iter().map(|&index| taste.modes[index].share).sum();
    let mut roll = rng.next_f64() * total;
    for &index in &others {
        roll -= taste.modes[index].share;
        if roll < 0.0 {
            return index;
        }
    }
    others[others.len() - 1]
}

fn pick_mode(taste: &Taste, rng: &mut Rng) -> usize {
    let mut roll = rng.next_f64();
    for (index, mode) in taste.modes.iter().enumerate() {
        roll -= mode.share;
        if roll < 0.0 {
            return index;
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::Rules;
    use crate::snapshot::tests::meta;
    use crate::taste::{TrackSignal, taste};

    fn library() -> Snapshot {
        let mut rng = Rng::new(9);
        let rows = (0..60u32)
            .map(|i| {
                #[expect(clippy::cast_possible_truncation, reason = "test noise")]
                let v: Vec<f32> =
                    (0..6).map(|d| if d == i as usize % 3 { 1.0 } else { rng.next_f64() as f32 * 0.4 }).collect();
                (meta(u128::from(i), u128::from(i % 12), &format!("t{i}")), v)
            })
            .collect();
        Snapshot::new(6, rows)
    }

    fn listener(signals: &[(u128, f64)]) -> Listener {
        Listener {
            user: Uuid::from_u128(5),
            now: 1_000,
            day: 1,
            tracks: signals
                .iter()
                .map(|&(id, score)| (Uuid::from_u128(id), TrackSignal { score, plays: 1, ..TrackSignal::default() }))
                .collect(),
            rules: Rules::default(),
        }
    }

    #[test]
    fn shared_featured_artists_respect_the_same_cap_and_duplicate_credits_count_once() {
        let rows = (0..=200u128)
            .map(|id| {
                let mut track = meta(id, id, &format!("t{id}"));
                if (1..=160).contains(&id) {
                    track.artists.extend([Uuid::from_u128(500), Uuid::from_u128(500)]);
                }
                (track, vec![1.0, 0.0])
            })
            .collect();
        let snapshot = Snapshot::new(2, rows);
        let listener = listener(&[]);
        let taste = taste(&snapshot, &listener);
        for (limit, expected) in [(6, 1), (8, 2)] {
            let batch = next(&snapshot, &listener, &taste, &request(Some(0), &[], limit, Focus::Balanced));
            assert_eq!(batch.picks.len(), limit);
            assert_eq!(
                batch.picks.iter().filter(|p| snapshot.meta(p.row).is_by(Uuid::from_u128(500))).count(),
                expected
            );
        }
    }

    #[test]
    fn depleted_close_pool_does_not_fall_back_to_unrelated_tracks() {
        let mut rows = vec![(meta(0, 0, "seed"), vec![1.0, 0.0])];
        for id in 1..=4u32 {
            rows.push((meta(u128::from(id), 100, &format!("close{id}")), vec![1.0, id as f32 * 0.01]));
        }
        for id in 5..=34u128 {
            rows.push((meta(id, id, &format!("far{id}")), vec![0.0, 1.0]));
        }
        let snapshot = Snapshot::new(2, rows);
        let listener = listener(&[]);
        let taste = taste(&snapshot, &listener);
        let batch = next(&snapshot, &listener, &taste, &request(Some(0), &[], 5, Focus::Closer));
        assert_eq!(batch.picks.len(), 1, "artist limits should not force unrelated filler");
        assert!(batch.picks.iter().all(|p| p.row <= 4));
    }

    #[test]
    fn closer_expands_one_step_to_fill_from_the_next_neighborhood() {
        let rows = (0..=100u32)
            .map(|id| {
                let cosine = 1.0 - id as f32 / 101.0;
                let artist = if (1..=15).contains(&id) { 500 } else { u128::from(id) };
                (meta(u128::from(id), artist, &format!("t{id}")), vec![cosine, (1.0 - cosine * cosine).sqrt()])
            })
            .collect();
        let snapshot = Snapshot::new(2, rows);
        let listener = listener(&[]);
        let batch = next(&snapshot, &listener, &taste(&snapshot, &listener), &request(Some(0), &[], 6, Focus::Closer));
        assert_eq!(batch.picks.len(), 6);
        assert_eq!(batch.picks.iter().filter(|p| snapshot.meta(p.row).is_by(Uuid::from_u128(500))).count(), 1);
        assert!(batch.picks.iter().all(|p| p.features.similarity_rank.unwrap() >= 0.75));
        assert!(batch.picks.iter().any(|p| p.features.similarity_rank.unwrap() < 0.85));
    }

    #[test]
    fn transition_metadata_cannot_change_which_tracks_are_selected() {
        let make = |smooth: bool| {
            let rows = (0..=100u32)
                .map(|id| {
                    let cosine = 1.0 - id as f32 / 101.0;
                    let mut track = meta(u128::from(id), u128::from(id), &format!("t{id}"));
                    let matches_seed = id == 0 || (smooth && id == 2);
                    track.tempo_bpm = Some(if matches_seed { 120.0 } else { 150.0 });
                    track.musical_key = Some(if matches_seed { 0 } else { 6 });
                    (track, vec![cosine, (1.0 - cosine * cosine).sqrt()])
                })
                .collect();
            Snapshot::new(2, rows)
        };
        let listener = listener(&[]);
        let selected = |snapshot: &Snapshot, limit, focus| {
            next(snapshot, &listener, &taste(snapshot, &listener), &request(Some(0), &[], limit, focus))
                .picks
                .iter()
                .map(|p| p.row)
                .collect::<HashSet<_>>()
        };
        assert_eq!(selected(&make(false), 1, Focus::Closer), HashSet::from([1]));
        for focus in [Focus::Closer, Focus::Balanced, Focus::Wider] {
            for limit in [1, 6] {
                assert_eq!(
                    selected(&make(false), limit, focus),
                    selected(&make(true), limit, focus),
                    "a smooth but weaker match must not replace a sound match"
                );
            }
        }
    }

    #[test]
    fn compressed_cosines_do_not_let_transition_metadata_override_seed_evidence() {
        let mut seed = meta(0, 10, "seed");
        seed.tempo_bpm = Some(120.0);
        seed.musical_key = Some(0);
        let mut near = meta(1, 11, "near");
        near.tempo_bpm = Some(150.0);
        near.musical_key = Some(6);
        let mut farther = meta(2, 12, "farther");
        farther.tempo_bpm = Some(120.0);
        farther.musical_key = Some(0);
        let vector = |cosine: f32| vec![cosine, (1.0 - cosine * cosine).sqrt()];
        let snapshot = Snapshot::new(2, vec![(seed, vec![1.0, 0.0]), (near, vector(0.95)), (farther, vector(0.94))]);
        let listener = listener(&[]);
        let taste = taste(&snapshot, &listener);
        let request = request(Some(0), &[], 1, Focus::Closer);
        let after = next(&snapshot, &listener, &taste, &request);
        assert_eq!(after.picks[0].row, 1);
        assert!(after.picks[0].features.similarity > 0.94, "retain raw evidence for diagnostics");
    }

    #[test]
    fn a_seeded_radio_follows_the_seed_and_skips_the_queue() {
        let snapshot = library();
        let listener = listener(&[]);
        let taste = taste(&snapshot, &listener);
        let queue = [Uuid::from_u128(3)];
        let request = RadioRequest {
            seed: Some(Uuid::from_u128(0)),
            queue: &queue,
            recent: &[],
            session: None,
            limit: 10,
            focus: Focus::Balanced,
        };
        let batch = next(&snapshot, &listener, &taste, &request);

        assert_eq!(batch.anchor, Some(0));
        assert_eq!(batch.picks.len(), 10);
        let rows: HashSet<usize> = batch.picks.iter().map(|p| p.row).collect();
        assert!(!rows.contains(&0) && !rows.contains(&3));
        let close = batch.picks.iter().filter(|p| p.row % 3 == 0).count();
        assert!(close >= 5, "{batch:?}");
    }

    #[test]
    fn without_a_seed_the_radio_starts_from_taste_or_anywhere() {
        let snapshot = library();
        for listener in [listener(&[]), listener(&[(1, 2.0), (4, 1.0)])] {
            let taste = taste(&snapshot, &listener);
            let request =
                RadioRequest { seed: None, queue: &[], recent: &[], session: None, limit: 3, focus: Focus::Balanced };
            let batch = next(&snapshot, &listener, &taste, &request);
            assert!(batch.anchor.is_some());
            assert_eq!(batch.picks.len(), 3);
        }
    }

    #[test]
    fn a_stuck_radio_moves_to_another_artist() {
        let snapshot = library();
        let liked: Vec<(u128, f64)> = (0..30).map(|i| (i, 1.0)).collect();
        let listener = listener(&liked);
        let taste = taste(&snapshot, &listener);

        let queue = [Uuid::from_u128(12), Uuid::from_u128(24), Uuid::from_u128(36), Uuid::from_u128(0)];
        let request = RadioRequest {
            seed: Some(Uuid::from_u128(0)),
            queue: &queue,
            recent: &[],
            session: None,
            limit: 5,
            focus: Focus::Balanced,
        };
        let batch = next(&snapshot, &listener, &taste, &request);
        assert!(batch.moved);
        let anchor = batch.anchor.unwrap_or_default();
        assert_ne!(snapshot.meta(anchor).artist(), Uuid::from_u128(0));
        assert_eq!(batch.picks[0].row, anchor);
    }

    fn request<'a>(seed: Option<u128>, queue: &'a [Uuid], limit: usize, focus: Focus) -> RadioRequest<'a> {
        RadioRequest { seed: seed.map(Uuid::from_u128), queue, recent: &[], session: None, limit, focus }
    }

    fn cluster(snapshot: &Snapshot, row: usize) -> usize {
        let vector = snapshot.vector(row);
        (0..3).max_by(|&a, &b| vector[a].total_cmp(&vector[b])).unwrap_or(0)
    }

    fn at(mut listener: Listener, now: i64) -> Listener {
        listener.now = now;
        listener
    }

    #[test]
    fn one_taste_keeps_the_radio_in_it() {
        let snapshot = library();
        let liked: Vec<(u128, f64)> = (0..60).filter(|i| i % 3 == 0).map(|i| (i, 1.0)).collect();
        let (mut inside, mut total) = (0, 0);
        for day in 0..10 {
            let listener = at(listener(&liked), 1_000 + day * 86_400);
            let taste = taste(&snapshot, &listener);
            let batch = next(&snapshot, &listener, &taste, &request(None, &[], 8, Focus::Balanced));
            for pick in batch.picks.iter().filter(|pick| !pick.explore) {
                total += 1;
                inside += usize::from(cluster(&snapshot, pick.row) == 0);
            }
        }
        assert!(total > 0 && inside * 10 >= total * 7, "{inside} of {total}");
    }

    #[test]
    fn two_tastes_are_both_visited() {
        let snapshot = library();
        let liked: Vec<(u128, f64)> = (0..60).filter(|i| i % 3 != 1).map(|i| (i, 1.0)).collect();
        let mut anchors = HashSet::new();
        for day in 0..20 {
            let listener = at(listener(&liked), 1_000 + day * 86_400);
            let taste = taste(&snapshot, &listener);
            let batch = next(&snapshot, &listener, &taste, &request(None, &[], 4, Focus::Balanced));
            anchors.extend(batch.anchor.map(|row| cluster(&snapshot, row)));
        }
        assert_eq!(anchors, HashSet::from([0, 2]));
    }

    #[test]
    fn closer_stays_with_the_seed_and_wider_strays() {
        let snapshot = library();
        let liked: Vec<(u128, f64)> = (0..60).filter(|i| i % 3 == 0).map(|i| (i, 1.0)).collect();
        let listener = listener(&liked);
        let taste = taste(&snapshot, &listener);
        let away = |focus: Focus| {
            let batch = next(&snapshot, &listener, &taste, &request(Some(1), &[], 12, focus));
            batch.picks.iter().filter(|pick| cluster(&snapshot, pick.row) != 1).count()
        };
        assert!(away(Focus::Closer) <= 4, "four artists, two tracks each, fill eight of twelve");
        assert!(away(Focus::Wider) > away(Focus::Closer));
    }

    #[test]
    fn blocked_artists_never_play_and_downranked_ones_rarely() {
        let snapshot = library();
        let mut listener = listener(&[]);
        let taste = taste(&snapshot, &listener);
        let seed_artist = snapshot.meta(0).artist();
        listener.rules = Rules::new([Uuid::from_u128(3)], [Uuid::from_u128(6)]);

        let batch = next(&snapshot, &listener, &taste, &request(Some(0), &[], 12, Focus::Balanced));
        assert!(batch.picks.iter().all(|pick| snapshot.meta(pick.row).artist() != Uuid::from_u128(3)));
        assert_ne!(seed_artist, Uuid::from_u128(3));
        assert!(
            batch
                .picks
                .iter()
                .all(|pick| snapshot.meta(pick.row).artist() != Uuid::from_u128(6) || pick.features.weight < 1.0)
        );
    }

    #[test]
    fn transition_ordering_keeps_the_selected_set_and_places_a_smooth_track_first() {
        let mut rows = Vec::new();
        for id in 0..3u128 {
            let mut track = meta(id, id, &format!("t{id}"));
            track.tempo_bpm = Some(if id == 1 { 150.0 } else { 120.0 });
            track.musical_key = Some(if id == 1 { 6 } else { 0 });
            rows.push((track, vec![1.0, 0.0]));
        }
        let snapshot = Snapshot::new(2, rows);
        let listener = listener(&[]);
        let taste = taste(&snapshot, &listener);

        let batch = next(&snapshot, &listener, &taste, &request(Some(0), &[], 2, Focus::Balanced));
        assert_eq!(batch.picks.iter().map(|p| p.row).collect::<Vec<_>>(), [2, 1]);
        assert!(batch.picks[0].features.transition > 0.9);
    }

    #[test]
    fn transition_ordering_preserves_discovery_slots_and_selection_scores() {
        let snapshot = Snapshot::new(
            1,
            (0..4u128)
                .map(|id| {
                    let mut track = meta(id, id, &format!("t{id}"));
                    track.tempo_bpm = Some(if id == 1 { 150.0 } else { 120.0 });
                    track.musical_key = Some(if id == 1 { 6 } else { 0 });
                    (track, vec![1.0])
                })
                .collect(),
        );
        let mut picks = (1..4)
            .map(|row| RadioPick { row, explore: row == 2, score: row as f32, features: Features::default() })
            .collect::<Vec<_>>();
        order_for_transitions(&snapshot, 0, &mut picks);
        assert_eq!(picks.iter().map(|p| p.row).collect::<Vec<_>>(), [3, 2, 1]);
        assert_eq!(picks.iter().map(|p| p.explore).collect::<Vec<_>>(), [false, true, false]);
        assert!(picks.iter().all(|p| p.score == p.row as f32));
    }

    #[test]
    fn discoveries_are_unheard_and_still_fit_the_seed() {
        let snapshot = library();
        let listener = listener(&[(0, 2.0), (3, 1.0), (6, 1.0)]);
        let taste = taste(&snapshot, &listener);
        let batch = next(&snapshot, &listener, &taste, &request(Some(0), &[], 8, Focus::Balanced));
        let discoveries: Vec<_> = batch.picks.iter().filter(|pick| pick.explore).collect();
        assert!(!discoveries.is_empty());
        assert!(discoveries.iter().all(|pick| !listener.tracks.contains_key(&snapshot.meta(pick.row).track_id)));
        assert!(discoveries.iter().all(|pick| cluster(&snapshot, pick.row) == 0));
    }

    #[test]
    fn current_session_changes_the_ranking_of_a_listener_with_two_tastes() {
        use crate::session::{Action, Event};
        let snapshot = library();
        let listener = listener(&[(0, 1.0), (3, 1.0), (2, 1.0), (5, 1.0)]);
        let taste = taste(&snapshot, &listener);
        let feedback = |id, action, at| Event {
            track: Uuid::from_u128(id),
            action,
            at,
            listened: 10,
            duration: 200,
            chosen: false,
        };
        let session = Session::build(
            &snapshot,
            &[feedback(0, Action::Skipped, 995), feedback(3, Action::Skipped, 996), feedback(2, Action::Liked, 999)],
            listener.now,
        );
        let mut request = request(None, &[], 6, Focus::Balanced);
        request.session = Some(&session);
        let batch = next(&snapshot, &listener, &taste, &request);
        let close = batch.picks.iter().filter(|pick| cluster(&snapshot, pick.row) == 2).count();
        assert!(close >= 4, "{batch:?}");
    }

    #[test]
    fn recent_favourites_are_penalized_but_can_return_and_rules_still_win() {
        let snapshot =
            Snapshot::new(2, (0..4u128).map(|id| (meta(id, id + 20, &format!("t{id}")), vec![1.0, 0.0])).collect());
        let mut listener = listener(&[(0, 2.0), (3, 2.0)]);
        if let Some(signal) = listener.tracks.get_mut(&Uuid::from_u128(3)) {
            signal.last_played = Some(listener.now - 86_400);
        }
        assert!(recency(&listener, Uuid::from_u128(3)) > 0.0);
        let taste = taste(&snapshot, &listener);
        let batch = next(&snapshot, &listener, &taste, &request(Some(0), &[], 20, Focus::Balanced));
        assert!(batch.picks.iter().any(|pick| snapshot.meta(pick.row).track_id == Uuid::from_u128(3)));
        listener.rules = Rules::new((0..12).map(Uuid::from_u128), []);
        let batch = next(&snapshot, &listener, &taste, &request(None, &[], 6, Focus::Balanced));
        assert!(batch.picks.is_empty());
    }

    #[test]
    fn a_successful_session_opens_more_discoveries_and_a_skip_streak_returns_to_familiar_music() {
        use crate::session::{Action, Event};
        let rows = (1..=30u128).map(|id| (meta(id, id, &format!("t{id}")), vec![1.0, 0.0])).collect();
        let snapshot = Snapshot::new(2, rows);
        let mut listener = listener(&(1..=15).map(|id| (id, 1.0)).collect::<Vec<_>>());
        for signal in listener.tracks.values_mut() {
            signal.last_played = Some(listener.now - 86_400);
        }
        let taste = taste(&snapshot, &listener);
        let event = |id, action| Event {
            track: Uuid::from_u128(id),
            action,
            at: 999,
            listened: 10,
            duration: 200,
            chosen: false,
        };
        let successful = Session::build(
            &snapshot,
            &[event(1, Action::Started), event(1, Action::Liked), event(2, Action::Liked), event(3, Action::Liked)],
            listener.now,
        );
        let misses = Session::build(
            &snapshot,
            &[
                event(1, Action::Started),
                event(1, Action::Skipped),
                event(2, Action::Skipped),
                event(3, Action::Skipped),
            ],
            listener.now,
        );
        let discoveries = |session| {
            let mut request = request(Some(1), &[], 6, Focus::Balanced);
            request.session = session;
            let batch = next(&snapshot, &listener, &taste, &request);
            assert!(
                batch
                    .picks
                    .iter()
                    .all(|pick| pick.explore == !listener.tracks.contains_key(&snapshot.meta(pick.row).track_id))
            );
            batch.picks.iter().filter(|pick| !listener.tracks.contains_key(&snapshot.meta(pick.row).track_id)).count()
        };
        assert_eq!(discoveries(None), 1);
        assert_eq!(discoveries(Some(&successful)), 2);
        assert_eq!(discoveries(Some(&misses)), 0);
    }
}
