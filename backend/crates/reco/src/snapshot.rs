// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet};

use uuid::Uuid;

use crate::duplicates::DuplicateGroup;
use crate::vector::{self, dot};

#[derive(Debug, Clone, PartialEq)]
pub struct TrackMeta {
    pub track_id: Uuid,

    pub artists: Vec<Uuid>,
    pub album_id: Option<Uuid>,
    pub genre_id: Option<Uuid>,
    pub duration_seconds: i32,
    pub year: Option<i32>,

    pub added_at: i64,

    pub popularity: f32,
    pub content_hash: String,

    pub song_key: String,

    pub tempo_bpm: Option<f32>,
    pub musical_key: Option<u8>,
    pub loudness_lufs: Option<f32>,
}

impl TrackMeta {
    pub fn artist(&self) -> Uuid {
        self.artists.first().copied().unwrap_or_default()
    }

    pub fn is_by(&self, artist: Uuid) -> bool {
        self.artists.contains(&artist)
    }

    pub fn title_key(&self) -> Option<&str> {
        self.song_key.split_once('|').map(|(_, title)| title).filter(|title| !title.is_empty())
    }
}

pub fn song_key(artist: &str, title: &str) -> String {
    let (artist, title) = (artist.trim(), title.trim());
    if artist.is_empty() || title.is_empty() {
        String::new()
    } else {
        format!("{}|{}", artist.to_lowercase(), title.to_lowercase())
    }
}

#[derive(Debug, Default)]
pub struct Snapshot {
    dimension: usize,
    matrix: Vec<f32>,
    meta: Vec<TrackMeta>,
    rows: HashMap<Uuid, usize>,
    by_hash: HashMap<String, Vec<usize>>,
    by_song: HashMap<String, Vec<usize>>,
    by_sound: HashMap<usize, usize>,
    sound_alikes: Vec<Vec<usize>>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Scored {
    pub row: usize,
    pub score: f32,
}

impl Eq for Scored {}

impl Ord for Scored {
    fn cmp(&self, other: &Self) -> Ordering {
        other.score.total_cmp(&self.score).then(self.row.cmp(&other.row))
    }
}

impl PartialOrd for Scored {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Snapshot {
    pub fn new(dimension: usize, rows: Vec<(TrackMeta, Vec<f32>)>) -> Self {
        let mut snapshot = Self { dimension, ..Self::default() };
        if dimension == 0 {
            return snapshot;
        }
        for (meta, mut vector) in rows {
            if vector.len() != dimension || snapshot.rows.contains_key(&meta.track_id) {
                continue;
            }
            vector::normalize(&mut vector);
            let row = snapshot.meta.len();
            snapshot.matrix.extend_from_slice(&vector);
            snapshot.rows.insert(meta.track_id, row);
            if !meta.content_hash.is_empty() {
                snapshot.by_hash.entry(meta.content_hash.clone()).or_default().push(row);
            }
            if !meta.song_key.is_empty() {
                snapshot.by_song.entry(meta.song_key.clone()).or_default().push(row);
            }
            snapshot.meta.push(meta);
        }
        snapshot
    }

    pub fn set_sound_alikes(&mut self, groups: &[DuplicateGroup]) {
        self.by_sound.clear();
        self.sound_alikes.clear();
        for group in groups {
            let rows: Vec<usize> = group.tracks.iter().filter_map(|track| self.row_of(*track)).collect();
            if rows.len() < 2 {
                continue;
            }
            for &row in &rows {
                self.by_sound.insert(row, self.sound_alikes.len());
            }
            self.sound_alikes.push(rows);
        }
    }

    pub fn len(&self) -> usize {
        self.meta.len()
    }

    pub fn is_empty(&self) -> bool {
        self.meta.is_empty()
    }

    pub fn dimension(&self) -> usize {
        self.dimension
    }

    pub fn row_of(&self, track: Uuid) -> Option<usize> {
        self.rows.get(&track).copied()
    }

    pub fn meta(&self, row: usize) -> &TrackMeta {
        &self.meta[row]
    }

    pub fn metas(&self) -> &[TrackMeta] {
        &self.meta
    }

    pub fn vector(&self, row: usize) -> &[f32] {
        &self.matrix[row * self.dimension..(row + 1) * self.dimension]
    }

    pub fn between(&self, a: usize, b: usize) -> f32 {
        dot(self.vector(a), self.vector(b))
    }

    pub fn similarities(&self, query: &[f32]) -> Vec<f32> {
        if query.len() != self.dimension {
            return vec![0.0; self.len()];
        }
        self.matrix.chunks_exact(self.dimension).map(|row| dot(row, query)).collect()
    }

    pub fn top_k(&self, query: &[f32], k: usize, skip: impl Fn(usize) -> bool) -> Vec<Scored> {
        top_k(&self.similarities(query), k, skip)
    }

    pub fn centre_of(&self, artist: Uuid) -> Option<Vec<f32>> {
        let mut centre = vec![0.0; self.dimension];
        let mut found = false;
        for (row, meta) in self.meta.iter().enumerate() {
            if meta.is_by(artist) {
                vector::add_scaled(&mut centre, self.vector(row), 1.0);
                found = true;
            }
        }
        found.then(|| {
            vector::normalize(&mut centre);
            centre
        })
    }

    pub fn clones(&self, row: usize) -> HashSet<usize> {
        let meta = &self.meta[row];
        let mut family = HashSet::from([row]);
        for group in [self.by_hash.get(&meta.content_hash), self.by_song.get(&meta.song_key)].into_iter().flatten() {
            family.extend(group);
        }
        if let Some(group) = self.by_sound.get(&row).and_then(|index| self.sound_alikes.get(*index)) {
            family.extend(group);
        }
        family
    }
}

pub fn top_k(scores: &[f32], k: usize, skip: impl Fn(usize) -> bool) -> Vec<Scored> {
    if k == 0 {
        return vec![];
    }
    let mut heap = BinaryHeap::with_capacity(k + 1);
    for (row, &score) in scores.iter().enumerate() {
        if skip(row) {
            continue;
        }
        heap.push(Scored { row, score });
        if heap.len() > k {
            heap.pop();
        }
    }
    heap.into_sorted_vec()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn meta(id: u128, artist: u128, title: &str) -> TrackMeta {
        TrackMeta {
            track_id: Uuid::from_u128(id),
            artists: vec![Uuid::from_u128(artist)],
            album_id: None,
            genre_id: None,
            duration_seconds: 200,
            year: None,
            added_at: 0,
            popularity: 0.0,
            content_hash: format!("hash{id}"),
            song_key: song_key(&format!("artist{artist}"), title),
            tempo_bpm: None,
            musical_key: None,
            loudness_lufs: None,
        }
    }

    pub fn snapshot(vectors: &[(u128, u128, &str, [f32; 3])]) -> Snapshot {
        Snapshot::new(3, vectors.iter().map(|(id, artist, title, v)| (meta(*id, *artist, title), v.to_vec())).collect())
    }

    #[test]
    fn nearest_come_first_and_skipped_rows_are_left_out() {
        let snapshot =
            snapshot(&[(1, 1, "a", [1.0, 0.0, 0.0]), (2, 1, "b", [0.9, 0.1, 0.0]), (3, 2, "c", [0.0, 1.0, 0.0])]);
        let rows: Vec<usize> = snapshot.top_k(&[1.0, 0.0, 0.0], 2, |_| false).iter().map(|s| s.row).collect();
        assert_eq!(rows, [0, 1]);
        let rows: Vec<usize> = snapshot.top_k(&[1.0, 0.0, 0.0], 2, |row| row == 0).iter().map(|s| s.row).collect();
        assert_eq!(rows, [1, 2]);
    }

    #[test]
    fn clones_share_a_file_or_a_song() {
        let mut copy = meta(4, 1, "a");
        copy.content_hash = "other".into();
        let snapshot =
            Snapshot::new(1, vec![(meta(1, 1, "a"), vec![1.0]), (meta(2, 1, "b"), vec![1.0]), (copy, vec![1.0])]);
        assert_eq!(snapshot.clones(0), HashSet::from([0, 2]));
    }

    #[test]
    fn clones_include_recordings_that_sound_the_same() {
        let mut snapshot = Snapshot::new(
            1,
            vec![(meta(1, 1, "a"), vec![1.0]), (meta(2, 2, "b"), vec![1.0]), (meta(3, 3, "c"), vec![1.0])],
        );
        snapshot.set_sound_alikes(&[DuplicateGroup {
            tracks: vec![Uuid::from_u128(1), Uuid::from_u128(3), Uuid::from_u128(9)],
            similarity: Some(0.99),
        }]);

        assert_eq!(snapshot.clones(0), HashSet::from([0, 2]));
        assert_eq!(snapshot.clones(1), HashSet::from([1]));
    }
}
