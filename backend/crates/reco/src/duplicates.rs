// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::{HashMap, HashSet};

use uuid::Uuid;

pub const MAX_BIT_ERROR: f32 = 0.2;

const MAX_SHIFT: usize = 32;
const MIN_OVERLAP: usize = 64;

const DURATION_TOLERANCE_SECONDS: f64 = 3.0;
const DURATION_TOLERANCE_SHARE: f64 = 0.03;

const SAMPLE_SHIFT: u32 = 29;
const MAX_SHARED_RUN: usize = 64;
const MIN_SHARED_SAMPLES: u16 = 2;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Recording {
    pub track_id: Uuid,
    pub duration_seconds: i32,
    pub song_key: String,
    pub fingerprint: Option<Vec<u32>>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Match {
    pub first: Uuid,
    pub second: Uuid,
    pub similarity: Option<f32>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DuplicateGroup {
    pub tracks: Vec<Uuid>,
    pub similarity: Option<f32>,
}

pub fn matches(recordings: &[Recording]) -> Vec<Match> {
    let mut candidates = shared_samples(recordings);
    candidates.extend(same_tags(recordings));

    let mut found: Vec<Match> = candidates
        .into_iter()
        .filter_map(|(a, b)| {
            let (first, second) = (&recordings[a], &recordings[b]);
            let similarity = match (&first.fingerprint, &second.fingerprint) {
                (Some(x), Some(y)) => Some(1.0 - bit_error(x, y).filter(|error| *error <= MAX_BIT_ERROR)?),
                _ if !first.song_key.is_empty() && first.song_key == second.song_key => None,
                _ => return None,
            };
            Some(Match { first: first.track_id, second: second.track_id, similarity })
        })
        .collect();
    found.sort_by_key(|found| (found.first, found.second));
    found
}

pub fn group(matches: &[Match], dismissed: &HashSet<(Uuid, Uuid)>) -> Vec<DuplicateGroup> {
    let mut parent: HashMap<Uuid, Uuid> = HashMap::new();
    let mut weakest: HashMap<Uuid, Option<f32>> = HashMap::new();

    fn root(parent: &mut HashMap<Uuid, Uuid>, mut track: Uuid) -> Uuid {
        while let Some(&up) = parent.get(&track) {
            if up == track {
                break;
            }
            let grand = parent.get(&up).copied().unwrap_or(up);
            parent.insert(track, grand);
            track = grand;
        }
        track
    }

    for found in matches {
        let (a, b) = (found.first, found.second);
        if dismissed.contains(&(a, b)) || dismissed.contains(&(b, a)) {
            continue;
        }
        parent.entry(a).or_insert(a);
        parent.entry(b).or_insert(b);
        let (root_a, root_b) = (root(&mut parent, a), root(&mut parent, b));
        let mut floor = found.similarity;
        for top in [root_a, root_b] {
            if let Some(existing) = weakest.get(&top) {
                floor = weaker(floor, *existing);
            }
        }
        parent.insert(root_b, root_a);
        weakest.insert(root_a, floor);
    }

    let mut groups: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    let members: Vec<Uuid> = parent.keys().copied().collect();
    for track in members {
        let top = root(&mut parent, track);
        groups.entry(top).or_default().push(track);
    }

    let mut result: Vec<DuplicateGroup> = groups
        .into_iter()
        .filter(|(_, tracks)| tracks.len() > 1)
        .map(|(top, mut tracks)| {
            tracks.sort_unstable();
            DuplicateGroup { tracks, similarity: weakest.get(&top).copied().flatten() }
        })
        .collect();
    result.sort_by(|a, b| {
        b.similarity.unwrap_or(-1.0).total_cmp(&a.similarity.unwrap_or(-1.0)).then(a.tracks.cmp(&b.tracks))
    });
    result
}

fn weaker(a: Option<f32>, b: Option<f32>) -> Option<f32> {
    Some(a?.min(b?))
}

pub fn bit_error(a: &[u32], b: &[u32]) -> Option<f32> {
    let mut best: Option<f32> = None;
    for shift in -(MAX_SHIFT as isize)..=MAX_SHIFT as isize {
        let (x, y) = if shift >= 0 {
            (a, b.get(shift.unsigned_abs()..).unwrap_or_default())
        } else {
            (a.get(shift.unsigned_abs()..).unwrap_or_default(), b)
        };
        let overlap = x.len().min(y.len());
        if overlap < MIN_OVERLAP {
            continue;
        }
        let differing: u32 = x[..overlap].iter().zip(&y[..overlap]).map(|(p, q)| (p ^ q).count_ones()).sum();
        let error = differing as f32 / (32 * overlap) as f32;
        best = Some(best.map_or(error, |current| current.min(error)));
    }
    best
}

fn close_in_length(a: &Recording, b: &Recording) -> bool {
    let shorter = f64::from(a.duration_seconds.min(b.duration_seconds));
    f64::from((a.duration_seconds - b.duration_seconds).abs())
        <= DURATION_TOLERANCE_SECONDS.max(shorter * DURATION_TOLERANCE_SHARE)
}

fn shared_samples(recordings: &[Recording]) -> HashSet<(usize, usize)> {
    let mut entries: Vec<(u32, usize)> = Vec::new();
    for (index, recording) in recordings.iter().enumerate() {
        let Some(fingerprint) = &recording.fingerprint else { continue };
        let mut sampled: Vec<u32> =
            fingerprint.iter().copied().filter(|item| item.wrapping_mul(0x9E37_79B1) >> SAMPLE_SHIFT == 0).collect();
        sampled.sort_unstable();
        sampled.dedup();
        entries.extend(sampled.into_iter().map(|item| (item, index)));
    }
    entries.sort_unstable();

    let mut shared: HashMap<(usize, usize), u16> = HashMap::new();
    for run in entries.chunk_by(|x, y| x.0 == y.0) {
        if run.len() < 2 || run.len() > MAX_SHARED_RUN {
            continue;
        }
        for (i, &(_, a)) in run.iter().enumerate() {
            for &(_, b) in &run[i + 1..] {
                if close_in_length(&recordings[a], &recordings[b]) {
                    *shared.entry((a.min(b), a.max(b))).or_default() += 1;
                }
            }
        }
    }
    shared.into_iter().filter(|(_, count)| *count >= MIN_SHARED_SAMPLES).map(|(pair, _)| pair).collect()
}

fn same_tags(recordings: &[Recording]) -> HashSet<(usize, usize)> {
    let mut by_song: HashMap<&str, Vec<usize>> = HashMap::new();
    for (index, recording) in recordings.iter().enumerate() {
        if !recording.song_key.is_empty() {
            by_song.entry(&recording.song_key).or_default().push(index);
        }
    }
    let mut pairs = HashSet::new();
    for indices in by_song.values() {
        for (i, &a) in indices.iter().enumerate() {
            for &b in &indices[i + 1..] {
                if close_in_length(&recordings[a], &recordings[b]) {
                    pairs.insert((a.min(b), a.max(b)));
                }
            }
        }
    }
    pairs
}

#[cfg(test)]
mod tests {
    use super::*;

    fn noise(seed: u32, length: usize) -> Vec<u32> {
        let mut state = seed.max(1);
        (0..length)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                state
            })
            .collect()
    }

    fn flip_bits(fingerprint: &[u32], every: usize) -> Vec<u32> {
        fingerprint.iter().enumerate().map(|(i, item)| if i % every == 0 { item ^ 0b1011 } else { *item }).collect()
    }

    fn recording(id: u128, seconds: i32, song: &str, fingerprint: Option<Vec<u32>>) -> Recording {
        Recording { track_id: Uuid::from_u128(id), duration_seconds: seconds, song_key: song.to_owned(), fingerprint }
    }

    fn ids(group: &DuplicateGroup) -> Vec<u128> {
        group.tracks.iter().map(|id| id.as_u128()).collect()
    }

    #[test]
    fn a_re_encoded_and_a_trimmed_copy_join_one_group() {
        let original = noise(7, 950);
        let reencoded = flip_bits(&original, 3);
        let trimmed = original[16..].to_vec();
        let recordings = vec![
            recording(1, 200, "a|song", Some(original)),
            recording(2, 201, "", Some(reencoded)),
            recording(3, 198, "b|other name", Some(trimmed)),
            recording(4, 200, "c|unrelated", Some(noise(99, 950))),
        ];

        let groups = group(&matches(&recordings), &HashSet::new());

        assert_eq!(groups.len(), 1);
        assert_eq!(ids(&groups[0]), [1, 2, 3]);
        assert!(groups[0].similarity.is_some_and(|s| s > 0.95));
    }

    #[test]
    fn the_same_tags_with_a_different_sound_are_not_duplicates() {
        let recordings =
            vec![recording(1, 200, "a|song", Some(noise(1, 950))), recording(2, 200, "a|song", Some(noise(2, 950)))];
        assert!(matches(&recordings).is_empty());
    }

    #[test]
    fn without_a_fingerprint_the_tags_decide() {
        let recordings = vec![
            recording(1, 200, "a|song", Some(noise(1, 950))),
            recording(2, 202, "a|song", None),
            recording(3, 260, "a|song", None),
        ];
        let groups = group(&matches(&recordings), &HashSet::new());

        assert_eq!(groups.len(), 1);
        assert_eq!(ids(&groups[0]), [1, 2]);
        assert_eq!(groups[0].similarity, None);
    }

    #[test]
    fn lengths_too_far_apart_are_never_compared() {
        let fingerprint = noise(5, 950);
        let recordings =
            vec![recording(1, 200, "", Some(fingerprint.clone())), recording(2, 260, "", Some(fingerprint))];
        assert!(matches(&recordings).is_empty());
    }

    #[test]
    fn dismissed_pairs_stay_apart() {
        let fingerprint = noise(5, 950);
        let recordings =
            vec![recording(1, 200, "", Some(fingerprint.clone())), recording(2, 200, "", Some(fingerprint))];
        let found = matches(&recordings);
        assert_eq!(group(&found, &HashSet::new()).len(), 1);

        let dismissed = HashSet::from([(Uuid::from_u128(2), Uuid::from_u128(1))]);
        assert!(group(&found, &dismissed).is_empty());
    }

    #[test]
    fn a_group_reports_its_weakest_link() {
        let base = noise(3, 950);
        let found = vec![
            Match { first: Uuid::from_u128(1), second: Uuid::from_u128(2), similarity: Some(0.99) },
            Match { first: Uuid::from_u128(2), second: Uuid::from_u128(3), similarity: Some(0.9) },
        ];
        assert_eq!(group(&found, &HashSet::new())[0].similarity, Some(0.9));
        assert!(bit_error(&base, &base).is_some_and(|error| error == 0.0));
    }

    #[test]
    fn too_short_to_compare_has_no_bit_error() {
        assert_eq!(bit_error(&noise(1, 40), &noise(1, 40)), None);
    }
}
