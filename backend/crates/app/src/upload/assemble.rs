// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::HashSet;
use std::path::Path;

use chrono::Utc;
use media::formats::{self, AudioFormat};
use media::tags::AudioMetadata;
use sqlx::PgConnection;
use uuid::Uuid;

use crate::catalog::lyrics::{self, LyricsSource};
use crate::catalog::tags::{self, TagResolver, split_artist_names};
use crate::storage::StoredFile;
use crate::text::normalize_key;
use crate::{AppError, AppResult};

const SAME_RECORDING_TOLERANCE_SECONDS: i32 = 3;
const MAX_ORIGINAL_NAME_LENGTH: usize = 260;

pub(super) struct Saved {
    pub(super) id: Uuid,
    pub(super) codec: &'static str,
    pub(super) bitrate_kbps: Option<i32>,

    pub(super) replaced: Option<(String, String)>,

    pub(super) new_artists: Vec<Uuid>,
    pub(super) cover_attached: bool,
}

fn names_from_file_name(file_name: &str) -> Option<(String, String)> {
    let stem = Path::new(file_name).file_stem()?.to_str()?.replace('_', " ");
    let mut parts: Vec<&str> = Vec::new();
    for piece in stem.split(" - ").flat_map(|p| p.split(" – ")).flat_map(|p| p.split(" — ")) {
        let piece = piece.trim();
        if !piece.is_empty() {
            parts.push(piece);
        }
    }
    let parts: Vec<&str> = parts.into_iter().skip_while(|part| part.chars().all(|c| c.is_ascii_digit())).collect();
    (parts.len() >= 2).then(|| (parts[0].to_owned(), parts[1..].join(" - ")))
}

pub(super) async fn assemble(
    conn: &mut PgConnection,
    file_name: &str,
    stored: &StoredFile,
    mut metadata: AudioMetadata,
    format: AudioFormat,
    cover: Option<&str>,
) -> AppResult<Saved> {
    if metadata.title.is_none()
        && metadata.artists.is_empty()
        && metadata.album_artists.is_empty()
        && let Some((artist, title)) = names_from_file_name(file_name)
    {
        metadata.artists = vec![artist];
        metadata.title = Some(title);
    }

    let duplicate = sqlx::query_scalar!("SELECT id FROM tracks WHERE content_hash = $1", stored.content_hash)
        .fetch_optional(&mut *conn)
        .await?;
    if duplicate.is_some() {
        return Err(AppError::conflict("This file is already in the library."));
    }

    let codec: &'static str = metadata.codec.unwrap_or_else(|| format.codec());
    let stem = Path::new(file_name).file_stem().and_then(|s| s.to_str()).unwrap_or(file_name);
    let title = metadata.title.clone().unwrap_or_else(|| stem.to_owned());
    let leaf = file_name.replace('\\', "/").rsplit('/').next().unwrap_or(file_name).trim().to_owned();
    let original_name: String = {
        let count = leaf.chars().count();
        leaf.chars().skip(count.saturating_sub(MAX_ORIGINAL_NAME_LENGTH)).collect()
    };
    let title_key = normalize_key(&title);
    let names = if metadata.artists.is_empty() { &metadata.album_artists } else { &metadata.artists };
    let artist_keys: Vec<String> = names
        .iter()
        .cloned()
        .chain(names.iter().flat_map(|name| split_artist_names(name)))
        .map(|name| normalize_key(&name))
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();

    let same_recording = sqlx::query!(
        "SELECT t.id, t.codec, t.file_path, t.content_hash FROM tracks t
         WHERE t.normalized_title = $1 AND t.duration_seconds BETWEEN $2 AND $3
           AND EXISTS (SELECT 1 FROM track_artists ta JOIN artists a ON a.id = ta.artist_id
                       WHERE ta.track_id = t.id AND a.normalized_name = ANY($4))",
        title_key,
        metadata.duration_seconds - SAME_RECORDING_TOLERANCE_SECONDS,
        metadata.duration_seconds + SAME_RECORDING_TOLERANCE_SECONDS,
        &artist_keys
    )
    .fetch_all(&mut *conn)
    .await?;

    let lossless = formats::is_lossless(Some(codec));
    if !lossless && same_recording.iter().any(|t| formats::is_lossless(t.codec.as_deref())) {
        return Err(AppError::conflict("A lossless version of this track is already in the library."));
    }

    if lossless && let Some(lossy) = same_recording.iter().find(|t| !formats::is_lossless(t.codec.as_deref())) {
        sqlx::query!(
            "UPDATE tracks SET file_path = $2, original_file_name = $3, mime_type = $4, file_size = $5, content_hash = $6,
                               duration_seconds = $7, codec = $8, bitrate_kbps = $9, sample_rate_hz = $10, bits_per_sample = $11
             WHERE id = $1",
            lossy.id,
            stored.relative_path,
            original_name,
            format.mime_type,
            stored.size_bytes,
            stored.content_hash,
            metadata.duration_seconds,
            codec,
            metadata.bitrate_kbps,
            metadata.sample_rate_hz,
            metadata.bits_per_sample
        )
        .execute(&mut *conn)
        .await?;
        tracing::info!("Track {} ({title}) upgraded to {codec} from {file_name}", lossy.id);
        return Ok(Saved {
            id: lossy.id,
            codec,
            bitrate_kbps: metadata.bitrate_kbps,
            replaced: Some((lossy.file_path.clone(), lossy.content_hash.clone())),
            new_artists: vec![],
            cover_attached: false,
        });
    }

    let mut resolver = TagResolver::default();
    let name_refs: Vec<&str> = names.iter().map(String::as_str).collect();
    let credits = resolver.resolve_artists(conn, &name_refs).await?;
    let track_artist = credits[0];

    let mut album_id = None;
    let mut cover_attached = false;
    if let Some(album_title) = metadata.album.as_deref().map(str::trim).filter(|a| !a.is_empty()) {
        let album_artist = if metadata.album_artists.is_empty() {
            track_artist
        } else {
            let refs: Vec<&str> = metadata.album_artists.iter().map(String::as_str).collect();
            resolver.resolve_artists(conn, &refs).await?[0]
        };
        let id = tags::album(conn, album_title, album_artist, metadata.year).await?;
        album_id = Some(id);
        cover_attached = attach_cover(conn, id, cover).await?;
    }

    let genre_id = match metadata.genre.as_deref().map(str::trim).filter(|g| !g.is_empty()) {
        Some(genre) => Some(tags::genre(conn, genre).await?),
        None => None,
    };

    let id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO tracks (id, title, normalized_title, artist_id, album_id, genre_id, track_number, disc_number, year,
                             duration_seconds, file_path, original_file_name, mime_type, file_size, content_hash, codec,
                             bitrate_kbps, sample_rate_hz, bits_per_sample, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)",
        id,
        title,
        title_key,
        track_artist,
        album_id,
        genre_id,
        metadata.track_number,
        metadata.disc_number,
        metadata.year,
        metadata.duration_seconds,
        stored.relative_path,
        original_name,
        format.mime_type,
        stored.size_bytes,
        stored.content_hash,
        codec,
        metadata.bitrate_kbps,
        metadata.sample_rate_hz,
        metadata.bits_per_sample,
        Utc::now()
    )
    .execute(&mut *conn)
    .await?;

    for (position, artist) in credits.iter().enumerate() {
        sqlx::query!(
            "INSERT INTO track_artists (track_id, artist_id, position) VALUES ($1, $2, $3)",
            id,
            artist,
            i32::try_from(position).unwrap_or(i32::MAX)
        )
        .execute(&mut *conn)
        .await?;
    }

    let parsed = lyrics::parse(metadata.lyrics.as_deref());
    if !parsed.is_empty() {
        sqlx::query!(
            "INSERT INTO track_lyrics (track_id, plain, synced, source, updated_at) VALUES ($1, $2, $3, $4, $5)",
            id,
            parsed.plain,
            sqlx::types::Json(&parsed.lines) as _,
            LyricsSource::Embedded as i32,
            Utc::now()
        )
        .execute(&mut *conn)
        .await?;
    }

    Ok(Saved {
        id,
        codec,
        bitrate_kbps: metadata.bitrate_kbps,
        replaced: None,
        new_artists: resolver.created().to_vec(),
        cover_attached,
    })
}

async fn attach_cover(conn: &mut PgConnection, album: Uuid, cover: Option<&str>) -> AppResult<bool> {
    let Some(path) = cover else { return Ok(false) };
    Ok(sqlx::query("UPDATE albums SET cover_path = $2 WHERE id = $1 AND cover_path IS NULL")
        .bind(album)
        .bind(path)
        .execute(conn)
        .await?
        .rows_affected()
        == 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_name_gives_artist_and_title() {
        assert_eq!(
            names_from_file_name("03 - Loose Thread Collective - Loose_Thread - Live.mp3"),
            Some(("Loose Thread Collective".to_owned(), "Loose Thread - Live".to_owned()))
        );
    }

    #[test]
    fn single_part_name_gives_nothing() {
        assert_eq!(names_from_file_name("recording.mp3"), None);
    }
}
