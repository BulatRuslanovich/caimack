// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::HashSet;
use std::sync::Arc;

use reco::Listener;
use reco::shelves;
use reco::taste;
use serde::Serialize;
use uuid::Uuid;

use super::MINIMUM_HERO;
use crate::AppResult;
use crate::catalog::dto::TrackDto;
use crate::catalog::tracks;
use crate::library::history::THRESHOLD_SECONDS;
use crate::recommendations::Recommendations;

const MIX_SIZE: i64 = 20;
const DAILY_MIX_SIZE: usize = 60;
const FALLBACK_WEIGHT: f64 = 0.15;
const TOP_WINDOW_DAYS: i32 = 7;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum MixKind {
    Daily,
    New,
    Top,
}

impl MixKind {
    pub fn parse(value: &str) -> Option<Self> {
        [Self::Daily, Self::New, Self::Top].into_iter().find(|kind| format!("{kind:?}").eq_ignore_ascii_case(value))
    }
}

#[derive(Debug, Serialize)]
pub struct HomeMixDto {
    pub kind: MixKind,
    pub tracks: Vec<TrackDto>,
}

impl Recommendations {
    pub async fn mix(&self, user: Uuid, kind: MixKind) -> AppResult<HomeMixDto> {
        let tracks = match kind {
            MixKind::New => self.recently_added(user, MIX_SIZE).await?,
            MixKind::Top => self.top_tracks(user, MIX_SIZE).await?,
            MixKind::Daily => {
                let listener = self.listeners.get(&self.db, user).await?;
                self.daily_mix_for(user, &listener).await?
            }
        };
        Ok(HomeMixDto { kind, tracks })
    }

    pub(super) async fn top_tracks(&self, user: Uuid, size: i64) -> AppResult<Vec<TrackDto>> {
        let ids = sqlx::query_scalar!(
            r#"SELECT track_id AS "track_id!" FROM playback_events
               WHERE user_id = $1 AND track_id IS NOT NULL AND type IN (3, 4) AND listened_seconds >= $2
                 AND occurred_at >= now() - make_interval(days => $3)
               GROUP BY track_id
               ORDER BY SUM(listened_seconds::bigint) DESC, count(*) DESC, track_id
               LIMIT $4"#,
            user,
            THRESHOLD_SECONDS,
            TOP_WINDOW_DAYS,
            size
        )
        .fetch_all(&self.db)
        .await?;
        let mut found = tracks::by_ids(&self.db, user, &ids).await?;
        Ok(ids.iter().filter_map(|id| found.remove(id)).collect())
    }

    pub(super) async fn daily_mix_for(&self, user: Uuid, listener: &Arc<Listener>) -> AppResult<Vec<TrackDto>> {
        let day = i32::try_from(listener.day).unwrap_or_default();
        let stored = self.stored_daily_mix(user, day).await?;

        let ids = match stored {
            Some(ids) => ids,
            None => {
                let ids = self.build_daily_mix(user, listener).await?;
                if ids.len() < MINIMUM_HERO {
                    return Ok(vec![]);
                }
                sqlx::query!(
                    "INSERT INTO daily_mixes (user_id, local_date, track_ids) VALUES ($1, DATE '2000-01-01' + $2::int, $3)
                     ON CONFLICT DO NOTHING",
                    user,
                    day,
                    sqlx::types::Json(&ids) as _
                )
                .execute(&self.db)
                .await?;
                sqlx::query!(
                    "DELETE FROM daily_mixes WHERE user_id = $1 AND local_date < DATE '2000-01-01' + $2::int",
                    user,
                    day
                )
                .execute(&self.db)
                .await?;
                self.stored_daily_mix(user, day).await?.unwrap_or(ids)
            }
        };

        let mut found = tracks::by_ids(&self.db, user, &ids).await?;
        Ok(ids.iter().filter_map(|id| found.remove(id)).collect())
    }

    async fn stored_daily_mix(&self, user: Uuid, day: i32) -> AppResult<Option<Vec<Uuid>>> {
        let stored = sqlx::query_scalar!(
            r#"SELECT track_ids AS "track_ids: sqlx::types::Json<Vec<Uuid>>" FROM daily_mixes
               WHERE user_id = $1 AND local_date = DATE '2000-01-01' + $2::int"#,
            user,
            day
        )
        .fetch_optional(&self.db)
        .await?;
        Ok(stored.map(|ids| ids.0))
    }

    async fn build_daily_mix(&self, user: Uuid, listener: &Arc<Listener>) -> AppResult<Vec<Uuid>> {
        let library = self.index.library();
        let computing_listener = Arc::clone(listener);
        let mut pool = self
            .compute
            .run(move || {
                let taste = taste::taste(&library.snapshot, &computing_listener);
                shelves::mix_pool(&library.snapshot, &computing_listener, &taste)
            })
            .await?;
        if pool.len() < DAILY_MIX_SIZE {
            let fallback = sqlx::query_scalar!(
                r#"(SELECT track_id AS "id!" FROM favorites WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2)
                   UNION ALL
                   (SELECT id AS "id!" FROM tracks ORDER BY created_at DESC LIMIT $2)"#,
                user,
                i64::try_from(DAILY_MIX_SIZE).unwrap_or(i64::MAX)
            )
            .fetch_all(&self.db)
            .await?;
            let mut seen: HashSet<Uuid> = pool.iter().map(|(id, _)| *id).collect();
            pool.extend(fallback.into_iter().filter(|id| seen.insert(*id)).map(|id| (id, FALLBACK_WEIGHT)));
        }
        let seed = reco::random::seed(user, "dailyMix", listener.day);
        self.compute.run(move || reco::random::weighted_sample(&pool, DAILY_MIX_SIZE, seed)).await
    }
}
