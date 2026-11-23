// SPDX-License-Identifier: AGPL-3.0-only

use reqwest::Url;
use std::{process::Stdio, time::Duration};
use tokio::process::Command;

use super::{Audio, Scratch, Transport, finish_audio};
use crate::upload::MAX_AUDIO_BYTES;
use crate::{AppError, AppResult};

impl Transport {
    pub(super) async fn extract_audio(&self, url: Url) -> AppResult<Audio> {
        let scratch = Scratch::new().await?;
        let pattern = scratch.file("source.%(ext)s");
        let mut command = self.extractor()?;
        command
            .args(["--no-playlist", "--max-filesize", &MAX_AUDIO_BYTES.to_string(), "-f", "bestaudio/best"])
            .args(["--print", "after_move:%(abr)s", "-o"])
            .arg(pattern)
            .args(["--", url.as_str()]);
        let report = run(command, Duration::from_secs(115)).await?;
        let bitrate = String::from_utf8_lossy(&report).lines().find_map(|line| {
            let rate = line.trim().split('.').next()?.parse::<i32>().ok()?;
            (rate > 0 && rate < 10000).then_some(rate)
        });
        let directory = scratch.file("");
        let mut entries = tokio::fs::read_dir(directory).await.map_err(AppError::internal)?;
        while let Some(entry) = entries.next_entry().await.map_err(AppError::internal)? {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with("source.")
                && !name.ends_with(".part")
                && entry.file_type().await.map_err(AppError::internal)?.is_file()
            {
                let path = entry.path();
                let size = entry.metadata().await.map_err(AppError::internal)?.len();
                if size == 0 || size > MAX_AUDIO_BYTES as u64 {
                    return Err(AppError::validation("The source audio exceeds the upload size limit."));
                }
                return finish_audio(scratch, path, "auto", bitrate).await;
            }
        }
        Err(AppError::validation("The extractor did not return a complete audio file."))
    }

    pub(in super::super) fn extractor(&self) -> AppResult<Command> {
        let path = self.extractor_path().ok_or_else(|| AppError::validation("The audio extractor is unavailable."))?;
        let mut command = Command::new(path);
        command
            .args([
                "--ignore-config",
                "--no-warnings",
                "--js-runtimes",
                "node",
                "--no-progress",
                "--socket-timeout",
                "12",
                "--retries",
                "1",
                "--fragment-retries",
                "1",
            ])
            .stdin(Stdio::null())
            .stderr(Stdio::piped())
            .stdout(Stdio::piped())
            .kill_on_drop(true);
        Ok(command)
    }
}

pub(in super::super) async fn run(mut command: Command, timeout: Duration) -> AppResult<Vec<u8>> {
    let output = tokio::time::timeout(timeout, command.output())
        .await
        .map_err(|_| AppError::validation("The audio extractor timed out."))?
        .map_err(|error| {
            tracing::debug!(%error, "Could not start the audio extractor");
            AppError::validation("The audio extractor is unavailable.")
        })?;
    if !output.status.success() {
        let details = String::from_utf8_lossy(&output.stderr);
        tracing::debug!(status = %output.status, error = %details.chars().take(400).collect::<String>(), "Audio extraction failed");

        return Err(AppError::validation("The audio extractor could not complete the request."));
    }
    Ok(output.stdout)
}
