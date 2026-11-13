// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use crate::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgConnection};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Album,
    Artist,
    Playlist,
}
#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem {
    pub kind: String,
    pub id: Uuid,
    pub title: String,
    pub subtitle: String,
    pub has_image: bool,
    pub cover_track_id: Option<Uuid>,
    pub folder_id: Option<Uuid>,
    #[serde(serialize_with = "crate::json::time")]
    pub saved_at: DateTime<Utc>,
}

pub async fn list<'e>(db: impl sqlx::PgExecutor<'e>, user: Uuid) -> AppResult<Vec<LibraryItem>> {
    Ok(sqlx::query_as(
        "SELECT 'album' AS kind, a.id, a.title, ar.name AS subtitle,
        a.cover_path IS NOT NULL AS has_image, NULL::uuid AS cover_track_id, l.folder_id, l.saved_at
        FROM library_items l JOIN albums a ON a.id=l.album_id JOIN artists ar ON ar.id=a.artist_id WHERE l.user_id=$1
        UNION ALL SELECT 'artist', a.id, a.name, '', a.image_path IS NOT NULL, NULL::uuid, l.folder_id, l.saved_at
        FROM library_items l JOIN artists a ON a.id=l.artist_id WHERE l.user_id=$1
        UNION ALL SELECT 'playlist', p.id, p.name, u.username, p.cover_path IS NOT NULL,
        (SELECT pt.track_id FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id
         JOIN albums a ON a.id=t.album_id WHERE pt.playlist_id=p.id AND a.cover_path IS NOT NULL
         ORDER BY pt.position LIMIT 1), l.folder_id, l.saved_at
        FROM library_items l JOIN playlists p ON p.id=l.playlist_id JOIN users u ON u.id=p.user_id
        WHERE l.user_id=$1 AND (p.user_id=$1 OR p.is_public)
        ORDER BY saved_at DESC, kind, id",
    )
    .bind(user)
    .fetch_all(db)
    .await?)
}

/// INSERT ... SELECT checks visibility in the same statement as the write.
pub async fn save(db: &mut PgConnection, user: Uuid, kind: Kind, id: Uuid, at: DateTime<Utc>) -> AppResult<()> {
    let sql = match kind {
        Kind::Album => {
            "INSERT INTO library_items(user_id, album_id, saved_at) SELECT $1, id, $3 FROM albums WHERE id=$2 ON CONFLICT (user_id, album_id) DO UPDATE SET saved_at=library_items.saved_at"
        }
        Kind::Artist => {
            "INSERT INTO library_items(user_id, artist_id, saved_at) SELECT $1, id, $3 FROM artists WHERE id=$2 ON CONFLICT (user_id, artist_id) DO UPDATE SET saved_at=library_items.saved_at"
        }
        Kind::Playlist => {
            "INSERT INTO library_items(user_id, playlist_id, saved_at) SELECT $1, id, $3 FROM playlists WHERE id=$2 AND (user_id=$1 OR is_public) ON CONFLICT (user_id, playlist_id) DO UPDATE SET saved_at=library_items.saved_at"
        }
    };
    let result = sqlx::query(sql).bind(user).bind(id).bind(at).execute(db).await?;
    if result.rows_affected() == 0 {
        return Err(AppError::not_found("Library item not found."));
    }
    Ok(())
}

pub async fn remove(db: &mut PgConnection, user: Uuid, kind: Kind, id: Uuid) -> AppResult<()> {
    let sql = match kind {
        Kind::Album => "DELETE FROM library_items WHERE user_id=$1 AND album_id=$2",
        Kind::Artist => "DELETE FROM library_items WHERE user_id=$1 AND artist_id=$2",
        Kind::Playlist => "DELETE FROM library_items WHERE user_id=$1 AND playlist_id=$2",
    };
    sqlx::query(sql).bind(user).bind(id).execute(db).await?;
    Ok(())
}
