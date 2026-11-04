// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::catalog::dto::TrackDto;
use crate::catalog::tracks;
use crate::storage::Storage;
use crate::{AppError, AppResult, json};

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistDto {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub is_public: bool,
    pub owner_id: Uuid,
    pub owner_name: String,
    pub track_count: i32,
    pub duration_seconds: i32,
    pub has_cover: bool,

    pub cover_track_id: Option<Uuid>,
    #[serde(serialize_with = "json::time")]
    pub created_at: DateTime<Utc>,
    #[serde(serialize_with = "json::time")]
    pub updated_at: DateTime<Utc>,
}

#[skip_serializing_none]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistDetailDto {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub is_public: bool,
    pub owner_id: Uuid,
    pub owner_name: String,
    pub duration_seconds: i32,
    pub has_cover: bool,
    pub cover_track_id: Option<Uuid>,
    #[serde(serialize_with = "json::time")]
    pub created_at: DateTime<Utc>,
    #[serde(serialize_with = "json::time")]
    pub updated_at: DateTime<Utc>,
    pub tracks: Vec<TrackDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistRequest {
    pub name: String,
    pub description: Option<String>,
    #[serde(default)]
    pub is_public: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackIdsRequest {
    pub track_ids: Vec<Uuid>,
}

pub fn select() -> QueryBuilder<Postgres> {
    QueryBuilder::new(
        "SELECT p.id, p.name, p.description, p.is_public, p.user_id AS owner_id, u.username AS owner_name,
                (SELECT count(*)::int FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS track_count,
                (SELECT COALESCE(SUM(t.duration_seconds), 0)::int FROM playlist_tracks pt
                   JOIN tracks t ON t.id = pt.track_id WHERE pt.playlist_id = p.id) AS duration_seconds,
                p.cover_path IS NOT NULL AS has_cover,
                (SELECT pt.track_id FROM playlist_tracks pt
                   JOIN tracks t ON t.id = pt.track_id JOIN albums a ON a.id = t.album_id
                   WHERE pt.playlist_id = p.id AND a.cover_path IS NOT NULL
                   ORDER BY pt.position LIMIT 1) AS cover_track_id,
                p.created_at, p.updated_at
         FROM playlists p JOIN users u ON u.id = p.user_id",
    )
}

pub async fn fetch(db: &PgPool, mut query: QueryBuilder<Postgres>) -> AppResult<Vec<PlaylistDto>> {
    Ok(query.build_query_as().fetch_all(db).await?)
}

async fn summary(db: &PgPool, id: Uuid) -> AppResult<PlaylistDto> {
    let mut query = select();
    query.push(" WHERE p.id = ").push_bind(id);
    fetch(db, query).await?.into_iter().next().ok_or_else(|| AppError::not_found("Playlist not found."))
}

pub async fn own(db: &PgPool, user: Uuid) -> AppResult<Vec<PlaylistDto>> {
    let mut query = select();
    query.push(" WHERE p.user_id = ").push_bind(user).push(" ORDER BY p.name");
    fetch(db, query).await
}

pub async fn public(db: &PgPool) -> AppResult<Vec<PlaylistDto>> {
    let mut query = select();
    query.push(" WHERE p.is_public ORDER BY p.updated_at DESC");
    fetch(db, query).await
}

pub async fn detail(db: &PgPool, user: Uuid, id: Uuid) -> AppResult<PlaylistDetailDto> {
    let playlist = sqlx::query!(
        r#"SELECT p.id, p.name, p.description, p.is_public, p.user_id, u.username, p.cover_path, p.created_at, p.updated_at
           FROM playlists p JOIN users u ON u.id = p.user_id
           WHERE p.id = $1 AND (p.user_id = $2 OR p.is_public)"#,
        id,
        user
    )
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::not_found("Playlist not found."))?;

    let mut query = tracks::select(user);
    query.push(" JOIN playlist_tracks pt ON pt.track_id = t.id WHERE pt.playlist_id = ").push_bind(id);
    query.push(" ORDER BY pt.position");
    let tracks = tracks::fetch(db, query).await?;

    Ok(PlaylistDetailDto {
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        is_public: playlist.is_public,
        owner_id: playlist.user_id,
        owner_name: playlist.username,
        duration_seconds: tracks.iter().map(|t| t.duration_seconds).sum(),
        has_cover: playlist.cover_path.is_some(),
        cover_track_id: tracks.iter().find(|t| t.has_cover).map(|t| t.id),
        created_at: playlist.created_at,
        updated_at: playlist.updated_at,
        tracks,
    })
}

fn trim_to_none(value: Option<&str>) -> Option<String> {
    value.map(str::trim).filter(|v| !v.is_empty()).map(str::to_owned)
}

pub async fn create(db: &PgPool, user: Uuid, request: PlaylistRequest) -> AppResult<PlaylistDto> {
    let id = Uuid::now_v7();
    let now = Utc::now();
    sqlx::query!(
        "INSERT INTO playlists (id, user_id, name, description, is_public, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)",
        id,
        user,
        request.name.trim(),
        trim_to_none(request.description.as_deref()),
        request.is_public,
        now
    )
    .execute(db)
    .await?;
    summary(db, id).await
}

pub async fn update(db: &PgPool, user: Uuid, id: Uuid, request: PlaylistRequest) -> AppResult<PlaylistDto> {
    let updated = sqlx::query!(
        "UPDATE playlists SET name = $3, description = $4, is_public = $5, updated_at = $6 WHERE id = $1 AND user_id = $2",
        id,
        user,
        request.name.trim(),
        trim_to_none(request.description.as_deref()),
        request.is_public,
        Utc::now()
    )
    .execute(db)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::not_found("Playlist not found."));
    }
    summary(db, id).await
}

pub async fn delete(db: &PgPool, storage: &Storage, user: Uuid, id: Uuid) -> AppResult<()> {
    let deleted = sqlx::query!("DELETE FROM playlists WHERE id = $1 AND user_id = $2 RETURNING cover_path", id, user)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::not_found("Playlist not found."))?;
    if let Some(cover) = deleted.cover_path {
        storage.delete_cover(&cover);
    }
    Ok(())
}

async fn require_owned(conn: &mut sqlx::PgConnection, user: Uuid, id: Uuid) -> AppResult<()> {
    sqlx::query!("SELECT id FROM playlists WHERE id = $1 AND user_id = $2 FOR UPDATE", id, user)
        .fetch_optional(&mut *conn)
        .await?
        .map(|_| ())
        .ok_or_else(|| AppError::not_found("Playlist not found."))
}

async fn touch(conn: &mut sqlx::PgConnection, id: Uuid) -> AppResult<()> {
    sqlx::query!("UPDATE playlists SET updated_at = $2 WHERE id = $1", id, Utc::now()).execute(&mut *conn).await?;
    Ok(())
}

async fn renumber(conn: &mut sqlx::PgConnection, id: Uuid) -> AppResult<()> {
    sqlx::query!(
        "UPDATE playlist_tracks pt SET position = ranked.position
         FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY position, id) - 1 AS position
               FROM playlist_tracks WHERE playlist_id = $1) ranked
         WHERE pt.id = ranked.id AND pt.position <> ranked.position",
        id
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

fn distinct(ids: &[Uuid]) -> Vec<Uuid> {
    let mut wanted = Vec::with_capacity(ids.len());
    for id in ids {
        if !wanted.contains(id) {
            wanted.push(*id);
        }
    }
    wanted
}

pub async fn add_tracks(db: &PgPool, user: Uuid, id: Uuid, track_ids: &[Uuid]) -> AppResult<()> {
    let wanted = distinct(track_ids);
    let mut tx = db.begin().await?;
    require_owned(&mut tx, user, id).await?;
    if wanted.is_empty() {
        return Err(AppError::validation("At least one track id is required."));
    }

    let known = sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM tracks WHERE id = ANY($1)"#, &wanted)
        .fetch_one(&mut *tx)
        .await?;
    if usize::try_from(known).unwrap_or(0) != wanted.len() {
        return Err(AppError::not_found("Track not found."));
    }

    let row_ids: Vec<Uuid> = wanted.iter().map(|_| Uuid::now_v7()).collect();
    let inserted = sqlx::query!(
        "INSERT INTO playlist_tracks (id, playlist_id, track_id, position)
         SELECT added.id, $1, added.track_id,
                (SELECT COALESCE(MAX(position), -1) FROM playlist_tracks WHERE playlist_id = $1) + added.ordinality
         FROM unnest($2::uuid[], $3::uuid[]) WITH ORDINALITY AS added(track_id, id, ordinality)
         ON CONFLICT (playlist_id, track_id) DO NOTHING",
        id,
        &wanted,
        &row_ids
    )
    .execute(&mut *tx)
    .await?;

    if usize::try_from(inserted.rows_affected()).unwrap_or(0) < wanted.len() {
        renumber(&mut tx, id).await?;
    }
    touch(&mut tx, id).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn remove_track(db: &PgPool, user: Uuid, id: Uuid, track_id: Uuid) -> AppResult<()> {
    let mut tx = db.begin().await?;
    require_owned(&mut tx, user, id).await?;
    let removed = sqlx::query!("DELETE FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2", id, track_id)
        .execute(&mut *tx)
        .await?;
    if removed.rows_affected() == 0 {
        return Err(AppError::not_found("The track is not in this playlist."));
    }
    renumber(&mut tx, id).await?;
    touch(&mut tx, id).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn reorder(db: &PgPool, user: Uuid, id: Uuid, track_ids: &[Uuid]) -> AppResult<()> {
    let wanted = distinct(track_ids);
    let mut tx = db.begin().await?;
    require_owned(&mut tx, user, id).await?;

    if !wanted.is_empty() {
        sqlx::query!(
            "UPDATE playlist_tracks pt SET position = ordered.position
             FROM (
                 SELECT pt.id,
                        ROW_NUMBER() OVER (ORDER BY COALESCE(wanted.ordinality, 2147483647), pt.position, pt.id) - 1
                            AS position
                 FROM playlist_tracks pt
                 LEFT JOIN unnest($2::uuid[]) WITH ORDINALITY AS wanted(track_id, ordinality)
                        ON wanted.track_id = pt.track_id
                 WHERE pt.playlist_id = $1
             ) ordered
             WHERE pt.id = ordered.id AND pt.position <> ordered.position",
            id,
            &wanted
        )
        .execute(&mut *tx)
        .await?;
    }
    touch(&mut tx, id).await?;
    tx.commit().await?;
    Ok(())
}
