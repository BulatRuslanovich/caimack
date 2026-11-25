// SPDX-License-Identifier: AGPL-3.0-only

use std::path::PathBuf;

use media::formats::AudioFormat;
use media::tags::{self, AudioMetadata};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::upload::MAX_AUDIO_BYTES;
use crate::{AppError, AppResult};

pub(crate) struct Scratch(PathBuf);

impl Scratch {
    pub async fn new() -> AppResult<Self> {
        let path = std::env::temp_dir().join(format!("caimack-music-{}", Uuid::now_v7().simple()));
        tokio::fs::create_dir(&path).await.map_err(AppError::internal)?;
        Ok(Self(path))
    }

    pub fn file(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_dir_all(&self.0)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            tracing::warn!(%error, "Could not remove temporary music files");
        }
    }
}

pub(crate) struct Audio {
    pub path: PathBuf,
    pub format: AudioFormat,
    pub original_bitrate: Option<i32>,
    pub album: Option<String>,
    pub cover: Option<Vec<u8>>,
    pub _scratch: Scratch,
}

impl Audio {
    pub async fn metadata(&self) -> AppResult<AudioMetadata> {
        let path = self.path.clone();
        let mut metadata = tokio::task::spawn_blocking(move || tags::read(&path))
            .await
            .map_err(AppError::internal)?
            .filter(|metadata| metadata.codec == Some(self.format.codec()) && metadata.duration_seconds > 0)
            .ok_or_else(|| AppError::validation("The source returned invalid audio."))?;
        if let Some(album) = &self.album {
            metadata.album = Some(album.clone());
        }
        if let Some(cover) = &self.cover {
            metadata.cover = Some(cover.clone());
        }
        Ok(metadata)
    }
}

pub(crate) async fn stream_to(mut response: reqwest::Response, path: &std::path::Path) -> AppResult<()> {
    const LIMIT: u64 = MAX_AUDIO_BYTES as u64;
    let mut received = 0;
    let mut file = tokio::fs::File::create(path).await.map_err(AppError::internal)?;
    while let Some(chunk) = response.chunk().await.map_err(AppError::internal)? {
        received += chunk.len() as u64;
        if received > LIMIT {
            return Err(AppError::payload_too_large("The source audio exceeds the upload size limit."));
        }
        file.write_all(&chunk).await.map_err(AppError::internal)?;
    }
    file.flush().await.map_err(AppError::internal)
}
