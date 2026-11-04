// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::HashSet;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{Recommendations, sound};
use crate::catalog::dto::TrackDto;
use crate::catalog::{edit, tracks};
use crate::storage::Storage;
use crate::{AppError, AppResult, json};

#[serde_with::skip_serializing_none]
#[derive(Debug, Serialize)]
pub struct DuplicateGroupDto {
    pub tracks: Vec<TrackDto>,
    #[serde(serialize_with = "json::optional_number")]
    pub similarity: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateReportDto {
    pub groups: Vec<DuplicateGroupDto>,
    pub compared_tracks: i64,
    pub total_tracks: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DismissDuplicatesRequest {
    pub track_ids: Option<Vec<Uuid>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeDuplicatesRequest {
    pub keep_id: Uuid,
    pub remove_ids: Option<Vec<Uuid>>,
}

impl Recommendations {
    pub async fn duplicates(&self, user: Uuid) -> AppResult<DuplicateReportDto> {
        let (found, changed) = self.index.sound.refresh(&self.db).await?;
        if changed {
            self.index.request_reload();
        }
        let dismissed = sound::dismissed(&self.db).await?;
        let counts = sqlx::query!(
            r#"SELECT (SELECT count(*) FROM tracks) AS "total!",
                      (SELECT count(*) FROM track_fingerprints) AS "compared!""#
        )
        .fetch_one(&self.db)
        .await?;

        let groups = sound::groups(&found, &dismissed);
        let ids: Vec<Uuid> = groups.iter().flat_map(|group| group.tracks.iter().copied()).collect();
        let found = tracks::by_ids(&self.db, user, &ids).await?;

        let groups = groups
            .into_iter()
            .map(|group| DuplicateGroupDto {
                tracks: best_first(group.tracks.iter().filter_map(|id| found.get(id).cloned()).collect()),
                similarity: group.similarity.map(|similarity| (f64::from(similarity) * 1000.0).round() / 1000.0),
            })
            .filter(|group| group.tracks.len() > 1)
            .collect();

        Ok(DuplicateReportDto {
            groups,
            compared_tracks: counts.compared.min(counts.total),
            total_tracks: counts.total,
        })
    }

    pub async fn dismiss_duplicates(&self, track_ids: &[Uuid]) -> AppResult<()> {
        let mut ids: Vec<Uuid> = Vec::with_capacity(track_ids.len());
        for id in track_ids {
            if !ids.contains(id) {
                ids.push(*id);
            }
        }
        if ids.len() < 2 {
            return Err(AppError::validation("Select at least two tracks."));
        }
        sqlx::query!(
            "INSERT INTO duplicate_dismissals (first_track_id, second_track_id, dismissed_at)
             SELECT LEAST(a.id, b.id), GREATEST(a.id, b.id), $2
             FROM tracks a JOIN tracks b ON a.id < b.id
             WHERE a.id = ANY($1) AND b.id = ANY($1)
             ON CONFLICT DO NOTHING",
            &ids,
            Utc::now()
        )
        .execute(&self.db)
        .await?;
        self.index.request_reload();
        Ok(())
    }

    pub async fn merge_duplicates(&self, storage: &Storage, keep: Uuid, remove: &[Uuid]) -> AppResult<()> {
        let remove: Vec<Uuid> =
            remove.iter().copied().filter(|id| *id != keep).collect::<HashSet<_>>().into_iter().collect();
        if remove.is_empty() {
            return Err(AppError::validation("Select the tracks to remove."));
        }
        tracks::require(&self.db, keep).await?;

        let mut tx = self.db.begin().await?;

        sqlx::query!(
            "UPDATE playlist_tracks SET track_id = $1
             WHERE id IN (SELECT DISTINCT ON (playlist_id) id FROM playlist_tracks
                          WHERE track_id = ANY($2)
                            AND playlist_id NOT IN (SELECT playlist_id FROM playlist_tracks WHERE track_id = $1)
                          ORDER BY playlist_id, position)",
            keep,
            &remove
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query!(
            "INSERT INTO favorites (user_id, track_id, created_at)
             SELECT user_id, $1, min(created_at) FROM favorites WHERE track_id = ANY($2) GROUP BY user_id
             ON CONFLICT (user_id, track_id) DO NOTHING",
            keep,
            &remove
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query!("UPDATE listening_history SET track_id = $1 WHERE track_id = ANY($2)", keep, &remove)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;

        edit::delete_tracks(&self.db, storage, &remove).await?;
        self.index.request_reload();
        Ok(())
    }
}

fn best_first(mut tracks: Vec<TrackDto>) -> Vec<TrackDto> {
    const LOSSLESS: [&str; 7] = ["flac", "alac", "wav", "pcm", "aiff", "ape", "wavpack"];
    let lossless =
        |track: &TrackDto| track.codec.as_deref().is_some_and(|c| LOSSLESS.iter().any(|l| l.eq_ignore_ascii_case(c)));
    tracks.sort_by(|a, b| {
        lossless(b)
            .cmp(&lossless(a))
            .then(b.bits_per_sample.unwrap_or(0).cmp(&a.bits_per_sample.unwrap_or(0)))
            .then(b.sample_rate_hz.unwrap_or(0).cmp(&a.sample_rate_hz.unwrap_or(0)))
            .then(b.bitrate_kbps.unwrap_or(0).cmp(&a.bitrate_kbps.unwrap_or(0)))
            .then(a.created_at.cmp(&b.created_at))
    });
    tracks
}
