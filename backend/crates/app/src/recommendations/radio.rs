// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::sync::Arc;

use reco::radio::{self, Focus, RadioRequest};
use reco::session::Session;
use reco::taste;
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use uuid::Uuid;

use super::impressions::{self, Shown};
use super::{ReasonDto, Recommendations, RecommendedTrackDto, SignalsDto, reasons, session};
use crate::catalog::tracks;
use crate::{AppError, AppResult};

pub const MAX_BATCH: i64 = 20;
const DEFAULT_BATCH: i64 = 6;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadioRequestDto {
    pub session_id: Option<Uuid>,
    pub seed_track_id: Option<Uuid>,
    pub exclude: Option<Vec<Uuid>>,
    pub limit: Option<i64>,
    pub focus: Option<String>,
}

#[skip_serializing_none]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RadioBatchDto {
    pub tracks: Vec<RecommendedTrackDto>,
    pub seed_track_id: Option<Uuid>,
}

impl Recommendations {
    pub async fn radio(&self, user: Uuid, request: RadioRequestDto) -> AppResult<RadioBatchDto> {
        let limit = request.limit.unwrap_or(DEFAULT_BATCH);
        if !(1..=MAX_BATCH).contains(&limit) {
            return Err(AppError::validation("Radio limit must be between 1 and {0}.").arg(MAX_BATCH));
        }
        let focus = match request.focus.as_deref() {
            None | Some("" | "balanced") => Focus::Balanced,
            Some("closer") => Focus::Closer,
            Some("wider") => Focus::Wider,
            Some(other) => return Err(AppError::validation("Unknown radio focus '{0}'.").arg(other)),
        };
        let source = if request.seed_track_id.is_some() { "radio:track" } else { "radio" };

        let library = self.index.library();
        let snapshot = &library.snapshot;
        if snapshot.is_empty() {
            return Ok(RadioBatchDto { tracks: vec![], seed_track_id: None });
        }

        let listener = self.listeners.get(&self.db, user).await?;
        let events = session::load(&self.db, user, request.session_id).await?;

        let queue = request.exclude.unwrap_or_default();
        let computing_library = Arc::clone(&library);
        let batch = self
            .compute
            .run(move || {
                let snapshot = &computing_library.snapshot;
                let taste = taste::taste(snapshot, &listener);
                let session = Session::build(snapshot, &events, chrono::Utc::now().timestamp());
                let request = RadioRequest {
                    seed: request.seed_track_id,
                    queue: &queue,
                    recent: &session.heard[session.heard.len().saturating_sub(3)..],
                    session: Some(&session),
                    limit: usize::try_from(limit).unwrap_or(1),
                    focus,
                };
                radio::next(snapshot, &listener, &taste, &request)
            })
            .await?;

        let shown: Vec<Shown> = batch
            .picks
            .iter()
            .map(|pick| Shown {
                track: snapshot.meta(pick.row).track_id,
                explore: pick.explore,
                score: pick.score,
                features: pick.features,
            })
            .collect();
        if let Err(error) = impressions::record(&self.db, user, source, &shown).await {
            tracing::error!("Recording radio impressions failed: {error}");
        }

        let anchor = batch.anchor.map(|row| snapshot.meta(row).track_id);
        let ids: Vec<Uuid> = batch.picks.iter().map(|pick| snapshot.meta(pick.row).track_id).chain(anchor).collect();
        let found = tracks::by_ids(&self.db, user, &ids).await?;
        let anchor_title = anchor.and_then(|id| found.get(&id)).map(|track| track.title.clone());

        let tracks = batch
            .picks
            .iter()
            .enumerate()
            .filter_map(|(index, pick)| {
                let id = snapshot.meta(pick.row).track_id;
                let reason = if pick.explore {
                    ReasonDto { subject_id: anchor, ..ReasonDto::new(reasons::DISCOVERY) }
                } else if batch.moved && index == 0 {
                    ReasonDto::new(reasons::MATCHES_YOUR_TASTE)
                } else if let Some(title) = &anchor_title {
                    ReasonDto { kind: reasons::SOUNDS_LIKE, subject: Some(title.clone()), subject_id: anchor }
                } else {
                    ReasonDto::new(reasons::MATCHES_YOUR_TASTE)
                };
                Some(RecommendedTrackDto {
                    track: found.get(&id)?.clone(),
                    reason,
                    score: Some(f64::from(pick.score)),
                    signals: Some(SignalsDto { explore: pick.explore }),
                })
            })
            .collect();
        Ok(RadioBatchDto { tracks, seed_track_id: anchor })
    }
}
