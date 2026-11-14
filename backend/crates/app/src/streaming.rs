// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::path::PathBuf;
use std::time::{Duration, UNIX_EPOCH};

use moka::sync::Cache;
use sqlx::PgPool;
use uuid::Uuid;

use crate::library::settings::AudioQuality;
use crate::storage::{CoverSize, Storage};
use crate::transcode::{self, TranscodeQueue, TranscodeRequest};
use crate::{AppError, AppResult};

const MAX_DOWNLOAD_NAME_LENGTH: usize = 120;

pub struct TrackFile {
    pub path: PathBuf,
    pub content_type: String,
    pub download_name: String,
    pub etag: String,
}

pub async fn open_track(db: &PgPool, storage: &Storage, id: Uuid) -> AppResult<TrackFile> {
    let track = sqlx::query!(
        "SELECT t.file_path, t.mime_type, t.original_file_name, t.content_hash, t.title, ar.name AS artist_name
         FROM tracks t JOIN artists ar ON ar.id = t.artist_id WHERE t.id = $1",
        id
    )
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::not_found("Track not found."))?;

    let Some(path) = storage.existing(&track.file_path) else {
        tracing::error!("Track {id} is registered at {} but the file is missing from storage", track.file_path);
        return Err(AppError::not_found("The audio file for this track is missing from storage."));
    };

    let extension = std::path::Path::new(&track.original_file_name)
        .extension()
        .and_then(|e| e.to_str())
        .filter(|e| !e.is_empty())
        .map_or_else(|| ".mp3".to_owned(), |e| format!(".{e}"));

    Ok(TrackFile {
        path,
        content_type: track.mime_type,
        download_name: format!("{}{extension}", download_stem(&track.artist_name, &track.title)),
        etag: format!("\"{}\"", track.content_hash),
    })
}

fn download_stem(artist: &str, title: &str) -> String {
    let basis = if artist.trim().is_empty() { title.to_owned() } else { format!("{artist} - {title}") };
    let mut name = String::with_capacity(basis.len());
    for character in basis.chars() {
        let safe = if "\\/:*?\"<>|".contains(character) || character.is_control() { ' ' } else { character };
        if safe != ' ' || name.chars().last().is_some_and(|last| last != ' ') {
            name.push(safe);
        }
    }

    let mut cleaned: String = name.trim_matches([' ', '.']).to_owned();
    if cleaned.chars().count() > MAX_DOWNLOAD_NAME_LENGTH {
        cleaned = cleaned.chars().take(MAX_DOWNLOAD_NAME_LENGTH).collect::<String>().trim_end().to_owned();
    }
    if cleaned.is_empty() { "track".to_owned() } else { cleaned }
}

pub struct HlsMaster {
    pub playlist: Option<String>,
    pub etag: String,
}

pub async fn hls_master(
    db: &PgPool,
    storage: &Storage,
    queue: &TranscodeQueue,
    id: Uuid,
    max_quality: AudioQuality,
) -> AppResult<HlsMaster> {
    if max_quality == AudioQuality::Original {
        return Err(AppError::validation("Original is not an HLS quality cap."));
    }
    let (cache_hash, file_path, codec, bitrate_kbps): (String, String, Option<String>, Option<i32>) = sqlx::query_as(
        "SELECT COALESCE(media_cache_hash,content_hash),file_path,codec,bitrate_kbps FROM tracks WHERE id=$1",
    )
    .bind(id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::not_found("Track not found."))?;

    if !transcode::worthwhile(max_quality, codec.as_deref(), bitrate_kbps) {
        return Ok(HlsMaster { playlist: None, etag: format!("\"{cache_hash}-original\"") });
    }

    let ready: Vec<AudioQuality> = transcode::WARMUP_QUALITIES
        .into_iter()
        .filter(|&quality| quality <= max_quality && storage.hls_variant_ready(&cache_hash, quality))
        .collect();

    let request = |quality| TranscodeRequest { content_hash: cache_hash.clone(), source: file_path.clone(), quality };
    for quality in [AudioQuality::Low, AudioQuality::Normal] {
        if storage.hls_variant_ready(&cache_hash, quality) {
            continue;
        }
        if quality == AudioQuality::Low && ready.is_empty() {
            queue.try_enqueue_urgent(request(quality));
        } else {
            queue.try_enqueue_warmup(request(quality));
        }
    }

    if ready.is_empty() {
        return Ok(HlsMaster { playlist: None, etag: format!("\"{cache_hash}-hls-preparing\"") });
    }

    let mut playlist = String::from("#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-INDEPENDENT-SEGMENTS\n");
    for quality in &ready {
        let bandwidth = quality.hls_kbps().unwrap_or_default() * 1000;
        playlist.push_str(&format!(
            "#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},AVERAGE-BANDWIDTH={bandwidth},CODECS=\"mp4a.40.2\"\n{}/{}\n",
            quality.slug(),
            media::ffmpeg::HLS_INDEX
        ));
    }
    let version = ready.iter().map(|q| q.slug()).collect::<Vec<_>>().join("-");
    Ok(HlsMaster { playlist: Some(playlist), etag: format!("\"{cache_hash}-hls-{version}\"") })
}

#[derive(Clone)]
pub struct HashCache(Cache<Uuid, String>);

impl Default for HashCache {
    fn default() -> Self {
        Self(Cache::builder().max_capacity(10_000).time_to_idle(Duration::from_secs(3600)).build())
    }
}

impl HashCache {
    pub fn forget(&self, id: Uuid) {
        self.0.invalidate(&id);
    }
}

pub struct HlsAsset {
    pub path: PathBuf,
    pub content_type: &'static str,
    pub etag: String,
}

pub async fn hls_asset(
    db: &PgPool,
    storage: &Storage,
    hashes: &HashCache,
    id: Uuid,
    quality: AudioQuality,
    file_name: &str,
) -> AppResult<HlsAsset> {
    let not_found = || AppError::not_found("HLS asset not found.");
    if quality == AudioQuality::Original || ![media::ffmpeg::HLS_INDEX, media::ffmpeg::HLS_MEDIA].contains(&file_name) {
        return Err(not_found());
    }

    let content_hash = match hashes.0.get(&id) {
        Some(hash) => hash,
        None => {
            let hash: String =
                sqlx::query_scalar("SELECT COALESCE(media_cache_hash,content_hash) FROM tracks WHERE id = $1")
                    .bind(id)
                    .fetch_optional(db)
                    .await?
                    .ok_or_else(|| AppError::not_found("Track not found."))?;
            hashes.0.insert(id, hash.clone());
            hash
        }
    };

    let path = storage.hls_variant_dir(&content_hash, quality)?.join(file_name);
    if !path.is_file() {
        return Err(not_found());
    }
    let content_type = if file_name.ends_with(".m3u8") { "application/vnd.apple.mpegurl" } else { "audio/mp4" };
    Ok(HlsAsset { path, content_type, etag: format!("\"{content_hash}-hls-{}-{file_name}\"", quality.slug()) })
}

pub async fn waveform(db: &PgPool, id: Uuid) -> AppResult<Vec<i32>> {
    let waveform = sqlx::query_scalar!(
        r#"SELECT waveform AS "waveform!" FROM track_cues WHERE track_id = $1 AND succeeded AND waveform IS NOT NULL"#,
        id
    )
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::not_found("The waveform is not ready yet."))?;
    Ok(waveform.into_iter().map(i32::from).collect())
}

pub struct ImageFile {
    pub path: PathBuf,
    pub content_type: &'static str,
    pub etag: String,
}

pub async fn track_cover(db: &PgPool, storage: &Storage, id: Uuid, size: CoverSize) -> AppResult<ImageFile> {
    let album =
        sqlx::query_scalar!("SELECT album_id FROM tracks WHERE id = $1", id).fetch_optional(db).await?.flatten();
    match album {
        Some(album) => album_cover(db, storage, album, size).await,
        None => Err(AppError::not_found("This track has no cover art.")),
    }
}

pub async fn album_cover(db: &PgPool, storage: &Storage, id: Uuid, size: CoverSize) -> AppResult<ImageFile> {
    let path =
        sqlx::query_scalar!("SELECT cover_path FROM albums WHERE id = $1", id).fetch_optional(db).await?.flatten();
    let path = path.filter(|p| !p.is_empty()).ok_or_else(|| AppError::not_found("This album has no cover art"))?;
    open_variant(storage, &path, size)
}

pub async fn artist_image(db: &PgPool, storage: &Storage, id: Uuid, size: CoverSize) -> AppResult<ImageFile> {
    let path =
        sqlx::query_scalar!("SELECT image_path FROM artists WHERE id = $1", id).fetch_optional(db).await?.flatten();
    let path = path.filter(|p| !p.is_empty()).ok_or_else(|| AppError::not_found("This artist has no photo."))?;
    open_variant(storage, &path, size)
}

pub async fn playlist_cover(
    db: &PgPool,
    storage: &Storage,
    user: Uuid,
    id: Uuid,
    size: CoverSize,
) -> AppResult<ImageFile> {
    let path =
        sqlx::query_scalar!("SELECT cover_path FROM playlists WHERE id = $1 AND (user_id = $2 OR is_public)", id, user)
            .fetch_optional(db)
            .await?
            .flatten();
    let path = path.filter(|p| !p.is_empty()).ok_or_else(|| AppError::not_found("This playlist has no cover art."))?;
    open_variant(storage, &path, size)
}

fn open_variant(storage: &Storage, base: &str, size: CoverSize) -> AppResult<ImageFile> {
    let ladder: &[CoverSize] = match size {
        CoverSize::Large => &[CoverSize::Large, CoverSize::Full, CoverSize::Thumb],
        CoverSize::Thumb => &[CoverSize::Thumb, CoverSize::Full],
        CoverSize::Full => &[CoverSize::Full, CoverSize::Thumb],
    };
    let found = ladder.iter().find_map(|&step| {
        let relative = Storage::cover_variant(base, step);
        storage.existing(&relative).map(|path| (relative, path))
    });

    let Some((relative, path)) = found else {
        tracing::warn!("An image is missing at {base}");
        return Err(AppError::not_found("The image file is missing from storage."));
    };

    let metadata = std::fs::metadata(&path).map_err(AppError::internal)?;
    let stamp =
        metadata.modified().ok().and_then(|at| at.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos() / 100);
    let content_type = match std::path::Path::new(&relative)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("gif") => "image/gif",
        Some("jpg" | "jpeg") => "image/jpeg",
        _ => "image/webp",
    };
    Ok(ImageFile { path, content_type, etag: format!("\"{stamp:x}-{:x}\"", metadata.len()) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn download_name_drops_forbidden_characters_and_double_spaces() {
        assert_eq!(download_stem("AC/DC", "  Back:In  Black?. "), "AC DC - Back In Black");
    }

    #[test]
    fn download_name_without_artist_is_the_title() {
        assert_eq!(download_stem(" ", "Lantern"), "Lantern");
    }
}
