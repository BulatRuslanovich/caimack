// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use moka::sync::Cache;
use reco::rules::Rules;
use reco::{Listener, TrackSignal};
use sqlx::PgPool;
use uuid::Uuid;

use crate::AppResult;
use crate::library::history::THRESHOLD_SECONDS;

pub const EVENT_RETENTION_DAYS: i32 = 180;
const HALF_LIFE_DAYS: f64 = 45.0;

const FAVORITE_SCORE: f64 = 1.5;

pub const BROWSED_SOURCES: [&str; 11] = [
    "album",
    "artist",
    "playlist",
    "favorites",
    "history",
    "tracks",
    "genre",
    "genres",
    "downloads",
    "mix:new",
    "mix:top",
];

pub fn is_recommendation(source: &str) -> bool {
    matches!(
        source,
        "home:forYou"
            | "home:discover"
            | "home:becauseYouListened"
            | "home:artistsForYou"
            | "home:dailyMix"
            | "mix:daily"
    ) || source == "radio"
        || source.starts_with("radio:")
}

#[derive(Clone)]
pub struct Listeners(Arc<Cache<Uuid, Arc<Listener>>>);

impl Default for Listeners {
    fn default() -> Self {
        Self(Arc::new(Cache::builder().max_capacity(1_000).time_to_live(Duration::from_secs(30)).build()))
    }
}

impl Listeners {
    pub async fn get(&self, db: &PgPool, user: Uuid) -> AppResult<Arc<Listener>> {
        if let Some(cached) = self.0.get(&user) {
            return Ok(cached);
        }
        let listener = Arc::new(load(db, user, Utc::now()).await?);
        self.0.insert(user, Arc::clone(&listener));
        Ok(listener)
    }

    pub fn forget(&self, user: Uuid) {
        self.0.invalidate(&user);
    }
}

pub async fn local_day(db: &PgPool, user: Uuid) -> AppResult<i64> {
    let day = sqlx::query_scalar!(
        r#"SELECT ((now() AT TIME ZONE COALESCE((SELECT time_zone FROM user_settings WHERE user_id = $1), 'UTC'))::date
                   - DATE '2000-01-01')::bigint AS "day!""#,
        user
    )
    .fetch_one(db)
    .await?;
    Ok(day)
}

pub async fn load(db: &PgPool, user: Uuid, now: DateTime<Utc>) -> AppResult<Listener> {
    let browsed: Vec<String> = BROWSED_SOURCES.iter().map(|&source| source.to_owned()).collect();
    let rows = sqlx::query!(
        r#"WITH events AS (
               SELECT track_id, type, listened_seconds, occurred_at, source,
                      power(0.5, EXTRACT(EPOCH FROM ($2 - occurred_at))::float8 / 86400.0 / $5::float8) AS decay,
                      type = 4 AND (listened_seconds < $4
                          OR (duration_seconds > 0 AND listened_seconds::float8 / duration_seconds < 0.2)) AS early,
                      type = 4 AND duration_seconds > 0 AND listened_seconds::float8 / duration_seconds >= 0.5 AS mostly,
                      COALESCE(source = ANY($3), false) AS browsed
               FROM playback_events
               WHERE user_id = $1 AND track_id IS NOT NULL AND occurred_at >= $2 - make_interval(days => $6)
           )
           SELECT track_id AS "track_id!",
                  SUM(decay * CASE
                      WHEN type = 3 THEN 1.0
                      WHEN early AND browsed THEN -0.05
                      WHEN early THEN -0.1
                      WHEN mostly THEN 0.3
                      WHEN type = 6 THEN 0.8
                      WHEN type = 7 THEN 1.5
                      WHEN type = 8 THEN -1.5
                      WHEN type = 9 THEN 1.0
                      WHEN type = 10 THEN -0.3
                      WHEN type = 11 THEN 0.3
                      ELSE 0 END)::float8 AS "score!",
                  (COUNT(*) FILTER (WHERE type IN (3, 4) AND listened_seconds >= $4))::int AS "plays!",
                  (COUNT(*) FILTER (WHERE early AND NOT browsed))::int AS "early_skips!",
                  MAX(occurred_at) FILTER (WHERE type IN (1, 3, 4)) AS last_played
           FROM events GROUP BY track_id"#,
        user,
        now,
        &browsed,
        THRESHOLD_SECONDS,
        HALF_LIFE_DAYS,
        EVENT_RETENTION_DAYS
    )
    .fetch_all(db)
    .await?;

    let mut tracks: HashMap<Uuid, TrackSignal> = rows
        .into_iter()
        .map(|row| {
            let signal = TrackSignal {
                score: row.score,
                plays: row.plays,
                early_skips: row.early_skips,
                last_played: row.last_played.map(|at| at.timestamp()),
            };
            (row.track_id, signal)
        })
        .collect();

    let favorites =
        sqlx::query_scalar!("SELECT track_id FROM favorites WHERE user_id = $1", user).fetch_all(db).await?;
    for track in favorites {
        tracks.entry(track).or_default().score += FAVORITE_SCORE;
    }

    let rules = sqlx::query!(
        "SELECT action, target_id FROM taste_rules WHERE user_id = $1 AND (until IS NULL OR until > $2)",
        user,
        now
    )
    .fetch_all(db)
    .await?;
    let (downranked, blocked): (Vec<_>, Vec<_>) =
        rules.into_iter().partition(|rule| rule.action == super::rules::Action::Downrank as i16);
    let rules =
        Rules::new(blocked.into_iter().map(|rule| rule.target_id), downranked.into_iter().map(|rule| rule.target_id));

    Ok(Listener { user, now: now.timestamp(), day: local_day(db, user).await?, tracks, rules })
}
