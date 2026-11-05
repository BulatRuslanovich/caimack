// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

mod auth;
mod client;
mod csrf;
mod extract;
mod files;
mod healthcheck;
mod lifecycle;
mod logging;
mod problem;
mod routes;
mod state;

use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::Context;
use app::auth::AuthService;
use app::auth::sessions::LiveSessions;
use app::auth::tokens::TokenService;
use app::catalog::overview::StatsCache;
use app::config::{Config, DatabaseConfig, ModelConfig};
use app::integrations::deezer::Deezer;
use app::integrations::enrichment::{self, Enrichment, EnrichmentQueue};
use app::integrations::lrclib::Lrclib;
use app::integrations::yandex::YandexMusic;
use app::integrations::yandex::client::YandexClient;
use app::integrations::yandex::importer::{self, Importer};
use app::integrations::yandex::imports::ImportQueue;
use app::library_scan::LibraryScanner;
use app::recommendations::Recommendations;
use app::storage::Storage;
use app::streaming::HashCache;
use app::transcode::TranscodeQueue;
use app::upload::Uploads;
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

use crate::state::AppState;

fn main() -> anyhow::Result<()> {
    let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build()?;
    let result = runtime.block_on(run());
    // An already-running blocking decoder cannot be aborted by dropping its future.
    runtime.shutdown_timeout(std::time::Duration::from_secs(1));
    result
}

async fn run() -> anyhow::Result<()> {
    match std::env::args().nth(1).as_deref() {
        Some("healthcheck") => std::process::exit(if healthcheck::healthy() { 0 } else { 1 }),
        Some("migrate") => return migrate().await,
        Some("serve") | None => {}
        Some(other) => anyhow::bail!("Unknown command '{other}'. Commands: serve, migrate, healthcheck."),
    }

    let _ = dotenvy::dotenv();
    logging::init();

    let config = Arc::new(Config::from_env()?);
    let db = app::db::connect(&config.database).await?;
    app::schema::verify(&db).await?;
    app::owner::ensure_owner(&db, &config.owner).await?;

    let tokens = Arc::new(TokenService::new(&config.jwt));
    let auth = AuthService::new(db.clone(), tokens, LiveSessions::default());
    let storage = Storage::open(&config.storage_root)?;
    if !media::ffmpeg::is_present().await {
        anyhow::bail!("ffmpeg is required but could not be started. Install it on PATH.");
    }

    let background = CancellationToken::new();
    let (transcodes, receivers) = TranscodeQueue::new();
    let mut workers =
        app::transcode::spawn(db.clone(), storage.clone(), transcodes.clone(), receivers, background.clone());

    let recommendations = Recommendations::new(db.clone());
    workers.push(app::recommendations::index::spawn(db.clone(), recommendations.index.clone(), background.clone()));
    workers.push(app::recommendations::sound::spawn(db.clone(), recommendations.index.clone(), background.clone()));
    workers.push(app::recommendations::maintenance::spawn(
        db.clone(),
        recommendations.index.clone(),
        background.clone(),
    ));
    workers.push(app::analysis::spawn(
        db.clone(),
        storage.clone(),
        app::mert::MertClient::new(&ModelConfig::from_env()?)?,
        recommendations.index.clone(),
        background.clone(),
    ));

    let (enrichment_queue, enrichment_requests) = EnrichmentQueue::new();
    let enricher = Enrichment {
        db: db.clone(),
        storage: storage.clone(),
        deezer: Deezer::new(&config.deezer_base_url),
        lrclib: Lrclib::new(&config.lrclib_base_url),
    };
    workers.extend(enrichment::spawn(enricher, enrichment_queue.clone(), enrichment_requests, background.clone()));

    let hashes = HashCache::default();
    let uploads = Uploads {
        db: db.clone(),
        storage: storage.clone(),
        transcodes: transcodes.clone(),
        hashes: hashes.clone(),
        enrichment: enrichment_queue,
    };
    let library = LibraryScanner::new(db.clone(), storage.clone(), uploads.clone());
    workers.push(library.clone().spawn(config.library_scan_interval, background.clone()));

    let yandex_client = YandexClient::new(config.yandex_music.clone());
    let (imports, import_jobs) = ImportQueue::new();
    let importer = Importer { yandex: yandex_client.clone(), uploads: uploads.clone() };
    workers.push(importer::spawn(importer, import_jobs, background.clone()));
    let yandex = YandexMusic { db: db.clone(), client: yandex_client, queue: imports };
    let state = AppState {
        shutdown: background.clone(),
        config: Arc::clone(&config),
        db,
        auth,
        storage,
        stats: StatsCache::default(),
        transcodes,
        hashes,
        uploads,
        library,
        playback: Default::default(),
        yandex,
        recommendations,
    };

    let listener = TcpListener::bind(config.listen_addr)
        .await
        .with_context(|| format!("Could not listen on {}", config.listen_addr))?;
    tracing::info!("Listening on http://{}", config.listen_addr);

    let server = axum::serve(listener, routes::router(state).into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(background.clone().cancelled_owned());
    lifecycle::serve(std::future::IntoFuture::into_future(server), workers, background, shutdown_signal()).await?;
    tracing::info!("Stopped");
    Ok(())
}

async fn migrate() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();
    logging::init();

    let db = app::db::connect(&DatabaseConfig::from_env()?).await?;
    app::schema::migrate(&db).await
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::error!("Could not listen for Ctrl+C: {error}");
            std::future::pending::<()>().await;
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => {
                tracing::error!("Could not listen for SIGTERM: {error}");
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {}
        () = terminate => {}
    }

    tracing::info!("Shutting down");
}
