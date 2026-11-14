// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

//! Metadata envelopes let clients replace ID3/FLAC metadata without transferring
//! the audio again. The reconstructed file is checked against its full SHA-256.
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use anyhow::{bail, ensure};
use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{AppError, AppResult, storage::Storage};

const MAX_TAGS: u64 = 32 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Envelope {
    pub audio_version: String,
    pub file_hash: String,
    pub prefix: String,
    pub suffix: String,
    pub payload_size: u64,
}

pub fn boundaries(file: &mut (impl Read + Seek), size: u64) -> anyhow::Result<(u64, u64)> {
    let mut head = [0_u8; 10];
    file.seek(SeekFrom::Start(0))?;
    file.read_exact(&mut head)?;
    let prefix = if &head[..4] == b"fLaC" {
        let mut end = 4_u64;
        loop {
            file.seek(SeekFrom::Start(end))?;
            let mut block = [0_u8; 4];
            file.read_exact(&mut block)?;
            let length = u32::from_be_bytes([0, block[1], block[2], block[3]]);
            end += 4 + u64::from(length);
            ensure!(end <= MAX_TAGS && end < size, "Invalid FLAC metadata length");
            if block[0] & 0x80 != 0 {
                break;
            }
        }
        end
    } else if &head[..3] == b"ID3" {
        ensure!((2..=4).contains(&head[3]) && head[6..10].iter().all(|b| b & 0x80 == 0), "Invalid ID3 header");
        let length = head[6..10].iter().fold(0_u64, |n, b| (n << 7) | u64::from(*b));
        10 + length + if head[3] == 4 && head[5] & 0x10 != 0 { 10 } else { 0 }
    } else if head[0] == 0xff && head[1] & 0xe0 == 0xe0 {
        0
    } else {
        bail!("Unsupported audio envelope");
    };
    let mut suffix = 0;
    if size >= 128 {
        file.seek(SeekFrom::Start(size - 128))?;
        let mut tag = [0_u8; 3];
        file.read_exact(&mut tag)?;
        if &tag == b"TAG" {
            suffix = 128;
        }
    }
    // APEv2 may precede ID3v1. Include its optional header and footer.
    if size >= suffix + 32 {
        file.seek(SeekFrom::Start(size - suffix - 32))?;
        let mut footer = [0_u8; 32];
        file.read_exact(&mut footer)?;
        if &footer[..8] == b"APETAGEX" {
            let length = u32::from_le_bytes(footer[12..16].try_into()?);
            let flags = u32::from_le_bytes(footer[20..24].try_into()?);
            ensure!(length >= 32, "Invalid APE tag size");
            suffix += u64::from(length) + if flags & (1 << 31) != 0 { 32 } else { 0 };
        }
    }
    ensure!(prefix + suffix < size && prefix + suffix <= MAX_TAGS, "Invalid tag length");
    Ok((prefix, suffix))
}

fn read(path: &Path, audio_version: String, file_hash: String) -> anyhow::Result<Envelope> {
    let mut file = std::fs::File::open(path)?;
    let size = file.metadata()?.len();
    // Some imported files have an .mp3 name but contain MP4 or another
    // container. Preserve those bytes as an opaque payload, never guess tags.
    let (start, end) = boundaries(&mut file, size).unwrap_or((0, 0));
    let mut prefix = vec![0; usize::try_from(start)?];
    let mut suffix = vec![0; usize::try_from(end)?];
    file.seek(SeekFrom::Start(0))?;
    file.read_exact(&mut prefix)?;
    file.seek(SeekFrom::Start(size - end))?;
    file.read_exact(&mut suffix)?;
    let b64 = base64::engine::general_purpose::STANDARD;
    Ok(Envelope {
        audio_version,
        file_hash,
        prefix: b64.encode(prefix),
        suffix: b64.encode(suffix),
        payload_size: size - start - end,
    })
}

pub async fn get(db: &PgPool, storage: &Storage, id: Uuid, version: &str) -> AppResult<Envelope> {
    let mut tx = db.begin().await?;
    let (path, audio, hash): (String, String, String) = sqlx::query_as(
        "SELECT file_path,COALESCE(s.audio_hash,t.media_cache_hash,t.content_hash),content_hash
         FROM tracks t LEFT JOIN sync_audio_payloads s ON s.track_id=t.id AND s.source_hash=t.content_hash WHERE t.id=$1 FOR SHARE OF t",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::not_found("Track not found."))?;
    if version != hash {
        return Err(AppError::conflict("The audio file changed. Refresh the library snapshot."));
    }
    let path = storage.resolve(&path)?;
    let envelope =
        tokio::task::spawn_blocking(move || read(&path, audio, hash)).await.map_err(AppError::internal)??;
    tx.commit().await?;
    Ok(envelope)
}

/// Changed sources are hashed once. Metadata exports advance the cached
/// source_hash transactionally, keeping later cover updates inexpensive.
pub async fn prepare_identities(db: &PgPool, storage: &Storage) -> AppResult<()> {
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT t.id FROM tracks t LEFT JOIN sync_audio_payloads s ON s.track_id=t.id
         WHERE s.source_hash IS DISTINCT FROM t.content_hash ORDER BY t.id",
    )
    .fetch_all(db)
    .await?;
    for id in ids {
        let mut tx = db.begin().await?;
        let row: Option<(String, String)> =
            sqlx::query_as("SELECT file_path,content_hash FROM tracks WHERE id=$1 FOR SHARE")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?;
        let Some((path, source)) = row else { continue };
        let path = storage.resolve(&path)?;
        if !path.is_file() {
            continue;
        }
        let audio = tokio::task::spawn_blocking(move || -> anyhow::Result<String> {
            let mut file = std::fs::File::open(path)?;
            let size = file.metadata()?.len();
            let parsed = boundaries(&mut file, size);
            let opaque = parsed.is_err();
            let (prefix, suffix) = parsed.unwrap_or((0, 0));
            file.seek(SeekFrom::Start(prefix))?;
            let mut payload = file.take(size - prefix - suffix);
            let mut hash = Sha256::new();
            let mut buffer = [0_u8; 128 * 1024];
            loop {
                let n = payload.read(&mut buffer)?;
                if n == 0 {
                    break;
                }
                hash.update(&buffer[..n]);
            }
            let digest = crate::text::hex_lower(&hash.finalize());
            Ok(if opaque { format!("opaque:{digest}") } else { digest })
        })
        .await
        .map_err(AppError::internal)??;
        sqlx::query(
            "INSERT INTO sync_audio_payloads(track_id,source_hash,audio_hash) VALUES($1,$2,$3)
            ON CONFLICT(track_id) DO UPDATE SET source_hash=EXCLUDED.source_hash,audio_hash=EXCLUDED.audio_hash",
        )
        .bind(id)
        .bind(source)
        .bind(audio)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    #[test]
    fn mp3_keeps_audio_between_id3_blocks() {
        let mut bytes = b"ID3\x04\x00\x00\x00\x00\x00\x05hello".to_vec();
        bytes.extend([0xff, 0xfb, 1, 2, 3]);
        bytes.extend(b"TAG");
        bytes.extend([0; 125]);
        assert_eq!(boundaries(&mut Cursor::new(&bytes), bytes.len() as u64).unwrap(), (15, 128));
    }
    #[test]
    fn flac_stops_at_last_metadata_block() {
        let bytes = b"fLaC\x00\x00\x00\x02ab\x84\x00\x00\x03xyzAUDIO";
        assert_eq!(boundaries(&mut Cursor::new(bytes), bytes.len() as u64).unwrap(), (17, 0));
    }
    #[test]
    fn malformed_metadata_never_selects_the_audio_as_tags() {
        let bytes = b"ID3\x04\x00\x00\x7f\x7f\x7f\x7fshort";
        assert!(boundaries(&mut Cursor::new(bytes), bytes.len() as u64).is_err());
    }
}
