// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, bail};
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

use crate::config::ModelConfig;
use crate::text::hex_lower;

struct ModelFile {
    path: &'static str,
    sha256: &'static str,
}

const FILES: [ModelFile; 3] = [
    ModelFile {
        path: media::clap::MODEL_PATH,
        sha256: "1a204c9bc8fb8a4c8d5f314b305219005ad746670693b0503a78e889116006b0",
    },
    ModelFile {
        path: media::clap::MEL_FILTERS_PATH,
        sha256: "d643673b1bd3ff90fca67ebfbd4341246c2faed2a8a1adb2cc8b589a5b514c1d",
    },
    ModelFile {
        path: "models/clap/model.json",
        sha256: "cee9c74b20a8eec8cec46011c3ab79e2ed6c16ec47eeffe1a5d12d3729b59857",
    },
];

const ATTEMPTS: u32 = 3;
const RETRY_DELAY: Duration = Duration::from_secs(5);
const PROGRESS_FROM_BYTES: u64 = 16 * 1024 * 1024;
const MODEL_RETRY_DELAY: Duration = Duration::from_secs(60);

pub async fn load_when_ready(
    config: &ModelConfig,
    cancel: &CancellationToken,
) -> Option<Arc<media::clap::ClapEmbedder>> {
    retry_load(
        || async {
            ensure(config).await?;
            let root = config.storage_root.clone();
            let embedder = tokio::task::spawn_blocking(move || media::clap::ClapEmbedder::load(&root))
                .await
                .context("Loading the CLAP model was interrupted")??;
            tracing::info!("CLAP model ready; starting track analysis");
            Ok(Arc::new(embedder))
        },
        cancel,
    )
    .await
}

async fn retry_load<T, F: std::future::Future<Output = anyhow::Result<T>>>(
    mut load: impl FnMut() -> F,
    cancel: &CancellationToken,
) -> Option<T> {
    loop {
        let result = tokio::select! {
            biased;
            () = cancel.cancelled() => return None,
            result = load() => result,
        };
        match result {
            Ok(value) => return Some(value),
            Err(error) => tracing::warn!(
                "CLAP model unavailable; track analysis is waiting, retrying in {}s: {error:#}",
                MODEL_RETRY_DELAY.as_secs()
            ),
        }
        tokio::select! {
            () = cancel.cancelled() => return None,
            () = tokio::time::sleep(MODEL_RETRY_DELAY) => {},
        }
    }
}

pub async fn ensure(config: &ModelConfig) -> anyhow::Result<()> {
    let missing: Vec<&ModelFile> = FILES.iter().filter(|file| !config.storage_root.join(file.path).is_file()).collect();
    if missing.is_empty() {
        return Ok(());
    }
    let Some(base_url) = &config.url else {
        return Ok(());
    };

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(Duration::from_secs(60))
        .user_agent(concat!("Caimack/", env!("CARGO_PKG_VERSION")))
        .build()
        .context("Could not configure the HTTP client")?;

    for file in missing {
        let target = config.storage_root.join(file.path);
        let name = target.file_name().and_then(|name| name.to_str()).unwrap_or(file.path);
        let url = format!("{base_url}/{name}");
        if let Some(parent) = target.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .with_context(|| format!("Could not create {}", parent.display()))?;
        }

        let mut attempt = 1;
        loop {
            match download(&client, &url, &target, file.sha256).await {
                Ok(()) => break,
                Err(error) if attempt < ATTEMPTS => {
                    tracing::warn!("Downloading {url} failed, retrying: {error:#}");
                    attempt += 1;
                    tokio::time::sleep(RETRY_DELAY).await;
                }
                Err(error) => {
                    return Err(error.context(format!(
                        "Could not download the CLAP model from {url}. Check the network or CLAP_MODEL_URL, \
                         or export the model yourself with `make model`."
                    )));
                }
            }
        }
    }
    Ok(())
}

async fn download(client: &reqwest::Client, url: &str, target: &Path, sha256: &str) -> anyhow::Result<()> {
    let partial = partial_path(target);
    match fetch(client, url, &partial, sha256).await {
        Ok(()) => tokio::fs::rename(&partial, target)
            .await
            .with_context(|| format!("Could not move the model into {}", target.display())),
        Err(error) => {
            let _ = tokio::fs::remove_file(&partial).await;
            Err(error)
        }
    }
}

async fn fetch(client: &reqwest::Client, url: &str, partial: &Path, sha256: &str) -> anyhow::Result<()> {
    let mut response = client.get(url).send().await?.error_for_status()?;
    let total = response.content_length().filter(|total| *total >= PROGRESS_FROM_BYTES);
    match total {
        Some(bytes) => tracing::info!("Downloading {url} ({} MB)", bytes / 1_000_000),
        None => tracing::info!("Downloading {url}"),
    }

    let mut file =
        tokio::fs::File::create(partial).await.with_context(|| format!("Could not create {}", partial.display()))?;
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    let mut reported = 0;
    while let Some(chunk) = response.chunk().await? {
        hasher.update(&chunk);
        file.write_all(&chunk).await?;
        received += chunk.len() as u64;
        if let Some(total) = total {
            let percent = received * 100 / total;
            if percent >= reported + 10 {
                reported = percent - percent % 10;
                tracing::info!("Downloaded {reported}%");
            }
        }
    }
    file.sync_all().await?;

    let actual = hex_lower(&hasher.finalize());
    if actual != sha256 {
        bail!("The downloaded file has SHA-256 {actual}, expected {sha256}");
    }
    Ok(())
}

fn partial_path(target: &Path) -> PathBuf {
    let mut name = target.file_name().unwrap_or_default().to_os_string();
    name.push(".part");
    target.with_file_name(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn model_loading_recovers_after_a_failure_without_restarting_the_server() {
        let mut attempts = 0;
        let started = tokio::time::Instant::now();
        let loaded = retry_load(
            || {
                attempts += 1;
                std::future::ready(if attempts == 1 { Err(anyhow::anyhow!("model not downloaded")) } else { Ok(42) })
            },
            &CancellationToken::new(),
        )
        .await;
        assert_eq!(loaded, Some(42));
        assert_eq!(started.elapsed(), MODEL_RETRY_DELAY);
    }

    #[tokio::test]
    async fn shutdown_interrupts_an_in_flight_model_download() {
        let cancel = CancellationToken::new();
        let (started, loading) = tokio::sync::oneshot::channel();
        let stop = cancel.clone();
        let task = tokio::spawn(async move {
            let mut started = Some(started);
            retry_load(
                || {
                    if let Some(started) = started.take() {
                        let _ = started.send(());
                    }
                    std::future::pending::<anyhow::Result<()>>()
                },
                &stop,
            )
            .await
        });
        loading.await.unwrap();
        cancel.cancel();
        assert_eq!(task.await.unwrap(), None);
    }

    #[tokio::test]
    async fn a_missing_local_model_waits_for_recovery_instead_of_ending_the_worker() {
        let config = ModelConfig {
            storage_root: std::env::temp_dir().join(format!("caimack-missing-model-{}", uuid::Uuid::now_v7())),
            url: None,
        };
        let cancel = CancellationToken::new();
        let mut loading = std::pin::pin!(load_when_ready(&config, &cancel));
        assert!(
            std::future::poll_fn(|cx| std::task::Poll::Ready(
                std::future::Future::poll(loading.as_mut(), cx).is_pending()
            ))
            .await
        );
        cancel.cancel();
        assert!(loading.await.is_none());
    }
}
