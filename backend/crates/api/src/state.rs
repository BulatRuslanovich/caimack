// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::sync::Arc;

use app::auth::AuthService;
use app::catalog::overview::StatsCache;
use app::config::Config;
use app::integrations::yandex::YandexMusic;
use app::library_scan::LibraryScanner;
use app::playback::registry::PlaybackRegistry;
use app::recommendations::Recommendations;
use app::storage::Storage;
use app::streaming::HashCache;
use app::transcode::TranscodeQueue;
use app::upload::Uploads;
use sqlx::PgPool;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct AppState {
    pub shutdown: CancellationToken,
    pub config: Arc<Config>,
    pub db: PgPool,
    pub auth: AuthService,
    pub storage: Storage,
    pub stats: StatsCache,
    pub transcodes: TranscodeQueue,
    pub hashes: HashCache,
    pub uploads: Uploads,
    pub library: LibraryScanner,
    pub playback: PlaybackRegistry,
    pub yandex: YandexMusic,
    pub recommendations: Recommendations,
}
