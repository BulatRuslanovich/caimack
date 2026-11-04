// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::HashMap;

use serde::Deserialize;
use serde::de::{Deserializer, MapAccess, Visitor};

use crate::snapshot::Snapshot;
use crate::vector;

const MOODS_JSON: &str = include_str!("moods.json");

const MEMBER_MARGIN: f32 = 0.02;
const MEMBER_DEVIATION: f32 = 0.5;

pub const MINIMUM_MEMBERS: usize = 12;

#[derive(Debug, Clone)]
pub struct Mood {
    pub key: String,
    pub vector: Vec<f32>,
}

#[derive(Debug, Clone, Default)]
pub struct MoodScores {
    pub ranks: Vec<f32>,
    pub members: Vec<bool>,
}

impl MoodScores {
    pub fn member_count(&self) -> usize {
        self.members.iter().filter(|&&member| member).count()
    }

    pub fn playable(&self) -> bool {
        self.member_count() >= MINIMUM_MEMBERS
    }

    pub fn top_members(&self) -> Vec<usize> {
        let mut rows: Vec<usize> = (0..self.members.len()).filter(|&row| self.members[row]).collect();
        rows.sort_by(|&a, &b| self.ranks[b].total_cmp(&self.ranks[a]).then(a.cmp(&b)));
        rows
    }

    fn score(raw: &[f32]) -> Self {
        let deviations = standardize(raw);
        let members = raw.iter().zip(&deviations).map(|(&r, &d)| r > MEMBER_MARGIN && d >= MEMBER_DEVIATION).collect();
        Self { ranks: vector::percentile_ranks(raw), members }
    }
}

#[derive(Debug, Clone, Default)]
pub struct MoodCatalog {
    pub moods: Vec<Mood>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoodFile {
    model_id: String,
    #[serde(deserialize_with = "in_file_order")]
    moods: Vec<(String, Vec<f32>)>,
}

fn in_file_order<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<(String, Vec<f32>)>, D::Error> {
    struct Ordered;

    impl<'de> Visitor<'de> for Ordered {
        type Value = Vec<(String, Vec<f32>)>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("a map of mood vectors")
        }

        fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
            let mut moods = Vec::new();
            while let Some(entry) = map.next_entry()? {
                moods.push(entry);
            }
            Ok(moods)
        }
    }

    deserializer.deserialize_map(Ordered)
}

impl MoodCatalog {
    pub fn load(audio_model_id: &str) -> Result<Self, String> {
        let file: MoodFile = serde_json::from_str(MOODS_JSON).map_err(|error| error.to_string())?;
        if file.model_id != audio_model_id {
            return Err(format!("mood vectors were computed for {}, audio uses {audio_model_id}", file.model_id));
        }
        let moods = file
            .moods
            .into_iter()
            .map(|(key, mut vector)| {
                vector::normalize(&mut vector);
                Mood { key, vector }
            })
            .collect();
        Ok(Self { moods })
    }

    pub fn find(&self, key: &str) -> Option<&Mood> {
        self.moods.iter().find(|mood| mood.key.eq_ignore_ascii_case(key))
    }

    pub fn score(&self, snapshot: &Snapshot) -> LibraryMoods {
        let scores = self
            .moods
            .iter()
            .map(|mood| {
                let scores = if snapshot.is_empty() || mood.vector.len() != snapshot.dimension() {
                    MoodScores { ranks: vec![0.0; snapshot.len()], members: vec![false; snapshot.len()] }
                } else {
                    MoodScores::score(&snapshot.similarities(&mood.vector))
                };
                (mood.key.clone(), scores)
            })
            .collect();
        LibraryMoods { scores }
    }
}

#[derive(Debug, Default)]
pub struct LibraryMoods {
    pub scores: Vec<(String, MoodScores)>,
}

impl LibraryMoods {
    pub fn get(&self, key: &str) -> Option<&MoodScores> {
        self.scores.iter().find(|(mood, _)| mood.eq_ignore_ascii_case(key)).map(|(_, scores)| scores)
    }

    pub fn playable(&self) -> impl Iterator<Item = (&str, &MoodScores)> {
        self.scores.iter().filter(|(_, scores)| scores.playable()).map(|(key, scores)| (key.as_str(), scores))
    }

    pub fn dominant(&self, row: usize) -> Option<usize> {
        (0..self.scores.len())
            .max_by(|&a, &b| self.scores[a].1.ranks[row].total_cmp(&self.scores[b].1.ranks[row]).then(b.cmp(&a)))
    }

    pub fn ranks(&self) -> HashMap<&str, &[f32]> {
        self.scores.iter().map(|(key, scores)| (key.as_str(), scores.ranks.as_slice())).collect()
    }
}

fn standardize(values: &[f32]) -> Vec<f32> {
    #[expect(clippy::cast_precision_loss, reason = "library sizes are far below 2^24")]
    let count = values.len().max(1) as f32;
    let mean = values.iter().sum::<f32>() / count;
    let mut centred: Vec<f32> = values.iter().map(|value| value - mean).collect();
    let deviation = vector::norm(&centred) / count.sqrt();
    if deviation < 1e-9 {
        centred.iter_mut().for_each(|value| *value = 0.0);
    } else {
        centred.iter_mut().for_each(|value| *value /= deviation);
    }
    centred
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_catalog_matches_the_clap_model() -> Result<(), String> {
        let catalog = MoodCatalog::load("laion/larger_clap_music_and_speech")?;
        let keys: Vec<&str> = catalog.moods.iter().map(|mood| mood.key.as_str()).collect();
        assert_eq!(keys, ["workout", "party", "chill", "sleep", "happy", "sad"]);
        assert!(catalog.moods.iter().all(|mood| (vector::norm(&mood.vector) - 1.0).abs() < 1e-4));
        assert!(MoodCatalog::load("other/model").is_err());
        Ok(())
    }

    #[test]
    fn members_stand_out_and_lean_to_their_side() {
        let mut raw = vec![-0.05; 20];
        raw[3] = 0.2;
        raw[7] = 0.01;
        let scores = MoodScores::score(&raw);
        assert!(scores.members[3]);
        assert!(!scores.members[7], "too close to the boundary");
        assert_eq!(scores.member_count(), 1);
        assert!(!scores.playable());
    }
}
