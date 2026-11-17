// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::io::{self, Write};
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::routing::get;
use tower::ServiceExt;
use tracing::instrument::WithSubscriber;

use super::*;

#[derive(Clone, Default)]
struct Capture(Arc<Mutex<Vec<u8>>>);

impl Write for Capture {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Capture {
    fn text(&self) -> String {
        String::from_utf8(self.0.lock().unwrap().clone()).unwrap()
    }
}

fn subscriber(output: &Capture, overrides: &str) -> impl tracing::Subscriber + Send + Sync + use<> {
    let writer = output.clone();
    tracing_subscriber::fmt()
        .with_env_filter(build_filter(overrides).unwrap())
        .with_ansi(false)
        .without_time()
        .with_writer(move || writer.clone())
        .finish()
}

#[test]
fn dependencies_are_quiet_but_warnings_and_application_events_remain_visible() {
    let output = Capture::default();
    tracing::subscriber::with_default(subscriber(&output, "info"), || {
        tracing::info!(target: "symphonia_bundle_mp3::demuxer", "bitrate estimate");
        tracing::warn!(target: "symphonia_core::decoder", "damaged frame");
        tracing::info!(target: "app::analysis", "analysis progress");
    });
    let text = output.text();
    assert!(!text.contains("bitrate estimate"));
    assert!(text.contains("damaged frame"));
    assert!(text.contains("analysis progress"));
}

#[test]
fn explicit_dependency_filters_override_defaults() {
    let output = Capture::default();
    tracing::subscriber::with_default(subscriber(&output, "symphonia_bundle_mp3=debug"), || {
        tracing::debug!(target: "symphonia_bundle_mp3::demuxer", "decoder details");
    });
    assert!(output.text().contains("decoder details"));
}

#[test]
fn malformed_filters_are_reported_instead_of_partially_applied() {
    assert!(build_filter("app=verbose").is_err());
}

#[tokio::test]
async fn request_ids_correlate_handler_events_and_responses_without_exposing_tokens() {
    let output = Capture::default();
    let router = Router::new()
        .route(
            "/invitations/{token}",
            get(|| async {
                tracing::info!("Checking invitation");
                crate::problem::bare(StatusCode::INTERNAL_SERVER_ERROR, "database unavailable")
            }),
        )
        .layer(axum::middleware::from_fn(log_request));
    let request = Request::builder()
        .uri("/invitations/secret-invitation?access_token=secret-query")
        .header("authorization", "Bearer secret-auth")
        .header("x-request-id", "untrusted-id")
        .body(Body::empty())
        .unwrap();
    let response = router.oneshot(request).with_subscriber(subscriber(&output, "")).await.unwrap();
    let id = response.headers().get("x-request-id").unwrap().to_str().unwrap();
    assert!(uuid::Uuid::parse_str(id).is_ok());
    let text = output.text();
    assert!(text.contains("/invitations/{token}"));
    assert!(text.contains("status=500"));
    assert!(text.contains("database unavailable"));
    assert!(text.lines().filter(|line| line.contains(id)).count() >= 2);
    for secret in ["secret-invitation", "secret-query", "secret-auth", "untrusted-id"] {
        assert!(!text.contains(secret), "log leaked {secret}");
    }
}

#[tokio::test]
async fn routine_requests_are_quiet_but_failures_and_slow_responses_are_visible() {
    let output = Capture::default();
    let router = Router::new()
        .route("/ok", get(|| async { StatusCode::OK }))
        .route("/expired", get(|| async { StatusCode::UNAUTHORIZED }))
        .route("/missing", get(|| async { StatusCode::NOT_FOUND }))
        .route("/limited", get(|| async { StatusCode::TOO_MANY_REQUESTS }))
        .route(
            "/slow",
            get(|| async {
                tokio::time::sleep(Duration::from_secs(2)).await;
                StatusCode::OK
            }),
        )
        .layer(axum::middleware::from_fn(log_request));
    async {
        for path in ["/ok", "/expired", "/missing", "/limited", "/slow", "/secret-unknown-path"] {
            router.clone().oneshot(Request::builder().uri(path).body(Body::empty()).unwrap()).await.unwrap();
        }
    }
    .with_subscriber(subscriber(&output, ""))
    .await;
    let text = output.text();
    assert_eq!(text.lines().count(), 2, "routine responses should produce no events at INFO");
    assert!(!text.contains("secret-unknown-path"));
    assert!(text.contains("status=429"));
    assert!(text.contains("Slow HTTP response"));
}

#[tokio::test]
async fn error_only_filters_preserve_request_context() {
    let output = Capture::default();
    let router = Router::new()
        .route("/broken", get(|| async { StatusCode::INTERNAL_SERVER_ERROR }))
        .layer(axum::middleware::from_fn(log_request));
    let response = router
        .oneshot(Request::builder().uri("/broken").body(Body::empty()).unwrap())
        .with_subscriber(subscriber(&output, "http=error"))
        .await
        .unwrap();
    let text = output.text();
    assert!(text.contains(response.headers()["x-request-id"].to_str().unwrap()));
    assert!(text.contains("/broken"));
}

#[tokio::test]
async fn json_events_include_error_chains_and_searchable_request_fields() {
    use axum::response::IntoResponse;

    let output = Capture::default();
    let writer = output.clone();
    let subscriber = tracing_subscriber::fmt()
        .json()
        .with_env_filter(build_filter("").unwrap())
        .with_writer(move || writer.clone())
        .finish();
    let router = Router::new()
        .route(
            "/broken",
            get(|| async {
                crate::problem::ApiError::from(app::AppError::Internal(
                    anyhow::anyhow!("connection closed").context("Reading track failed"),
                ))
                .into_response()
            }),
        )
        .layer(axum::middleware::from_fn(log_request));
    let response = router
        .oneshot(Request::builder().uri("/broken").body(Body::empty()).unwrap())
        .with_subscriber(subscriber)
        .await
        .unwrap();
    let event: serde_json::Value = serde_json::from_str(output.text().trim()).unwrap();
    assert_eq!(event["level"], "ERROR");
    assert_eq!(event["span"]["request_id"], response.headers()["x-request-id"].to_str().unwrap());
    assert_eq!(event["span"]["route"], "/broken");
    assert_eq!(event["fields"]["status"], 500);
    assert!(event["fields"]["elapsed_ms"].is_u64());
    assert_eq!(event["fields"]["reason"], "Reading track failed: connection closed");
}
