// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use chrono::Utc;
use media::images::{self, ImageError, Rendition};
use sqlx::PgPool;
use uuid::Uuid;

use crate::catalog::dto::{AlbumDto, ArtistDto};
use crate::catalog::{albums, artists};
use crate::library::playlists::{self, PlaylistDto};
use crate::storage::{ARTIST_IMAGE_DIRECTORY, COVER_DIRECTORY, PLAYLIST_COVER_DIRECTORY, Storage};
use crate::{AppError, AppResult};

pub const MAX_IMAGE_BYTES: i64 = 8 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES: [&str; 3] = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_EXTENSIONS: [&str; 4] = ["jpg", "jpeg", "png", "webp"];

pub struct UploadedImage {
    pub bytes: Vec<u8>,
    pub content_type: Option<String>,
    pub file_name: String,
}

pub async fn accept(image: UploadedImage) -> AppResult<Vec<Rendition>> {
    if image.bytes.is_empty() {
        return Err(AppError::validation("No image was provided."));
    }
    if i64::try_from(image.bytes.len()).unwrap_or(i64::MAX) > MAX_IMAGE_BYTES {
        return Err(AppError::payload_too_large("The file exceeds the {0} MB upload limit.")
            .arg(MAX_IMAGE_BYTES / (1024 * 1024)));
    }
    let content_type = image.content_type.unwrap_or_default().to_ascii_lowercase();
    if !ALLOWED_CONTENT_TYPES.contains(&content_type.as_str()) {
        return Err(AppError::validation("Only JPEG, PNG and WebP images are accepted."));
    }
    let extension = std::path::Path::new(&image.file_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        return Err(AppError::validation("Only .jpg, .png and .webp files are accepted."));
    }

    renditions(image.bytes).await
}

pub async fn renditions(bytes: Vec<u8>) -> AppResult<Vec<Rendition>> {
    let set = tokio::task::spawn_blocking(move || images::square_webp_set(&bytes, &images::EDGES))
        .await
        .map_err(AppError::internal)?;
    set.map_err(|error| match error {
        ImageError::TooManyPixels => AppError::validation("That image has too many pixels to process."),
        ImageError::Unreadable => AppError::validation("That file could not be read as an image."),
    })
}

pub async fn set_album_cover(db: &PgPool, storage: &Storage, id: Uuid, image: UploadedImage) -> AppResult<AlbumDto> {
    albums::get_summary(db, id).await?;
    let set = accept(image).await?;
    let path = storage.save_renditions(COVER_DIRECTORY, id, &set).await?;
    sqlx::query!("UPDATE albums SET cover_path = $2 WHERE id = $1", id, path).execute(db).await?;
    albums::get_summary(db, id).await
}

pub async fn remove_album_cover(db: &PgPool, storage: &Storage, id: Uuid) -> AppResult<()> {
    let old = sqlx::query!("SELECT cover_path FROM albums WHERE id = $1", id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::not_found("Album not found."))?;
    if let Some(path) = old.cover_path {
        sqlx::query!("UPDATE albums SET cover_path = NULL WHERE id = $1", id).execute(db).await?;
        storage.delete_cover(&path);
    }
    Ok(())
}

pub async fn set_artist_image(db: &PgPool, storage: &Storage, id: Uuid, image: UploadedImage) -> AppResult<ArtistDto> {
    artists::get_summary(db, id).await?;
    let set = accept(image).await?;
    let path = storage.save_renditions(ARTIST_IMAGE_DIRECTORY, id, &set).await?;
    sqlx::query!("UPDATE artists SET image_path = $2 WHERE id = $1", id, path).execute(db).await?;
    artists::get_summary(db, id).await
}

pub async fn remove_artist_image(db: &PgPool, storage: &Storage, id: Uuid) -> AppResult<()> {
    let old = sqlx::query!("SELECT image_path FROM artists WHERE id = $1", id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::not_found("Artist not found."))?;
    if let Some(path) = old.image_path {
        sqlx::query!("UPDATE artists SET image_path = NULL WHERE id = $1", id).execute(db).await?;
        storage.delete_cover(&path);
    }
    Ok(())
}

async fn require_own_playlist(db: &PgPool, user: Uuid, id: Uuid) -> AppResult<Option<String>> {
    sqlx::query!("SELECT cover_path FROM playlists WHERE id = $1 AND user_id = $2", id, user)
        .fetch_optional(db)
        .await?
        .map(|row| row.cover_path)
        .ok_or_else(|| AppError::not_found("Playlist not found."))
}

pub async fn set_playlist_cover(
    db: &PgPool,
    storage: &Storage,
    user: Uuid,
    id: Uuid,
    image: UploadedImage,
) -> AppResult<PlaylistDto> {
    require_own_playlist(db, user, id).await?;
    let set = accept(image).await?;
    let path = storage.save_renditions(PLAYLIST_COVER_DIRECTORY, id, &set).await?;
    sqlx::query!("UPDATE playlists SET cover_path = $2, updated_at = $3 WHERE id = $1", id, path, Utc::now())
        .execute(db)
        .await?;
    let mut query = playlists::select();
    query.push(" WHERE p.id = ").push_bind(id);
    playlists::fetch(db, query).await?.into_iter().next().ok_or_else(|| AppError::not_found("Playlist not found."))
}

pub async fn remove_playlist_cover(db: &PgPool, storage: &Storage, user: Uuid, id: Uuid) -> AppResult<()> {
    if let Some(path) = require_own_playlist(db, user, id).await? {
        sqlx::query!("UPDATE playlists SET cover_path = NULL, updated_at = $2 WHERE id = $1", id, Utc::now())
            .execute(db)
            .await?;
        storage.delete_cover(&path);
    }
    Ok(())
}
