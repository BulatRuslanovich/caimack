// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

mod assemble;
mod cover;
mod probe;

use media::formats::{self, AudioFormat};
use serde::Serialize;
use sqlx::PgPool;
use tokio::io::AsyncRead;
use uuid::Uuid;

use crate::catalog::dto::TrackDto;
use crate::catalog::tracks;
use crate::i18n::Lang;
use crate::integrations::enrichment::{EnrichmentQueue, EnrichmentRequest};
use crate::library_scan;
use crate::storage::{Storage, StoredFile};
use crate::streaming::HashCache;
use crate::transcode::{self, TranscodeQueue};
use crate::{AppError, AppResult};

use self::assemble::{Saved, assemble};
use self::cover::PreparedCover;

pub use self::probe::{ProbeBasis, ProbeFile, ProbeMatch, ProbeResult, ProbeVerdict, probe};

pub const MAX_AUDIO_BYTES: i64 = 200 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadFailure {
    pub file_name: String,
    pub reason: String,
}

#[derive(Debug, Clone, Copy)]
pub struct Imported {
    pub id: Uuid,
    pub codec: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResult {
    pub uploaded: Vec<TrackDto>,
    pub failed: Vec<UploadFailure>,
}

#[derive(Clone)]
pub struct Uploads {
    pub db: PgPool,
    pub storage: Storage,
    pub transcodes: TranscodeQueue,
    pub hashes: HashCache,
    pub enrichment: EnrichmentQueue,
}

impl Uploads {
    pub async fn upload(
        &self,
        user: Uuid,
        file_name: &str,
        content_length: Option<i64>,
        body: impl AsyncRead + Unpin,
        lang: Lang,
    ) -> UploadResult {
        match self.upload_single(user, file_name, content_length, body).await {
            Ok(track) => UploadResult { uploaded: vec![track], failed: vec![] },
            Err(error) => {
                let reason = match error.message() {
                    Some(message) => {
                        tracing::info!("Upload of {file_name} rejected: {error}");
                        message.localized(lang)
                    }
                    None => {
                        tracing::error!("Unexpected failure while uploading {file_name}: {error:#}");
                        crate::i18n::localize("The file could not be processed.", &[], lang)
                    }
                };
                UploadResult {
                    uploaded: vec![],
                    failed: vec![UploadFailure { file_name: file_name.to_owned(), reason }],
                }
            }
        }
    }

    async fn upload_single(
        &self,
        user: Uuid,
        file_name: &str,
        content_length: Option<i64>,
        body: impl AsyncRead + Unpin,
    ) -> AppResult<TrackDto> {
        let started = std::time::Instant::now();
        let format = formats::for_file_name(file_name)
            .ok_or_else(|| AppError::validation("Only {0} files are supported.").arg(formats::ACCEPTED))?;
        if content_length.is_some_and(|length| length > MAX_AUDIO_BYTES) {
            return Err(AppError::validation("The file exceeds the {0} MB limit.").arg(MAX_AUDIO_BYTES / (1024 * 1024)));
        }

        let stored = self.storage.save_track(body, format.extension, MAX_AUDIO_BYTES).await?;
        let saved = match self.import(file_name, &stored, format, None).await {
            Ok(saved) => saved,
            Err(error) => {
                self.storage.delete(&stored.relative_path);
                return Err(error);
            }
        };

        let track = tracks::get(&self.db, user, saved.id).await?;
        tracing::info!(
            "Uploaded {file_name} as track {}: {}, {:.1} MB in {:.1} s",
            saved.id,
            saved.codec,
            stored.size_bytes as f64 / (1024.0 * 1024.0),
            started.elapsed().as_secs_f64()
        );
        Ok(track)
    }

    pub async fn import(
        &self,
        file_name: &str,
        stored: &StoredFile,
        format: AudioFormat,
        cover: Option<Vec<u8>>,
    ) -> AppResult<Imported> {
        let saved = self.check_and_save(file_name, stored, format, cover).await?;

        if let Some((old_path, old_hash)) = &saved.replaced {
            self.storage.delete(old_path);
            self.storage.delete_transcodes(old_hash);
            self.hashes.forget(saved.id);
            if Storage::is_library(old_path)
                && let Err(error) = library_scan::release(&self.db, old_path).await
            {
                tracing::error!("Could not release {old_path} after a lossless replacement: {error}");
            }
        }
        for request in
            transcode::warmup_for(&stored.content_hash, &stored.relative_path, Some(saved.codec), saved.bitrate_kbps)
        {
            self.transcodes.try_enqueue_warmup(request);
        }
        self.enrichment.try_enqueue(EnrichmentRequest { track: Some(saved.id), artists: saved.new_artists });
        Ok(Imported { id: saved.id, codec: saved.codec })
    }

    async fn check_and_save(
        &self,
        file_name: &str,
        stored: &StoredFile,
        format: AudioFormat,
        cover: Option<Vec<u8>>,
    ) -> AppResult<Saved> {
        if stored.size_bytes == 0 {
            return Err(AppError::validation("The file is empty."));
        }
        let path = self
            .storage
            .existing(&stored.relative_path)
            .ok_or_else(|| AppError::validation("The uploaded file could not be read back."))?;

        let sniff_path = path.clone();
        let actual = tokio::task::spawn_blocking(move || formats::sniff_container(&sniff_path))
            .await
            .map_err(AppError::internal)?;
        if actual.is_some_and(|actual| actual != format.extension) {
            return Err(AppError::validation("The file is not a {0} file despite its name.").arg(format.label()));
        }

        let mut metadata = tokio::task::spawn_blocking(move || media::tags::read(&path))
            .await
            .map_err(AppError::internal)?
            .ok_or_else(|| AppError::validation("The file is not a readable {0} file.").arg(format.label()))?;
        if metadata.duration_seconds <= 0 {
            return Err(AppError::validation("The file contains no audio stream."));
        }
        if cover.is_some() {
            metadata.cover = cover;
        }

        let mut artwork = metadata.album.as_deref().filter(|album| !album.trim().is_empty()).and(metadata.cover.take());
        let names = if metadata.album_artists.is_empty() { &metadata.artists } else { &metadata.album_artists };
        if artwork.is_some()
            && let Some(artist) = names.iter().find(|name| !name.trim().is_empty())
            && let Some(album) = &metadata.album
        {
            // Avoid encoding the same embedded art for every track of an existing album.
            let covered: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM albums al JOIN artists ar ON ar.id = al.artist_id
                 WHERE ar.normalized_name = $1 AND al.normalized_title = $2 AND al.cover_path IS NOT NULL)",
            )
            .bind(crate::text::normalize_key(artist))
            .bind(crate::text::normalize_key(album))
            .fetch_one(&self.db)
            .await?;
            if covered {
                artwork = None;
            }
        }
        let mut cover = PreparedCover::prepare(&self.storage, artwork).await?;
        let mut tx = self.db.begin().await?;
        let saved =
            assemble(&mut tx, file_name, stored, metadata, format, cover.as_ref().map(PreparedCover::path)).await?;
        tx.commit().await?;
        if saved.cover_attached
            && let Some(cover) = &mut cover
        {
            cover.persist();
        }
        Ok(saved)
    }
}
