// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::{HashMap, HashSet};

use uuid::Uuid;

use crate::random::{self, Rng};
use crate::snapshot::Snapshot;
use crate::taste::{self, Listener, Taste};

pub const SHELF_SIZE: usize = 12;
pub const MINIMUM_SHELF: usize = 4;
pub const MIX_POOL_SIZE: usize = 120;

const MAX_PER_ARTIST: usize = 2;
const MAX_PER_ALBUM: usize = 2;

const DIVERSITY: f64 = 0.3;
const FOR_YOU_EXPLORE: f64 = 0.25;
const DISCOVER_EXPLORE: f64 = 0.6;

const OWN_TRACKS_ON_ARTIST_SHELF: usize = 2;

const MIN_ARTIST_SHARE: f64 = 0.25;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reason {
    MatchesYourTaste,
    FreshInLibrary,
    BecauseYouListened(Uuid),
    Discovery,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Pick {
    pub row: usize,
    pub score: f64,

    pub explore: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ShelfItems {
    Tracks(Vec<Pick>),
    Artists(Vec<Uuid>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Shelf {
    pub key: String,
    pub reason: Reason,
    pub items: ShelfItems,
}

impl Shelf {
    pub fn base_key(&self) -> &str {
        self.key.split(':').next().unwrap_or(&self.key)
    }

    pub fn len(&self) -> usize {
        match &self.items {
            ShelfItems::Tracks(tracks) => tracks.len(),
            ShelfItems::Artists(artists) => artists.len(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[derive(Debug, Clone, Copy)]
struct Candidate {
    row: usize,
    score: f64,
    familiar: bool,
}

fn candidates(snapshot: &Snapshot, listener: &Listener, taste: &Taste, key: &str) -> Vec<Candidate> {
    let seed = random::seed(listener.user, key, listener.day);
    (0..snapshot.len())
        .filter_map(|row| {
            let meta = snapshot.meta(row);
            let noise = random::unit(seed, meta.track_id);
            let score = taste::score(snapshot, listener, taste, row, noise)?;
            let familiar = listener.tracks.get(&meta.track_id).is_some_and(|signal| signal.familiar());
            Some(Candidate { row, score, familiar })
        })
        .collect()
}

fn compose(
    snapshot: &Snapshot,
    pool: &[Candidate],
    size: usize,
    explore: f64,
    seed: u64,
    max_familiar: Option<usize>,
) -> Vec<Pick> {
    let mut rng = Rng::new(seed);
    let mut ranked: Vec<Candidate> = pool.to_vec();
    ranked.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.row.cmp(&b.row)));

    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        clippy::cast_precision_loss,
        reason = "a share of a small size"
    )]
    let explore_slots = (size as f64 * explore).round() as usize;
    let mut picks: Vec<Pick> = Vec::with_capacity(size);
    let mut taken: HashSet<usize> = HashSet::new();
    let mut per_artist: HashMap<Uuid, usize> = HashMap::new();
    let mut per_album: HashMap<Uuid, usize> = HashMap::new();
    let mut familiar = 0;

    let fits = |candidate: &Candidate,
                taken: &HashSet<usize>,
                per_artist: &HashMap<Uuid, usize>,
                per_album: &HashMap<Uuid, usize>,
                familiar: usize| {
        let meta = snapshot.meta(candidate.row);
        !taken.contains(&candidate.row)
            && meta.credited_artists().all(|artist| per_artist.get(&artist).copied().unwrap_or(0) < MAX_PER_ARTIST)
            && meta.album_id.is_none_or(|album| per_album.get(&album).copied().unwrap_or(0) < MAX_PER_ALBUM)
            && (!candidate.familiar || max_familiar.is_none_or(|max| familiar < max))
    };

    while picks.len() < size {
        let exploring = picks.len() >= size - explore_slots.min(size) && explore_slots > 0;
        let choice = if exploring {
            let tail: Vec<&Candidate> = ranked[ranked.len() / 3..]
                .iter()
                .filter(|c| !c.familiar && fits(c, &taken, &per_artist, &per_album, familiar))
                .collect();
            if tail.is_empty() { None } else { Some((*tail[rng.below(tail.len())], true)) }
        } else {
            None
        };
        let choice = choice.or_else(|| {
            ranked
                .iter()
                .filter(|c| fits(c, &taken, &per_artist, &per_album, familiar))
                .take(SHELF_SIZE * 4)
                .map(|c| {
                    let overlap =
                        picks.iter().map(|p| f64::from(snapshot.between(p.row, c.row))).fold(0.0_f64, f64::max);
                    (c, c.score - DIVERSITY * overlap * c.score.abs())
                })
                .max_by(|a, b| a.1.total_cmp(&b.1).then(b.0.row.cmp(&a.0.row)))
                .map(|(c, _)| (*c, false))
        });
        let Some((chosen, explored)) = choice else { break };

        let meta = snapshot.meta(chosen.row);
        taken.extend(snapshot.clones(chosen.row));
        for artist in meta.credited_artists() {
            *per_artist.entry(artist).or_default() += 1;
        }
        if let Some(album) = meta.album_id {
            *per_album.entry(album).or_default() += 1;
        }
        familiar += usize::from(chosen.familiar);
        picks.push(Pick { row: chosen.row, score: chosen.score, explore: explored });
    }
    picks
}

pub fn home(snapshot: &Snapshot, listener: &Listener, taste: &Taste) -> Vec<Shelf> {
    if snapshot.is_empty() {
        return vec![];
    }
    let mut shelves = Vec::new();
    let mut used: HashSet<usize> = HashSet::new();
    let seed = |key: &str| random::seed(listener.user, key, listener.day);

    let pick = |pool: &[Candidate], key: &str, explore: f64, max_familiar: Option<usize>, used: &HashSet<usize>| {
        let fresh: Vec<Candidate> = pool.iter().filter(|c| !used.contains(&c.row)).copied().collect();
        let picks = compose(snapshot, &fresh, SHELF_SIZE, explore, seed(key), max_familiar);
        if picks.len() >= MINIMUM_SHELF {
            picks
        } else {
            compose(snapshot, pool, SHELF_SIZE, explore, seed(key), max_familiar)
        }
    };

    let all = candidates(snapshot, listener, taste, "forYou");

    let for_you = pick(&all, "forYou", FOR_YOU_EXPLORE, Some(SHELF_SIZE / 3), &used);
    if for_you.len() >= MINIMUM_SHELF {
        used.extend(for_you.iter().map(|p| p.row));
        let reason = if taste.is_empty() { Reason::FreshInLibrary } else { Reason::MatchesYourTaste };
        shelves.push(Shelf { key: "forYou".into(), reason, items: ShelfItems::Tracks(for_you) });
    }

    for artist in rotated_top_artists(taste, seed("becauseYouListened")) {
        let Some(centre) = snapshot.centre_of(artist) else { continue };
        let similarities = snapshot.similarities(&centre);
        let (own, others): (Vec<Candidate>, Vec<Candidate>) =
            all.iter().partition(|c| snapshot.meta(c.row).is_by(artist));
        let mut pool: Vec<Candidate> = own
            .into_iter()
            .filter(|c| !c.familiar)
            .take(OWN_TRACKS_ON_ARTIST_SHELF)
            .map(|c| Candidate { score: 2.0 + c.score, ..c })
            .collect();
        pool.extend(others.into_iter().map(|c| Candidate { score: f64::from(similarities[c.row]), ..c }));

        let key = format!("becauseYouListened:{artist}");
        let picks = pick(&pool, &key, 0.0, Some(SHELF_SIZE / 3), &used);
        if picks.len() >= MINIMUM_SHELF {
            used.extend(picks.iter().map(|p| p.row));
            shelves.push(Shelf { key, reason: Reason::BecauseYouListened(artist), items: ShelfItems::Tracks(picks) });
            break;
        }
    }

    let unheard: Vec<Candidate> = all.iter().filter(|c| !c.familiar).copied().collect();
    let discover = pick(&unheard, "discover", DISCOVER_EXPLORE, None, &used);
    if discover.len() >= MINIMUM_SHELF {
        shelves.push(Shelf { key: "discover".into(), reason: Reason::Discovery, items: ShelfItems::Tracks(discover) });
    }

    let mut best: HashMap<Uuid, f64> = snapshot.metas().iter().map(|meta| (meta.artist(), f64::MIN)).collect();
    for candidate in &all {
        let entry = best.entry(snapshot.meta(candidate.row).artist()).or_insert(f64::MIN);
        *entry = entry.max(candidate.score);
    }
    let mut artists: Vec<(Uuid, f64)> = best.into_iter().collect();
    artists.sort_by(|a, b| {
        taste.is_established(a.0).cmp(&taste.is_established(b.0)).then(b.1.total_cmp(&a.1)).then(a.0.cmp(&b.0))
    });
    if artists.len() >= MINIMUM_SHELF {
        let items = ShelfItems::Artists(artists.into_iter().take(SHELF_SIZE).map(|(artist, _)| artist).collect());
        shelves.push(Shelf { key: "artistsForYou".into(), reason: Reason::Discovery, items });
    }

    shelves
}

fn rotated_top_artists(taste: &Taste, seed: u64) -> Vec<Uuid> {
    let top = taste.top_artists();
    let Some(&(_, strongest)) = top.first() else { return vec![] };
    let eligible: Vec<Uuid> =
        top.into_iter().filter(|&(_, score)| score >= strongest * MIN_ARTIST_SHARE).map(|(id, _)| id).collect();
    #[expect(clippy::cast_possible_truncation, reason = "the result is below the length")]
    let start = (seed % eligible.len() as u64) as usize;
    eligible[start..].iter().chain(&eligible[..start]).copied().collect()
}

pub fn mix_pool(snapshot: &Snapshot, listener: &Listener, taste: &Taste) -> Vec<(Uuid, f64)> {
    let all = candidates(snapshot, listener, taste, "mixPool");
    compose(snapshot, &all, MIX_POOL_SIZE, FOR_YOU_EXPLORE, random::seed(listener.user, "mixPool", listener.day), None)
        .into_iter()
        .map(|pick| (snapshot.meta(pick.row).track_id, pick.score))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::tests::meta;
    use crate::taste::{TrackSignal, taste};

    fn library() -> Snapshot {
        let mut rng = Rng::new(1);
        let rows = (0..40u32)
            .map(|i| {
                #[expect(clippy::cast_possible_truncation, reason = "test noise")]
                let v: Vec<f32> =
                    (0..8).map(|d| if d == i as usize % 4 { 1.0 } else { rng.next_f64() as f32 * 0.3 }).collect();
                (meta(u128::from(i), u128::from(i % 10), &format!("t{i}")), v)
            })
            .collect();
        Snapshot::new(8, rows)
    }

    fn listener(signals: &[(u128, f64, i32)]) -> Listener {
        Listener {
            user: Uuid::from_u128(77),
            now: 1_000_000,
            day: 11,
            tracks: signals
                .iter()
                .map(|&(id, score, plays)| {
                    (Uuid::from_u128(id), TrackSignal { score, plays, ..TrackSignal::default() })
                })
                .collect(),
            rules: crate::rules::Rules::default(),
        }
    }

    #[test]
    fn shared_credits_do_not_bypass_shelf_artist_limits() {
        let rows = (1..=20u128)
            .map(|id| {
                let mut track = meta(id, id, &format!("t{id}"));
                if id <= 10 {
                    track.artists.extend([Uuid::from_u128(500), Uuid::from_u128(500)]);
                }
                (track, vec![1.0])
            })
            .collect();
        let snapshot = Snapshot::new(1, rows);
        let pool = (0..snapshot.len()).map(|row| Candidate { row, score: 1.0, familiar: false }).collect::<Vec<_>>();
        let picks = compose(&snapshot, &pool, 12, 0.0, 7, None);
        assert_eq!(picks.len(), 12);
        assert_eq!(picks.iter().filter(|p| snapshot.meta(p.row).is_by(Uuid::from_u128(500))).count(), MAX_PER_ARTIST);
    }

    #[test]
    fn a_new_listener_gets_fresh_tracks_and_artists() {
        let snapshot = library();
        let listener = listener(&[]);
        let shelves = home(&snapshot, &listener, &taste(&snapshot, &listener));
        let keys: Vec<&str> = shelves.iter().map(|s| s.key.as_str()).collect();
        assert_eq!(keys, ["forYou", "discover", "artistsForYou"]);
        assert_eq!(shelves[0].reason, Reason::FreshInLibrary);
    }

    #[test]
    fn a_listener_with_history_gets_an_artist_shelf() {
        let snapshot = library();
        let listener = listener(&[(1, 2.0, 1), (11, 1.5, 1), (2, 0.5, 1)]);
        let shelves = home(&snapshot, &listener, &taste(&snapshot, &listener));
        let because = shelves.iter().find(|s| s.base_key() == "becauseYouListened");
        assert!(because.is_some(), "{shelves:?}");
        assert_eq!(shelves[0].reason, Reason::MatchesYourTaste);
    }

    #[test]
    fn shelves_respect_artist_caps_and_are_stable_within_a_day() {
        let snapshot = library();
        let listener = listener(&[(1, 2.0, 1)]);
        let taste = taste(&snapshot, &listener);
        let first = home(&snapshot, &listener, &taste);
        assert_eq!(first, home(&snapshot, &listener, &taste));

        let ShelfItems::Tracks(picks) = &first[0].items else { panic!("tracks expected") };
        let mut per_artist: HashMap<Uuid, usize> = HashMap::new();
        for pick in picks {
            *per_artist.entry(snapshot.meta(pick.row).artist()).or_default() += 1;
        }
        assert!(per_artist.values().all(|&count| count <= MAX_PER_ARTIST));
        assert_eq!(picks.len(), SHELF_SIZE);
    }
}
