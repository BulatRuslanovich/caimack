// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::time::Instant;

use axum::extract::Request;
use axum::middleware::Next;
use axum::response::Response;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::fmt::time::ChronoLocal;

use crate::problem::Reason;

const DEFAULT_FILTER: &str = "info,sqlx=warn,tower_http=warn,hyper=warn";

pub fn init() {
    let mut filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(DEFAULT_FILTER));

    for quiet in ["symphonia_core=error", "ort=warn"] {
        if let Ok(quiet) = quiet.parse() {
            filter = filter.add_directive(quiet);
        }
    }

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_timer(ChronoLocal::new("%H:%M:%S".to_owned()))
        .with_ansi(std::env::var_os("NO_COLOR").is_none())
        .with_target(true)
        .init();
}

pub async fn log_request(request: Request, next: Next) -> Response {
    let started = Instant::now();
    let method = request.method().clone();
    let path = request.uri().path().to_owned();

    let response = next.run(request).await;

    let status = response.status().as_u16();
    let elapsed = started.elapsed().as_secs_f64() * 1000.0;
    let reason = response.extensions().get::<Reason>().map(|Reason(reason)| format!(": {reason}")).unwrap_or_default();

    match status {
        500.. => tracing::error!(target: "http", "{method} {path} → {status} ({elapsed:.1} ms){reason}"),
        400..=499 if status != 401 => {
            tracing::info!(target: "http", "{method} {path} → {status} ({elapsed:.1} ms){reason}");
        }
        _ => tracing::debug!(target: "http", "{method} {path} → {status} ({elapsed:.1} ms){reason}"),
    }

    response
}
