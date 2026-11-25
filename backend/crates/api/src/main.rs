// SPDX-License-Identifier: AGPL-3.0-only

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
use app::audiobooks::Audiobooks;
use app::auth::AuthService;
use app::auth::sessions::LiveSessions;
use app::auth::tokens::TokenService;
use app::catalog::overview::StatsCache;
use app::config::{Config, DatabaseConfig, ModelConfig};
use app::integrations::deezer::Deezer;
use app::integrations::enrichment::{self, Enrichment, EnrichmentQueue};
use app::integrations::lrclib::Lrclib;
use app::integrations::yandex::YandexMusic;
use app::library_scan::LibraryScanner;
use app::recommendations::Recommendations;
use app::storage::Storage;
use app::streaming::HashCache;
use app::transcode::TranscodeQueue;
use app::upload::Uploads;
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

use crate::state::AppState;

fn main() -> std::process::ExitCode {
    if std::env::args().nth(1).as_deref() == Some("healthcheck") {
        return if healthcheck::healthy() { std::process::ExitCode::SUCCESS } else { std::process::ExitCode::FAILURE };
    }
    let _ = dotenvy::dotenv();
    logging::init();
    let result = (|| -> anyhow::Result<()> {
        let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build()?;
        let result = runtime.block_on(run());
        // An already-running blocking decoder cannot be aborted by dropping its future.
        runtime.shutdown_timeout(std::time::Duration::from_secs(1));
        result
    })();
    match result {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!(error = %format!("{error:#}"), "Backend command failed");
            std::process::ExitCode::FAILURE
        }
    }
}

async fn run() -> anyhow::Result<()> {
    match std::env::args().nth(1).as_deref() {
        Some("migrate") => return migrate().await,
        Some("serve") | None => {}
        Some(other) => {
            anyhow::bail!("Unknown command '{other}'. Commands: serve, migrate, healthcheck.")
        }
    }

    let started = std::time::Instant::now();
    tracing::info!(version = env!("CARGO_PKG_VERSION"), "Starting Caimack backend");
    let config = Arc::new(Config::from_env().context("Could not load backend configuration")?);
    let db =
        app::db::connect(&config.database).await.context("Backend startup failed while connecting to PostgreSQL")?;
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

    let mut recommendations = Recommendations::new(db.clone());
    recommendations.enabled = config.recommendations_enabled;
    if config.recommendations_enabled {
        workers.push(app::recommendations::index::spawn(db.clone(), recommendations.index.clone(), background.clone()));
    }
    workers.push(app::recommendations::sound::spawn(db.clone(), recommendations.index.clone(), background.clone()));
    workers.push(app::recommendations::maintenance::spawn(
        db.clone(),
        recommendations.index.clone(),
        background.clone(),
    ));
    workers.push(app::analysis::spawn(
        db.clone(),
        storage.clone(),
        if config.recommendations_enabled {
            Some(app::mert::MertClient::new(&ModelConfig::from_env()?)?)
        } else {
            None
        },
        recommendations.index.clone(),
        background.clone(),
    ));

    let (enrichment_queue, enrichment_requests) = EnrichmentQueue::new();
    let enricher = Enrichment {
        db: db.clone(),
        storage: storage.clone(),
        deezer: Deezer::new(&config.deezer_base_url),
        lyrics_providers: app::integrations::lyrics::LyricsProviders::new(
            Lrclib::new(&config.lrclib_base_url),
            config.better_lyrics_api_key.clone(),
        ),
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
    let library = LibraryScanner::new(db.clone(), storage.clone(), uploads.clone())
        .with_file_renaming(config.rename_music_files)
        .with_metadata_export(config.export_music_metadata);
    workers.push(library.clone().spawn(config.library_scan_interval, background.clone()));
    let audiobooks = Audiobooks::default();
    workers.push(audiobooks.spawn(
        db.clone(),
        storage.audiobooks_root(),
        config.library_scan_interval,
        background.clone(),
    ));

    let yandex = {
        let (yandex, worker) =
            YandexMusic::start_worker(config.yandex_music.clone(), uploads.clone(), background.clone());
        workers.push(worker);
        yandex
    };
    let music = app::integrations::music::Music::new(uploads.clone(), config.music_sources.clone(), yandex.clone())?;
    workers.push(music.clone().spawn(background.clone()));
    let state = AppState {
        music,
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
        audiobooks,
        playback: Default::default(),
        yandex,
        recommendations,
    };

    let listener = TcpListener::bind(config.listen_addr)
        .await
        .with_context(|| format!("Could not listen on {}", config.listen_addr))?;
    tracing::info!(
        address = %listener.local_addr()?,
        recommendations = config.recommendations_enabled,
        heavy_job_limit = app::background::capacity(),
        library_scan_interval_secs = config.library_scan_interval.map(|interval| interval.as_secs()),
        rename_music_files = config.rename_music_files,
        export_music_metadata = config.export_music_metadata,
        worker_count = workers.len(),
        elapsed_ms = started.elapsed().as_millis() as u64,
        "Backend ready; accepting HTTP requests"
    );

    let server = axum::serve(listener, routes::router(state).into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(background.clone().cancelled_owned());
    lifecycle::serve(std::future::IntoFuture::into_future(server), workers, background, shutdown_signal()).await?;
    tracing::info!("Backend stopped");
    Ok(())
}

async fn migrate() -> anyhow::Result<()> {
    let started = std::time::Instant::now();
    tracing::info!("Applying database migrations");
    let db = app::db::connect(&DatabaseConfig::from_env()?).await?;
    app::schema::migrate(&db).await?;
    tracing::info!(elapsed_ms = started.elapsed().as_millis() as u64, "Database migrations complete");
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::error!(%error, signal = "Ctrl+C", "Could not install shutdown signal handler");
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
                tracing::error!(%error, signal = "SIGTERM", "Could not install shutdown signal handler");
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => tracing::info!(signal = "Ctrl+C", "Shutdown requested; draining requests and background jobs"),
        () = terminate => tracing::info!(signal = "SIGTERM", "Shutdown requested; draining requests and background jobs"),
    }
}
