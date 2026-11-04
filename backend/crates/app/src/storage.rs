// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};

use anyhow::{Context, bail};
use media::ffmpeg::{HLS_INDEX, HLS_MEDIA};
use media::images::{LARGE_EDGE, Rendition, THUMB_EDGE};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

use crate::library::settings::AudioQuality;
use crate::text::hex_lower;
use crate::{AppError, AppResult};

pub const MUSIC_DIRECTORY: &str = "music";
pub const COVER_DIRECTORY: &str = "covers";
pub const ARTIST_IMAGE_DIRECTORY: &str = "artists";
pub const PLAYLIST_COVER_DIRECTORY: &str = "playlists";
pub const HLS_DIRECTORY: &str = "hls";
pub const LIBRARY_DIRECTORY: &str = "library";

const BUFFER_SIZE: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CoverSize {
    #[default]
    Full,
    Thumb,
    Large,
}

impl CoverSize {
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value.trim().to_ascii_lowercase().as_str() {
            "full" | "0" => Self::Full,
            "thumb" | "1" => Self::Thumb,
            "large" | "2" => Self::Large,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone)]
pub struct StoredFile {
    pub relative_path: String,
    pub size_bytes: i64,
    pub content_hash: String,
}

#[derive(Debug, Clone)]
pub struct Storage {
    root: PathBuf,

    ready_variants: Arc<Mutex<HashSet<String>>>,
}

impl Storage {
    pub fn open(root: &Path) -> anyhow::Result<Self> {
        for directory in
            [MUSIC_DIRECTORY, COVER_DIRECTORY, ARTIST_IMAGE_DIRECTORY, PLAYLIST_COVER_DIRECTORY, HLS_DIRECTORY]
        {
            std::fs::create_dir_all(root.join(directory))
                .with_context(|| format!("Could not create {} in the storage root", directory))?;
        }
        let root = root.canonicalize().with_context(|| format!("Storage root {} is not usable", root.display()))?;
        tracing::info!("Music storage rooted at {}", root.display());
        Ok(Self { root, ready_variants: Arc::default() })
    }

    pub fn resolve(&self, relative: &str) -> anyhow::Result<PathBuf> {
        let path = Path::new(relative);
        if relative.trim().is_empty() || relative.contains(':') {
            bail!("Rejected storage path '{relative}'");
        }
        if !path.components().all(|part| matches!(part, Component::Normal(_))) {
            bail!("Rejected storage path '{relative}'");
        }
        Ok(self.root.join(path))
    }

    pub fn existing(&self, relative: &str) -> Option<PathBuf> {
        self.resolve(relative).ok().filter(|path| path.is_file())
    }

    pub fn is_library(relative: &str) -> bool {
        Path::new(relative).components().next() == Some(Component::Normal(LIBRARY_DIRECTORY.as_ref()))
    }

    pub fn library_root(&self) -> Option<PathBuf> {
        Some(self.root.join(LIBRARY_DIRECTORY)).filter(|path| path.is_dir())
    }

    pub fn delete(&self, relative: &str) {
        if relative.trim().is_empty() {
            return;
        }
        if Self::is_library(relative) {
            tracing::debug!("Kept {relative}: files in the music folder are never deleted");
            return;
        }
        match self.resolve(relative) {
            Ok(path) => remove_file(&path),
            Err(error) => tracing::error!("Could not delete {relative} from storage: {error}"),
        }
    }

    pub async fn save_track(
        &self,
        mut input: impl AsyncRead + Unpin,
        extension: &str,
        max_bytes: i64,
    ) -> AppResult<StoredFile> {
        let valid_extension = extension.len() >= 2
            && extension.len() <= 6
            && extension.starts_with('.')
            && extension[1..].chars().all(|c| c.is_ascii_alphanumeric());
        if !valid_extension {
            return Err(AppError::Internal(anyhow::anyhow!("Rejected storage extension '{extension}'")));
        }

        let id = Uuid::now_v7().simple().to_string();
        let relative_path = format!("{MUSIC_DIRECTORY}/{}/{}/{id}{extension}", &id[30..], &id[28..30]);
        let path = self.resolve(&relative_path)?;
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await.context("Could not create the music directory")?;
        }

        let written = write_hashed(&mut input, &path, max_bytes).await;
        if written.is_err() {
            remove_file(&path);
        }
        let (size_bytes, content_hash) = written?;
        Ok(StoredFile { relative_path, size_bytes, content_hash })
    }

    pub fn cover_variant(cover_path: &str, size: CoverSize) -> String {
        let stem = cover_path.strip_suffix(".webp").unwrap_or(cover_path);
        match size {
            CoverSize::Full => cover_path.to_owned(),
            CoverSize::Thumb => format!("{stem}.thumb.webp"),
            CoverSize::Large => format!("{stem}.large.webp"),
        }
    }

    pub async fn save_renditions(&self, directory: &str, owner: Uuid, renditions: &[Rendition]) -> AppResult<String> {
        let full_path = format!("{directory}/{}.webp", owner.simple());
        let base_edge = renditions
            .iter()
            .map(|r| r.edge)
            .filter(|&edge| edge != LARGE_EDGE)
            .max()
            .or_else(|| renditions.iter().map(|r| r.edge).max())
            .ok_or_else(|| AppError::Internal(anyhow::anyhow!("An image needs at least one rendition")))?;

        for rendition in renditions {
            let relative = if rendition.edge == base_edge {
                full_path.clone()
            } else if rendition.edge == LARGE_EDGE {
                Self::cover_variant(&full_path, CoverSize::Large)
            } else if rendition.edge == THUMB_EDGE {
                Self::cover_variant(&full_path, CoverSize::Thumb)
            } else {
                continue;
            };
            let path = self.resolve(&relative)?;
            if let Some(parent) = path.parent() {
                tokio::fs::create_dir_all(parent).await.context("Could not create the image directory")?;
            }
            tokio::fs::write(&path, &rendition.webp).await.with_context(|| format!("Could not write {relative}"))?;
        }
        Ok(full_path)
    }

    pub fn delete_cover(&self, cover_path: &str) {
        for size in [CoverSize::Full, CoverSize::Thumb, CoverSize::Large] {
            self.delete(&Self::cover_variant(cover_path, size));
        }
    }

    pub fn hls_variant_dir(&self, content_hash: &str, quality: AudioQuality) -> anyhow::Result<PathBuf> {
        self.resolve(&format!("{HLS_DIRECTORY}/{content_hash}/{}", quality.slug()))
    }

    pub fn hls_variant_ready(&self, content_hash: &str, quality: AudioQuality) -> bool {
        let key = format!("{content_hash}:{}", quality.slug());
        if self.ready_variants.lock().is_ok_and(|ready| ready.contains(&key)) {
            return true;
        }
        let Ok(directory) = self.hls_variant_dir(content_hash, quality) else { return false };
        let ready = directory.join(HLS_INDEX).is_file() && directory.join(HLS_MEDIA).is_file();
        if ready && let Ok(mut known) = self.ready_variants.lock() {
            known.insert(key);
        }
        ready
    }

    pub fn delete_transcodes(&self, content_hash: &str) {
        if let Ok(mut known) = self.ready_variants.lock() {
            known.retain(|key| !key.starts_with(&format!("{content_hash}:")));
        }
        match self.resolve(&format!("{HLS_DIRECTORY}/{content_hash}")) {
            Ok(path) if path.exists() => {
                if let Err(error) = std::fs::remove_dir_all(&path) {
                    tracing::error!("Could not delete storage directory {}: {error}", path.display());
                }
            }
            Ok(_) => {}
            Err(error) => tracing::error!("Could not delete the transcodes of {content_hash}: {error}"),
        }
    }

    pub fn available_bytes(&self) -> u64 {
        fs4::available_space(self.root.join(MUSIC_DIRECTORY)).unwrap_or(0)
    }
}

async fn write_hashed(input: &mut (impl AsyncRead + Unpin), path: &Path, max_bytes: i64) -> AppResult<(i64, String)> {
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .await
        .with_context(|| format!("Could not create {}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; BUFFER_SIZE];
    let mut size: i64 = 0;

    loop {
        let read = input.read(&mut buffer).await.context("The upload was interrupted")?;
        if read == 0 {
            break;
        }
        size += i64::try_from(read).unwrap_or(i64::MAX);
        if size > max_bytes {
            return Err(
                AppError::payload_too_large("The file exceeds the {0} MB upload limit.").arg(max_bytes / (1024 * 1024))
            );
        }
        hasher.update(&buffer[..read]);
        file.write_all(&buffer[..read]).await.context("Could not write the upload")?;
    }
    file.flush().await.context("Could not write the upload")?;

    Ok((size, hex_lower(&hasher.finalize())))
}

pub fn hash_file(path: &Path) -> std::io::Result<(i64, String)> {
    use std::io::Read;

    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; BUFFER_SIZE];
    let mut size: i64 = 0;
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        size += i64::try_from(read).unwrap_or(i64::MAX);
        hasher.update(&buffer[..read]);
    }
    Ok((size, hex_lower(&hasher.finalize())))
}

fn remove_file(path: &Path) {
    match std::fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => tracing::error!("Could not delete {} from storage: {error}", path.display()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn storage() -> Storage {
        Storage { root: PathBuf::from("/storage"), ready_variants: Arc::default() }
    }

    #[test]
    fn relative_paths_resolve_under_the_root() {
        assert_eq!(storage().resolve("music/ab/cd/x.mp3").unwrap(), PathBuf::from("/storage/music/ab/cd/x.mp3"));
    }

    #[test]
    fn escaping_paths_are_rejected() {
        let storage = storage();
        assert!(
            ["../etc/passwd", "/etc/passwd", "music/../../x", "C:/x", ""].iter().all(|p| storage.resolve(p).is_err())
        );
    }

    #[test]
    fn cover_variants_sit_next_to_the_full_image() {
        let base = "covers/abc.webp";
        assert_eq!(
            [CoverSize::Full, CoverSize::Thumb, CoverSize::Large].map(|size| Storage::cover_variant(base, size)),
            ["covers/abc.webp", "covers/abc.thumb.webp", "covers/abc.large.webp"]
        );
    }

    #[test]
    fn files_in_the_music_folder_are_never_deleted() {
        let dir = std::env::temp_dir().join(format!("caimack-storage-{}", Uuid::now_v7().simple()));
        let storage = Storage::open(&dir).unwrap();
        std::fs::create_dir_all(dir.join("library/Artist")).unwrap();
        std::fs::write(dir.join("library/Artist/song.mp3"), b"music").unwrap();
        std::fs::write(dir.join("music/upload.mp3"), b"upload").unwrap();

        storage.delete("library/Artist/song.mp3");
        storage.delete("music/upload.mp3");

        assert!(dir.join("library/Artist/song.mp3").is_file());
        assert!(!dir.join("music/upload.mp3").exists());
        assert_eq!(storage.library_root(), Some(storage.root.join("library")));
        assert!(Storage::is_library("library/x.mp3") && !Storage::is_library("music/library/x.mp3"));
        assert_eq!(hash_file(&dir.join("library/Artist/song.mp3")).unwrap().0, 5);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn upload_is_hashed_and_limited() {
        let dir = std::env::temp_dir().join(format!("caimack-storage-{}", Uuid::now_v7().simple()));
        let storage = Storage::open(&dir).unwrap();

        let stored = storage.save_track(&b"abc"[..], ".mp3", 10).await.unwrap();
        let too_big = storage.save_track(&b"0123456789x"[..], ".mp3", 10).await;

        assert_eq!(
            (stored.size_bytes, stored.content_hash.as_str(), too_big.map(|_| ()).map_err(|e| e.status())),
            (3, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", Err(413))
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
