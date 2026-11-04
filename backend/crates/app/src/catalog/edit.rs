// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use super::dto::{AlbumDto, ArtistDto, TrackDto};
use super::tags::{self, TagResolver};
use super::{albums, artists, tracks};
use crate::storage::Storage;
use crate::text::normalize_key;
use crate::{AppError, AppResult};

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTrackRequest {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAlbumRequest {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub year: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateArtistRequest {
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkDeleteResult {
    pub deleted: u64,
    pub missing: Vec<Uuid>,
}

#[derive(Default)]
struct Touched {
    albums: Vec<Uuid>,
    artists: Vec<Uuid>,
    genres: Vec<Uuid>,
}

#[derive(Default)]
struct Leftovers {
    covers: Vec<String>,
    tracks: Vec<(String, String)>,
}

impl Leftovers {
    fn remove(self, storage: &Storage) {
        for cover in self.covers {
            storage.delete_cover(&cover);
        }
        for (file_path, content_hash) in self.tracks {
            storage.delete(&file_path);
            storage.delete_transcodes(&content_hash);
        }
    }
}

async fn touched_by(conn: &mut PgConnection, track_ids: &[Uuid]) -> AppResult<Touched> {
    let rows = sqlx::query!(
        r#"SELECT album_id, artist_id AS "artist_id!", genre_id FROM tracks WHERE id = ANY($1)
           UNION ALL
           SELECT NULL, artist_id, NULL FROM track_artists WHERE track_id = ANY($1)"#,
        track_ids
    )
    .fetch_all(&mut *conn)
    .await?;

    let mut touched = Touched::default();
    for row in rows {
        touched.albums.extend(row.album_id);
        touched.artists.push(row.artist_id);
        touched.genres.extend(row.genre_id);
    }
    for list in [&mut touched.albums, &mut touched.artists, &mut touched.genres] {
        list.sort_unstable();
        list.dedup();
    }
    Ok(touched)
}

async fn clean_up_orphans(conn: &mut PgConnection, mut touched: Touched, leftovers: &mut Leftovers) -> AppResult<()> {
    if !touched.albums.is_empty() {
        let empty = sqlx::query!(
            "DELETE FROM albums a WHERE a.id = ANY($1) AND NOT EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = a.id)
             RETURNING a.cover_path, a.artist_id",
            &touched.albums
        )
        .fetch_all(&mut *conn)
        .await?;
        for album in empty {
            leftovers.covers.extend(album.cover_path);
            touched.artists.push(album.artist_id);
        }
    }

    if !touched.artists.is_empty() {
        let empty = sqlx::query!(
            "DELETE FROM artists a WHERE a.id = ANY($1)
               AND NOT EXISTS (SELECT 1 FROM tracks t WHERE t.artist_id = a.id)
               AND NOT EXISTS (SELECT 1 FROM albums al WHERE al.artist_id = a.id)
               AND NOT EXISTS (SELECT 1 FROM track_artists ta WHERE ta.artist_id = a.id)
             RETURNING a.image_path",
            &touched.artists
        )
        .fetch_all(&mut *conn)
        .await?;
        leftovers.covers.extend(empty.into_iter().filter_map(|artist| artist.image_path));
    }

    if !touched.genres.is_empty() {
        sqlx::query!(
            "DELETE FROM genres g WHERE g.id = ANY($1) AND NOT EXISTS (SELECT 1 FROM tracks t WHERE t.genre_id = g.id)",
            &touched.genres
        )
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

pub async fn update_track(
    db: &PgPool,
    storage: &Storage,
    user: Uuid,
    id: Uuid,
    request: UpdateTrackRequest,
) -> AppResult<TrackDto> {
    let mut tx = db.begin().await?;
    let track = sqlx::query!("SELECT artist_id, year FROM tracks WHERE id = $1 FOR UPDATE", id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::not_found("Track not found."))?;
    let touched = touched_by(&mut tx, &[id]).await?;
    let mut artist_id = track.artist_id;

    if let Some(title) = request.title.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
        sqlx::query!(
            "UPDATE tracks SET title = $2, normalized_title = $3 WHERE id = $1",
            id,
            title,
            normalize_key(title)
        )
        .execute(&mut *tx)
        .await?;
    }

    if let Some(artist) = request.artist.as_deref().filter(|a| !a.trim().is_empty()) {
        let credits = TagResolver::default().resolve_artists(&mut tx, &[artist]).await?;
        artist_id = credits[0];
        sqlx::query!("UPDATE tracks SET artist_id = $2 WHERE id = $1", id, artist_id).execute(&mut *tx).await?;
        sqlx::query!("DELETE FROM track_artists WHERE track_id = $1 AND NOT (artist_id = ANY($2))", id, &credits)
            .execute(&mut *tx)
            .await?;
        for (position, credit) in credits.iter().enumerate() {
            sqlx::query!(
                "INSERT INTO track_artists (track_id, artist_id, position) VALUES ($1, $2, $3)
                 ON CONFLICT (track_id, artist_id) DO UPDATE SET position = EXCLUDED.position",
                id,
                credit,
                i32::try_from(position).unwrap_or(i32::MAX)
            )
            .execute(&mut *tx)
            .await?;
        }
    }

    if let Some(album) = request.album.as_deref() {
        let album_id = if album.trim().is_empty() {
            None
        } else {
            Some(tags::album(&mut tx, album, artist_id, request.year.or(track.year)).await?)
        };
        sqlx::query!("UPDATE tracks SET album_id = $2 WHERE id = $1", id, album_id).execute(&mut *tx).await?;
    }

    if let Some(genre) = request.genre.as_deref() {
        let genre_id = if genre.trim().is_empty() { None } else { Some(tags::genre(&mut tx, genre).await?) };
        sqlx::query!("UPDATE tracks SET genre_id = $2 WHERE id = $1", id, genre_id).execute(&mut *tx).await?;
    }

    sqlx::query!(
        "UPDATE tracks SET year = COALESCE($2, year), track_number = COALESCE($3, track_number),
                           disc_number = COALESCE($4, disc_number)
         WHERE id = $1",
        id,
        request.year,
        request.track_number,
        request.disc_number
    )
    .execute(&mut *tx)
    .await?;

    let mut leftovers = Leftovers::default();
    clean_up_orphans(&mut tx, touched, &mut leftovers).await?;
    tx.commit().await?;
    leftovers.remove(storage);

    tracks::get(db, user, id).await
}

pub async fn delete_track(db: &PgPool, storage: &Storage, id: Uuid) -> AppResult<()> {
    if delete_tracks(db, storage, &[id]).await?.deleted == 0 {
        return Err(AppError::not_found("Track not found."));
    }
    Ok(())
}

pub async fn delete_tracks(db: &PgPool, storage: &Storage, ids: &[Uuid]) -> AppResult<BulkDeleteResult> {
    let mut wanted = Vec::with_capacity(ids.len());
    for id in ids {
        if !wanted.contains(id) {
            wanted.push(*id);
        }
    }
    if wanted.is_empty() {
        return Err(AppError::validation("No tracks were selected."));
    }

    let mut tx = db.begin().await?;
    let touched = touched_by(&mut tx, &wanted).await?;
    let removed = sqlx::query!("DELETE FROM tracks WHERE id = ANY($1) RETURNING id, file_path, content_hash", &wanted)
        .fetch_all(&mut *tx)
        .await?;

    let mut leftovers = Leftovers::default();
    clean_up_orphans(&mut tx, touched, &mut leftovers).await?;
    tx.commit().await?;

    let found: Vec<Uuid> = removed.iter().map(|track| track.id).collect();
    leftovers.tracks = removed.into_iter().map(|track| (track.file_path, track.content_hash)).collect();
    leftovers.remove(storage);

    if !found.is_empty() {
        tracing::info!("Deleted {} tracks", found.len());
    }
    Ok(BulkDeleteResult {
        deleted: found.len() as u64,
        missing: wanted.into_iter().filter(|id| !found.contains(id)).collect(),
    })
}

pub async fn update_album(db: &PgPool, id: Uuid, request: UpdateAlbumRequest) -> AppResult<AlbumDto> {
    let mut tx = db.begin().await?;
    let album = sqlx::query!("SELECT title FROM albums WHERE id = $1 FOR UPDATE", id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::not_found("Album not found."))?;
    let mut title = album.title;

    if let Some(new_title) = request.title.as_deref() {
        title = new_title.trim().to_owned();
        sqlx::query!(
            "UPDATE albums SET title = $2, normalized_title = $3 WHERE id = $1",
            id,
            title,
            normalize_key(&title)
        )
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            conflict_or(error, || AppError::conflict("\"{0}\" already exists for that artist.").arg(&title))
        })?;
    }

    if let Some(artist) = request.artist.as_deref().filter(|a| !a.trim().is_empty()) {
        let artist_id = TagResolver::default().resolve_artists(&mut tx, &[artist]).await?[0];
        sqlx::query!("UPDATE albums SET artist_id = $2 WHERE id = $1", id, artist_id).execute(&mut *tx).await.map_err(
            |error| conflict_or(error, || AppError::conflict("\"{0}\" already exists for that artist.").arg(&title)),
        )?;
    }

    if let Some(year) = request.year {
        sqlx::query!("UPDATE albums SET year = $2 WHERE id = $1", id, year).execute(&mut *tx).await?;
    }

    tx.commit().await?;
    albums::get_summary(db, id).await
}

pub async fn rename_artist(db: &PgPool, id: Uuid, request: UpdateArtistRequest) -> AppResult<ArtistDto> {
    let name = request.name.trim();
    let updated =
        sqlx::query!("UPDATE artists SET name = $2, normalized_name = $3 WHERE id = $1", id, name, normalize_key(name))
            .execute(db)
            .await
            .map_err(|error| {
                conflict_or(error, || AppError::conflict("An artist named \"{0}\" already exists.").arg(name))
            })?;

    if updated.rows_affected() == 0 {
        return Err(AppError::not_found("Artist not found."));
    }
    artists::get_summary(db, id).await
}

fn conflict_or(error: sqlx::Error, conflict: impl FnOnce() -> AppError) -> AppError {
    match &error {
        sqlx::Error::Database(db) if db.is_unique_violation() => conflict(),
        _ => error.into(),
    }
}
