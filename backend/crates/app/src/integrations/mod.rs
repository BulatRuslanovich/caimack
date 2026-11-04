// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

pub mod deezer;
pub mod enrichment;
mod enrichment_jobs;
pub mod lrclib;
pub mod yandex;

use std::time::Duration;

pub fn http_client(timeout: Duration) -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(timeout)
        .user_agent(concat!("Caimack/", env!("CARGO_PKG_VERSION")))
        .build()
        .unwrap_or_else(|error| {
            tracing::error!("Could not configure the HTTP client, using defaults: {error}");
            reqwest::Client::new()
        })
}

pub async fn read_limited(mut response: reqwest::Response, max_bytes: usize) -> anyhow::Result<Vec<u8>> {
    if response.content_length().is_some_and(|length| length > max_bytes as u64) {
        anyhow::bail!("The response exceeds the {max_bytes} byte limit");
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if body.len() + chunk.len() > max_bytes {
            anyhow::bail!("The response exceeds the {max_bytes} byte limit");
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}
