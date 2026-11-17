// SPDX-License-Identifier: AGPL-3.0-only

use std::path::{Path, PathBuf};
use std::process::Stdio;

use anyhow::Context;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

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
            tracing::error!(%error, executable = EXECUTABLE, "Cannot start ffmpeg; check that it is installed on PATH");
            false
        }
    }
}

struct PartialHls(PathBuf);

impl Drop for PartialHls {
    fn drop(&mut self) {
        // This also runs when the caller drops the future. HLS has only a few
        // files; normal completion uses async cleanup below.
        if let Err(error) = std::fs::remove_dir_all(&self.0)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            tracing::warn!(directory = %self.0.display(), %error, "Cannot remove incomplete HLS files");
        }
    }
}

/// Remove partial renditions left by a previous process, before starting workers.
pub fn cleanup_partial_hls(root: &Path) -> std::io::Result<()> {
    for hash in std::fs::read_dir(root)? {
        let hash = hash?;
        if !hash.file_type()?.is_dir() {
            continue;
        }
        for entry in std::fs::read_dir(hash.path())? {
            let entry = entry?;
            let name = entry.file_name();
            let Some(stem) = name.to_str().and_then(|name| name.strip_suffix(".part")) else { continue };
            let Some((quality, id)) = stem.split_once('.') else { continue };
            if matches!(quality, "low" | "normal") && uuid::Uuid::parse_str(id).is_ok() && entry.file_type()?.is_dir() {
                std::fs::remove_dir_all(entry.path())?;
            }
        }
    }
    Ok(())
}

pub async fn transcode_to_hls(
    source: &Path,
    target: &Path,
    bitrate_kbps: u32,
    cancel: &CancellationToken,
) -> anyhow::Result<bool> {
    let partial = PartialHls(target.with_extension(format!("{}.part", uuid::Uuid::now_v7().simple())));
    tokio::fs::create_dir_all(&partial.0).await.with_context(|| format!("Could not create {}", partial.0.display()))?;

    let result = run_hls(source, &partial.0, target, bitrate_kbps, cancel).await;

    if let Err(error) = tokio::fs::remove_dir_all(&partial.0).await
        && error.kind() != std::io::ErrorKind::NotFound
    {
        tracing::warn!(directory = %partial.0.display(), %error, "Cannot remove incomplete HLS rendition");
    }
    result
}

async fn run_hls(
    source: &Path,
    partial: &Path,
    target: &Path,
    bitrate_kbps: u32,
    cancel: &CancellationToken,
) -> anyhow::Result<bool> {
    let mut child = command()
        .args(["-nostdin", "-hide_banner", "-loglevel", "error", "-i"])
        .arg(source)
        .args(["-vn", "-map_metadata", "-1", "-map", "0:a:0", "-threads", "1", "-c:a", "aac", "-profile:a", "aac_low"])
        .args(["-b:a", &format!("{bitrate_kbps}k"), "-ac", "2", "-ar", "48000", "-f", "hls"])
        .args(["-hls_time", HLS_SEGMENT_SECONDS, "-hls_playlist_type", "vod", "-hls_segment_type", "fmp4"])
        .args(["-hls_flags", "independent_segments+single_file", "-hls_segment_filename"])
        .arg(partial.join(HLS_MEDIA))
        .arg("-y")
        .arg(partial.join(HLS_INDEX))
        .spawn()
        .context("ffmpeg could not be started")?;

    let mut stderr = Vec::new();
    let mut pipe = child.stderr.take();
    let status = tokio::select! {
        biased;
        () = cancel.cancelled() => {
            // Reap the writer before removing its files, including on Windows.
            child.kill().await.context("Could not stop ffmpeg")?;
            return Ok(false);
        }
        result = async {
            let read = async {
                if let Some(pipe) = &mut pipe {
                    pipe.read_to_end(&mut stderr).await?;
                }
                std::io::Result::Ok(())
            };
            let (status, ()) = tokio::try_join!(child.wait(), read)?;
            std::io::Result::Ok(status)
        } => result?,
    };

    let complete = status.success() && partial.join(HLS_INDEX).exists() && partial.join(HLS_MEDIA).exists();
    if !complete {
        tracing::warn!(
            file = %source.display(), exit_status = %status, bitrate_kbps,
            stderr = String::from_utf8_lossy(&stderr).trim(),
            "ffmpeg failed to prepare HLS rendition"
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
        file = %source.display(), exit_status = %output.status,
        stderr = String::from_utf8_lossy(&output.stderr).trim(),
        "ffmpeg failed to unpack FLAC audio"
    );
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn aborting_a_future_removes_its_partial_rendition() -> anyhow::Result<()> {
        let path = std::env::temp_dir().join(format!("caimack-partial-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&path)?;
        std::fs::write(path.join(HLS_MEDIA), b"partial")?;
        let (started, ready) = tokio::sync::oneshot::channel();
        let partial = PartialHls(path.clone());
        let task = tokio::spawn(async move {
            let _partial = partial;
            let _ = started.send(());
            std::future::pending::<()>().await;
        });
        ready.await?;
        task.abort();
        assert!(task.await.is_err());
        assert!(!path.exists());
        Ok(())
    }

    #[test]
    fn startup_cleanup_preserves_ready_variants_and_unrelated_directories() -> anyhow::Result<()> {
        let root = std::env::temp_dir().join(format!("caimack-hls-startup-{}", uuid::Uuid::now_v7()));
        let hash = root.join("hash");
        let stale = hash.join(format!("low.{}.part", uuid::Uuid::now_v7().simple()));
        let ready = hash.join("normal");
        let unrelated = hash.join("low.not-a-uuid.part");
        for path in [&stale, &ready, &unrelated] {
            std::fs::create_dir_all(path)?;
            std::fs::write(path.join(HLS_MEDIA), b"media")?;
        }
        cleanup_partial_hls(&root)?;
        assert!(!stale.exists());
        assert!(ready.join(HLS_MEDIA).exists());
        assert!(unrelated.join(HLS_MEDIA).exists());
        std::fs::remove_dir_all(root)?;
        Ok(())
    }

    #[tokio::test]
    async fn cancelled_and_failed_transcodes_leave_no_partial_files_or_damage_to_ready_audio() -> anyhow::Result<()> {
        let root = std::env::temp_dir().join(format!("caimack-hls-cancel-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&root)?;
        let source = root.join("source.wav");
        let output = command()
            .args([
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "anullsrc=r=48000:cl=stereo",
                "-t",
                "1",
                "-y",
            ])
            .arg(&source)
            .output()
            .await?;
        assert!(output.status.success());
        let target = root.join("low");
        let cancel = CancellationToken::new();
        assert!(transcode_to_hls(&source, &target, 64, &cancel).await?);
        let original = std::fs::read(target.join(HLS_INDEX))?;
        cancel.cancel();
        assert!(!transcode_to_hls(&source, &target, 64, &cancel).await?);
        assert!(!transcode_to_hls(&root.join("missing.wav"), &target, 64, &CancellationToken::new()).await?);
        assert_eq!(std::fs::read(target.join(HLS_INDEX))?, original);
        assert_eq!(std::fs::read_dir(&root)?.count(), 2, "only the source and ready rendition remain");
        std::fs::remove_dir_all(root)?;
        Ok(())
    }
}
