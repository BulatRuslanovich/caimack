// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::path::Path;
use std::process::Stdio;

use anyhow::Context;
use tokio::process::Command;

pub const EXECUTABLE: &str = "ffmpeg";

pub const HLS_INDEX: &str = "index.m3u8";
pub const HLS_MEDIA: &str = "media.m4s";
const HLS_SEGMENT_SECONDS: &str = "4";

fn command() -> Command {
    let mut command = Command::new(EXECUTABLE);
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped()).kill_on_drop(true);
    command
}

pub async fn is_present() -> bool {
    match command().arg("-version").output().await {
        Ok(output) => output.status.success(),
        Err(error) => {
            tracing::error!("{EXECUTABLE} could not be started: {error}");
            false
        }
    }
}

pub async fn transcode_to_hls(source: &Path, target: &Path, bitrate_kbps: u32) -> anyhow::Result<bool> {
    let partial = target.with_extension(format!("{}.part", uuid::Uuid::now_v7().simple()));
    tokio::fs::create_dir_all(&partial).await.with_context(|| format!("Could not create {}", partial.display()))?;

    let result = run_hls(source, &partial, target, bitrate_kbps).await;

    if tokio::fs::try_exists(&partial).await.unwrap_or(false)
        && let Err(error) = tokio::fs::remove_dir_all(&partial).await
    {
        tracing::warn!("Could not clean up the partial HLS rendition at {}: {error}", partial.display());
    }
    result
}

async fn run_hls(source: &Path, partial: &Path, target: &Path, bitrate_kbps: u32) -> anyhow::Result<bool> {
    let output = command()
        .args(["-nostdin", "-hide_banner", "-loglevel", "error", "-i"])
        .arg(source)
        .args(["-vn", "-map_metadata", "-1", "-map", "0:a:0", "-threads", "1", "-c:a", "aac", "-profile:a", "aac_low"])
        .args(["-b:a", &format!("{bitrate_kbps}k"), "-ac", "2", "-ar", "48000", "-f", "hls"])
        .args(["-hls_time", HLS_SEGMENT_SECONDS, "-hls_playlist_type", "vod", "-hls_segment_type", "fmp4"])
        .args(["-hls_flags", "independent_segments+single_file", "-hls_segment_filename"])
        .arg(partial.join(HLS_MEDIA))
        .arg("-y")
        .arg(partial.join(HLS_INDEX))
        .output()
        .await
        .context("ffmpeg could not be started")?;

    let complete = output.status.success() && partial.join(HLS_INDEX).exists() && partial.join(HLS_MEDIA).exists();
    if !complete {
        tracing::warn!(
            "ffmpeg exited with {} while preparing HLS for {}: {}",
            output.status,
            source.display(),
            String::from_utf8_lossy(&output.stderr).trim()
        );
        return Ok(false);
    }

    if tokio::fs::try_exists(target).await.unwrap_or(false) {
        tokio::fs::remove_dir_all(target).await.with_context(|| format!("Could not replace {}", target.display()))?;
    }
    tokio::fs::rename(partial, target)
        .await
        .with_context(|| format!("Could not move HLS into {}", target.display()))?;
    Ok(true)
}

pub async fn remux_flac(source: &Path, target: &Path) -> anyhow::Result<bool> {
    let output = command()
        .args(["-nostdin", "-hide_banner", "-loglevel", "error", "-i"])
        .arg(source)
        .args(["-map", "0:a:0", "-c:a", "copy", "-f", "flac", "-y"])
        .arg(target)
        .output()
        .await
        .context("ffmpeg could not be started")?;
    if output.status.success() && target.is_file() {
        return Ok(true);
    }
    tracing::warn!(
        "ffmpeg exited with {} while unpacking FLAC from {}: {}",
        output.status,
        source.display(),
        String::from_utf8_lossy(&output.stderr).trim()
    );
    Ok(false)
}
