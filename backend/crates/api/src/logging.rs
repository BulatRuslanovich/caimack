// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::io::IsTerminal;
use std::time::{Duration, Instant};

use axum::extract::{MatchedPath, Request};
use axum::http::HeaderValue;
use axum::middleware::Next;
use axum::response::Response;
use tracing::Instrument;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::filter::ParseError;
use tracing_subscriber::fmt::time::ChronoLocal;
use uuid::Uuid;

use crate::problem::Reason;

#[cfg(test)]
mod tests;

const DEFAULT_FILTER: &str = concat!(
    "info,sqlx=warn,tower_http=warn,hyper=warn,h2=warn,reqwest=warn,rustls=warn,",
    "symphonia=warn,lofty=warn,ort=warn"
);
const SLOW_RESPONSE: Duration = Duration::from_secs(2);

fn build_filter(overrides: &str) -> Result<EnvFilter, ParseError> {
    // Defaults quiet dependencies even with RUST_LOG=info. Explicit module
    // directives come last so an operator can still inspect a decoder or SQLx.
    EnvFilter::builder().with_regex(false).parse(format!("{DEFAULT_FILTER},{overrides}"))
}

pub fn init() {
    let filter = build_filter(&std::env::var("RUST_LOG").unwrap_or_default());
    let invalid_filter = filter.is_err();
    let filter = filter.unwrap_or_else(|_| EnvFilter::new(DEFAULT_FILTER));
    let format = std::env::var("LOG_FORMAT").unwrap_or_else(|_| "text".to_owned());
    let subscriber = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(std::io::stderr)
        .with_timer(ChronoLocal::new("%Y-%m-%dT%H:%M:%S%.3f%:z".to_owned()))
        .with_target(true)
        .with_ansi(false);
    if format == "json" {
        subscriber.json().init();
    } else {
        subscriber.with_ansi(std::env::var_os("NO_COLOR").is_none() && std::io::stderr().is_terminal()).init();
    }
    if invalid_filter {
        tracing::warn!("Invalid RUST_LOG; using the default logging filter");
    }
    if !matches!(format.as_str(), "text" | "json") {
        tracing::warn!("Invalid LOG_FORMAT; expected text or json, using text");
    }
}

pub async fn log_request(request: Request, next: Next) -> Response {
    let started = Instant::now();
    let request_id = Uuid::now_v7().to_string();
    // Route templates exclude invitation tokens and other user-supplied URL data.
    let route = request.extensions().get::<MatchedPath>().map_or("<unmatched>", MatchedPath::as_str);
    let health = route == "/health";
    // Context must survive http=error as well; spans do not emit events on their own.
    let span = tracing::error_span!(target: "http", "request", %request_id,
        method = %request.method(), route, user_id = tracing::field::Empty);

    async move {
        tracing::debug!(target: "http", "HTTP request started");
        let mut response = next.run(request).await;
        let status = response.status().as_u16();
        // This measures preparation of the response headers, not streaming a body.
        let elapsed = started.elapsed();
        let elapsed_ms = elapsed.as_millis() as u64;
        let reason = response.extensions().get::<Reason>().map(|Reason(reason)| reason.as_str()).unwrap_or("");

        match status {
            500.. => tracing::error!(target: "http", status, elapsed_ms, reason, "HTTP request failed"),
            403 | 429 => tracing::warn!(target: "http", status, elapsed_ms, reason, "HTTP request rejected"),
            _ if !health && elapsed >= SLOW_RESPONSE => {
                tracing::warn!(target: "http", status, elapsed_ms, reason, "Slow HTTP response");
            }
            401 | 404 => tracing::debug!(target: "http", status, elapsed_ms, reason, "HTTP request rejected"),
            400..=499 => tracing::info!(target: "http", status, elapsed_ms, reason, "HTTP request rejected"),
            _ => tracing::debug!(target: "http", status, elapsed_ms, "HTTP response prepared"),
        }

        if let Ok(value) = HeaderValue::from_str(&request_id) {
            response.headers_mut().insert("x-request-id", value);
        }
        response
    }
    .instrument(span)
    .await
}
