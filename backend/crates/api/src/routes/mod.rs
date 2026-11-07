// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

mod account;
mod auth;
mod catalog;
mod connect;
mod integrations;
mod library;
mod media;
mod playback;
mod recommendations;

use std::sync::Arc;

use app::AppError;
use axum::Router;
use axum::http::{StatusCode, header};
use axum::middleware::from_fn_with_state;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use tower_http::catch_panic::CatchPanicLayer;

use crate::problem::ApiError;
use crate::state::AppState;
use crate::{client, csrf, logging, problem};

pub fn router(state: AppState) -> Router {
    let trusted_proxies = Arc::new(state.config.trusted_proxies.clone());

    let protected = Router::new()
        .merge(auth::protected())
        .merge(account::router())
        .merge(catalog::router())
        .merge(integrations::router())
        .merge(library::router())
        .merge(media::router())
        .merge(playback::router())
        .merge(connect::router())
        .merge(recommendations::router(state.config.recommendations_enabled))
        .route_layer(from_fn_with_state(state.clone(), crate::auth::require_user));

    let public = Router::new().route("/health", get(health)).merge(auth::public());

    Router::new()
        .merge(protected)
        .merge(public)
        .fallback(not_found)
        .with_state(state)
        .layer(CatchPanicLayer::custom(|_| internal_error()))
        .layer(axum::middleware::from_fn(csrf::reject_cross_origin))
        .layer(axum::middleware::from_fn(problem::finish))
        .layer(from_fn_with_state(trusted_proxies, client::resolve))
        .layer(axum::middleware::from_fn(logging::log_request))
}

async fn health(axum::extract::State(state): axum::extract::State<AppState>) -> impl IntoResponse {
    let available =
        tokio::time::timeout(std::time::Duration::from_secs(2), sqlx::query("SELECT 1").execute(&state.db)).await;
    let (status, text) = if matches!(available, Ok(Ok(_))) {
        (StatusCode::OK, "Healthy")
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, "Database unavailable")
    };
    (status, [(header::CONTENT_TYPE, "text/plain"), (header::CACHE_CONTROL, "no-store, no-cache")], text)
}

async fn not_found() -> Response {
    problem::bare(StatusCode::NOT_FOUND, "no such route")
}

fn internal_error() -> Response {
    ApiError::from(AppError::Internal(anyhow::anyhow!("handler panicked"))).into_response()
}
