// SPDX-License-Identifier: AGPL-3.0-only

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use sqlx::types::Json;
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::catalog::dto::TrackDto;
use crate::catalog::tracks;
use crate::ids::distinct;
use crate::storage::Storage;
use crate::{AppError, AppResult, json};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistCoverTrack {
    pub id: Uuid,
    pub title: String,
    pub album_id: Option<Uuid>,
    pub album_title: Option<String>,
    pub has_cover: bool,
}

pub(super) const COVER_TRACKS_SQL: &str = "
    ARRAY(SELECT jsonb_build_object('id', cover.track_id, 'title', cover.title, 'albumId', cover.album_id,
                 'albumTitle', cover.album_title, 'hasCover', true)
          FROM (SELECT DISTINCT ON (a.id) pt.track_id, t.title, a.id AS album_id, a.title AS album_title,
                       pt.position, pt.id AS entry_id
                FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id JOIN albums a ON a.id = t.album_id
                WHERE pt.playlist_id = p.id AND a.cover_path IS NOT NULL
                ORDER BY a.id, pt.position, pt.id) AS cover
          ORDER BY cover.position, cover.entry_id LIMIT 4)";

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
    pub cover_tracks: Vec<Json<PlaylistCoverTrack>>,
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
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub track_added_at: BTreeMap<Uuid, DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistRequest {
    pub name: String,
    pub description: Option<String>,
    #[serde(default)]
    pub is_public: bool,
}

impl PlaylistRequest {
    fn validate(&self) -> AppResult<()> {
        if !(1..=200).contains(&self.name.trim().chars().count()) {
            return Err(AppError::validation("The playlist name must contain 1 to 200 characters."));
        }
        if self.description.as_deref().is_some_and(|text| text.trim().chars().count() > 1000) {
            return Err(AppError::validation("The playlist description must not exceed 1000 characters."));
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackIdsRequest {
    pub track_ids: Vec<Uuid>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MembershipChange {
    pub track_ids: Vec<Uuid>,
    pub present: bool,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistMembership {
    #[sqlx(flatten)]
    pub playlist: PlaylistDto,
    pub contains_track: bool,
}

#[derive(Debug, Default, Serialize)]
pub struct MembershipResult {
    pub changed: usize,
    pub unchanged: usize,
}

pub fn select() -> QueryBuilder<Postgres> {
    select_with("")
}

fn select_with(extra_columns: &str) -> QueryBuilder<Postgres> {
    QueryBuilder::new(format!(
        "SELECT p.id, p.name, p.description, p.is_public, p.user_id AS owner_id, u.username AS owner_name,
                (SELECT count(*)::int FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS track_count,
                (SELECT COALESCE(SUM(t.duration_seconds), 0)::int FROM playlist_tracks pt
                   JOIN tracks t ON t.id = pt.track_id WHERE pt.playlist_id = p.id) AS duration_seconds,
                p.cover_path IS NOT NULL AS has_cover,
                (SELECT pt.track_id FROM playlist_tracks pt
                   JOIN tracks t ON t.id = pt.track_id JOIN albums a ON a.id = t.album_id
                   WHERE pt.playlist_id = p.id AND a.cover_path IS NOT NULL
                   ORDER BY pt.position, pt.id LIMIT 1) AS cover_track_id,
                {COVER_TRACKS_SQL} AS cover_tracks,
                p.created_at, p.updated_at{extra_columns}
         FROM playlists p JOIN users u ON u.id = p.user_id",
    ))
}

pub async fn fetch<'e>(
    db: impl sqlx::PgExecutor<'e>,
    mut query: QueryBuilder<Postgres>,
) -> AppResult<Vec<PlaylistDto>> {
    Ok(query.build_query_as().fetch_all(db).await?)
}

async fn summary(db: &PgPool, user: Uuid, id: Uuid) -> AppResult<PlaylistDto> {
    let mut query = select();
    query.push(" WHERE p.id = ").push_bind(id).push(" AND p.user_id = ").push_bind(user);
    fetch(db, query).await?.into_iter().next().ok_or_else(|| AppError::not_found("Playlist not found."))
}

pub async fn own(db: &PgPool, user: Uuid) -> AppResult<Vec<PlaylistDto>> {
    let mut query = select();
    query.push(" WHERE p.user_id = ").push_bind(user).push(" ORDER BY p.name");
    fetch(db, query).await
}

pub async fn memberships(db: &PgPool, user: Uuid, track: Uuid) -> AppResult<Vec<PlaylistMembership>> {
    let mut query = select_with(", member.track_id IS NOT NULL AS contains_track");
    query
        .push(" LEFT JOIN playlist_tracks member ON member.playlist_id = p.id AND member.track_id = ")
        .push_bind(track)
        .push(" WHERE p.user_id = ")
        .push_bind(user)
        .push(" ORDER BY p.name, p.id");
    Ok(query.build_query_as().fetch_all(db).await?)
}

pub async fn public(db: &PgPool) -> AppResult<Vec<PlaylistDto>> {
    let mut query = select();
    query.push(" WHERE p.is_public ORDER BY p.updated_at DESC");
    fetch(db, query).await
}

pub async fn detail(db: &PgPool, user: Uuid, id: Uuid) -> AppResult<PlaylistDetailDto> {
    let mut tx = db.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY").execute(&mut *tx).await?;
    let playlist = sqlx::query!(
        r#"SELECT p.id, p.name, p.description, p.is_public, p.user_id, u.username, p.cover_path, p.created_at, p.updated_at
           FROM playlists p JOIN users u ON u.id = p.user_id
           WHERE p.id = $1 AND (p.user_id = $2 OR p.is_public)"#,
        id,
        user
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::not_found("Playlist not found."))?;

    let mut query = tracks::select(user);
    query.push(" JOIN playlist_tracks pt ON pt.track_id = t.id WHERE pt.playlist_id = ").push_bind(id);
    query.push(" ORDER BY pt.position, pt.id");
    let tracks = tracks::fetch(&mut *tx, query).await?;
    let dates: Vec<(Uuid, DateTime<Utc>)> = sqlx::query_as(
        "SELECT track_id, added_at FROM playlist_tracks WHERE playlist_id = $1 AND added_at IS NOT NULL",
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;

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
        track_added_at: dates.into_iter().collect(),
    })
}

fn trim_to_none(value: Option<&str>) -> Option<String> {
    value.map(str::trim).filter(|v| !v.is_empty()).map(str::to_owned)
}

pub async fn create(db: &PgPool, user: Uuid, request: PlaylistRequest) -> AppResult<PlaylistDto> {
    create_with_tracks(db, user, request, &[]).await
}

pub async fn create_with_tracks(
    db: &PgPool,
    user: Uuid,
    request: PlaylistRequest,
    track_ids: &[Uuid],
) -> AppResult<PlaylistDto> {
    create_with_tracks_once(db, user, request, track_ids, None).await
}

pub async fn create_with_tracks_once(
    db: &PgPool,
    user: Uuid,
    request: PlaylistRequest,
    track_ids: &[Uuid],
    request_id: Option<Uuid>,
) -> AppResult<PlaylistDto> {
    request.validate()?;
    let id = request_id.unwrap_or_else(Uuid::now_v7);
    let now = Utc::now();
    let mut tx = db.begin().await?;
    if request_id.is_some() && !claim_creation(&mut tx, user, id).await? {
        tx.commit().await?;
        return summary(db, user, id).await;
    }
    let created = sqlx::query!(
        "INSERT INTO playlists (id, user_id, name, description, is_public, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)",
        id,
        user,
        request.name.trim(),
        trim_to_none(request.description.as_deref()),
        request.is_public,
        now
    )
    .execute(&mut *tx)
    .await;
    if matches!(&created, Err(sqlx::Error::Database(error)) if error.is_unique_violation()) {
        return Err(AppError::conflict("Playlist identifier already exists."));
    }
    created?;
    let wanted = distinct(track_ids.iter().copied());
    add_tracks_to_row(&mut tx, id, &wanted, now, true).await?;
    tx.commit().await?;
    summary(db, user, id).await
}

pub(crate) async fn claim_creation(conn: &mut sqlx::PgConnection, user: Uuid, id: Uuid) -> AppResult<bool> {
    let claimed = sqlx::query(
        "INSERT INTO playlist_creation_requests (user_id, request_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(user)
    .bind(id)
    .execute(conn)
    .await?;
    Ok(claimed.rows_affected() > 0)
}

pub async fn update(db: &PgPool, user: Uuid, id: Uuid, request: PlaylistRequest) -> AppResult<PlaylistDto> {
    request.validate()?;
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
    summary(db, user, id).await
}

pub async fn delete(db: &PgPool, storage: &Storage, user: Uuid, id: Uuid) -> AppResult<()> {
    let mut tx = db.begin().await?;
    let deleted = delete_row(&mut tx, user, id).await?.ok_or_else(|| AppError::not_found("Playlist not found."))?;
    tx.commit().await?;
    deleted.cleanup(storage);
    Ok(())
}

pub(crate) struct DeletedPlaylist {
    cover_path: Option<String>,
}

impl DeletedPlaylist {
    pub(crate) fn cleanup(self, storage: &Storage) {
        if let Some(cover) = self.cover_path {
            storage.delete_cover(&cover);
        }
    }
}

pub(crate) async fn delete_row(
    conn: &mut sqlx::PgConnection,
    user: Uuid,
    id: Uuid,
) -> AppResult<Option<DeletedPlaylist>> {
    let deleted = sqlx::query!("DELETE FROM playlists WHERE id = $1 AND user_id = $2 RETURNING cover_path", id, user)
        .fetch_optional(conn)
        .await?;
    Ok(deleted.map(|row| DeletedPlaylist { cover_path: row.cover_path }))
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

pub async fn add_tracks(db: &PgPool, user: Uuid, id: Uuid, track_ids: &[Uuid]) -> AppResult<()> {
    change_membership(db, user, id, MembershipChange { track_ids: track_ids.to_vec(), present: true }).await?;
    Ok(())
}

pub async fn change_membership(
    db: &PgPool,
    user: Uuid,
    id: Uuid,
    change: MembershipChange,
) -> AppResult<MembershipResult> {
    let wanted = distinct(change.track_ids);
    if wanted.is_empty() {
        return Err(AppError::validation("At least one track id is required."));
    }
    let mut tx = db.begin().await?;
    require_owned(&mut tx, user, id).await?;
    let changed = if change.present {
        add_tracks_to_row(&mut tx, id, &wanted, Utc::now(), true).await?
    } else {
        remove_tracks_from_row(&mut tx, id, &wanted).await?
    };
    if changed > 0 {
        touch(&mut tx, id).await?;
    }
    tx.commit().await?;
    Ok(MembershipResult { changed, unchanged: wanted.len() - changed })
}

pub async fn track_ids(db: impl sqlx::PgExecutor<'_>, user: Uuid, id: Uuid) -> AppResult<Vec<Uuid>> {
    sqlx::query_scalar(
        "SELECT ARRAY(SELECT track_id FROM playlist_tracks WHERE playlist_id = p.id ORDER BY position, id)
         FROM playlists p WHERE p.id = $1 AND (p.user_id = $2 OR p.is_public)",
    )
    .bind(id)
    .bind(user)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::not_found("Playlist not found."))
}

pub async fn copy_tracks(db: &PgPool, user: Uuid, source: Uuid, destination: Uuid) -> AppResult<MembershipResult> {
    let mut tx = db.begin().await?;
    require_owned(&mut tx, user, destination).await?;
    let wanted = track_ids(&mut *tx, user, source).await?;
    let changed = add_tracks_to_row(&mut tx, destination, &wanted, Utc::now(), true).await?;
    if changed > 0 {
        touch(&mut tx, destination).await?;
    }
    tx.commit().await?;
    Ok(MembershipResult { changed, unchanged: wanted.len() - changed })
}

pub(crate) async fn add_tracks_to_row(
    conn: &mut sqlx::PgConnection,
    id: Uuid,
    track_ids: &[Uuid],
    added_at: DateTime<Utc>,
    require_all: bool,
) -> AppResult<usize> {
    if track_ids.is_empty() {
        return Ok(0);
    }

    if require_all {
        let known = sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM tracks WHERE id = ANY($1)"#, track_ids)
            .fetch_one(&mut *conn)
            .await?;
        if usize::try_from(known).unwrap_or(0) != track_ids.len() {
            return Err(AppError::not_found("Track not found."));
        }
    }

    let inserted = sqlx::query(
        "INSERT INTO playlist_tracks (id, playlist_id, track_id, position, added_at)
         SELECT gen_random_uuid(), $1, t.id,
                (SELECT COALESCE(MAX(position), -1) FROM playlist_tracks WHERE playlist_id = $1)
                    + row_number() OVER (ORDER BY wanted.ordinality), $3
         FROM unnest($2::uuid[]) WITH ORDINALITY AS wanted(track_id, ordinality)
         JOIN tracks t ON t.id = wanted.track_id
         WHERE NOT EXISTS (SELECT 1 FROM playlist_tracks WHERE playlist_id = $1 AND track_id = t.id)
         ON CONFLICT (playlist_id, track_id) DO NOTHING",
    )
    .bind(id)
    .bind(track_ids)
    .bind(added_at)
    .execute(&mut *conn)
    .await?;
    Ok(usize::try_from(inserted.rows_affected()).unwrap_or(0))
}

pub(crate) async fn remove_tracks_from_row(
    conn: &mut sqlx::PgConnection,
    id: Uuid,
    track_ids: &[Uuid],
) -> AppResult<usize> {
    let removed = sqlx::query("DELETE FROM playlist_tracks WHERE playlist_id = $1 AND track_id = ANY($2)")
        .bind(id)
        .bind(track_ids)
        .execute(&mut *conn)
        .await?;
    if removed.rows_affected() > 0 {
        renumber(conn, id).await?;
    }
    Ok(usize::try_from(removed.rows_affected()).unwrap_or(0))
}

pub async fn remove_track(db: &PgPool, user: Uuid, id: Uuid, track_id: Uuid) -> AppResult<()> {
    let result =
        change_membership(db, user, id, MembershipChange { track_ids: vec![track_id], present: false }).await?;
    if result.changed == 0 {
        return Err(AppError::not_found("The track is not in this playlist."));
    }
    Ok(())
}

pub async fn reorder(db: &PgPool, user: Uuid, id: Uuid, track_ids: &[Uuid]) -> AppResult<()> {
    let wanted = distinct(track_ids.iter().copied());
    let mut tx = db.begin().await?;
    require_owned(&mut tx, user, id).await?;
    reorder_rows(&mut tx, id, &wanted).await?;
    touch(&mut tx, id).await?;
    tx.commit().await?;
    Ok(())
}

pub(crate) async fn reorder_rows(conn: &mut sqlx::PgConnection, id: Uuid, track_ids: &[Uuid]) -> AppResult<()> {
    if !track_ids.is_empty() {
        // Keep new entries after the requested order and skip entries removed in the meantime.
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
            track_ids
        )
        .execute(conn)
        .await?;
    }
    Ok(())
}
