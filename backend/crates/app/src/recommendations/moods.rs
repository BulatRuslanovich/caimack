// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use uuid::Uuid;

use super::Recommendations;
use crate::AppResult;

const PER_MOOD: usize = 3;

const CANDIDATES: usize = 60;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoodDto {
    pub key: String,
    pub album_ids: Vec<Uuid>,
}

impl Recommendations {
    pub async fn moods(&self) -> AppResult<Vec<MoodDto>> {
        let library = self.index.library();
        let ranked: Vec<(String, Vec<Uuid>)> = self
            .compute
            .run(move || {
                let snapshot = &library.snapshot;
                library
                    .moods
                    .playable()
                    .map(|(key, scores)| {
                        let tracks =
                            scores.top_members().into_iter().take(CANDIDATES).map(|row| snapshot.meta(row).track_id);
                        (key.to_owned(), tracks.collect())
                    })
                    .collect()
            })
            .await?;
        if ranked.is_empty() {
            return Ok(vec![]);
        }

        let ids: Vec<Uuid> =
            ranked.iter().flat_map(|(_, ids)| ids.iter().copied()).collect::<HashSet<_>>().into_iter().collect();
        let albums: HashMap<Uuid, Uuid> = sqlx::query!(
            r#"SELECT t.id, t.album_id AS "album_id!" FROM tracks t JOIN albums a ON a.id = t.album_id
               WHERE t.id = ANY($1) AND a.cover_path IS NOT NULL"#,
            &ids
        )
        .fetch_all(&self.db)
        .await?
        .into_iter()
        .map(|row| (row.id, row.album_id))
        .collect();

        Ok(ranked
            .into_iter()
            .map(|(key, tracks)| {
                let mut seen = HashSet::new();
                let album_ids = tracks
                    .iter()
                    .filter_map(|track| albums.get(track).copied())
                    .filter(|album| seen.insert(*album))
                    .take(PER_MOOD)
                    .collect();
                MoodDto { key, album_ids }
            })
            .collect())
    }
}
