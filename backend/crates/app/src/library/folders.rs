// SPDX-License-Identifier: AGPL-3.0-only
use super::collection::Kind;
use crate::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgConnection};
use uuid::Uuid;

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: Uuid,
    pub name: String,
    pub parent_id: Option<Uuid>,
    #[serde(serialize_with = "crate::json::time")]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Change {
    Create { id: Uuid, name: String, folder_id: Option<Uuid> },
    Rename { id: Uuid, name: String },
    MoveFolder { id: Uuid, folder_id: Option<Uuid> },
    Delete { id: Uuid },
    MoveItem { id: Uuid, kind: Kind, folder_id: Option<Uuid> },
}

pub async fn list<'e>(db: impl sqlx::PgExecutor<'e>, user: Uuid) -> AppResult<Vec<Folder>> {
    Ok(sqlx::query_as(
        "SELECT id,name,parent_id,created_at FROM library_folders WHERE user_id=$1 ORDER BY created_at DESC,id",
    )
    .bind(user)
    .fetch_all(db)
    .await?)
}

fn name(value: &str) -> AppResult<&str> {
    let value = value.trim();
    if !(1..=200).contains(&value.chars().count()) {
        return Err(AppError::validation("Folder name must contain 1 to 200 characters."));
    }
    Ok(value)
}

async fn parent(db: &mut PgConnection, user: Uuid, id: Uuid) -> AppResult<Option<Uuid>> {
    sqlx::query_scalar("SELECT parent_id FROM library_folders WHERE user_id=$1 AND id=$2")
        .bind(user)
        .bind(id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::not_found("Library folder not found."))
}

async fn destination(db: &mut PgConnection, user: Uuid, folder: Option<Uuid>, moving: Option<Uuid>) -> AppResult<()> {
    let mut cursor = folder;
    while let Some(id) = cursor {
        if Some(id) == moving {
            return Err(AppError::validation("A folder cannot be moved inside itself or its descendants."));
        }
        cursor = parent(db, user, id).await?;
    }
    Ok(())
}

/// Call inside a transaction. The same per-account lock as offline actions
/// prevents simultaneous moves from forming a cycle or racing with deletion.
pub async fn apply(db: &mut PgConnection, user: Uuid, change: &Change, at: DateTime<Utc>) -> AppResult<()> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 6))")
        .bind(user.to_string())
        .execute(&mut *db)
        .await?;
    match change {
        Change::Create { id, name: value, folder_id } => {
            let value = name(value)?;
            destination(db, user, *folder_id, Some(*id)).await?;
            let created = sqlx::query("INSERT INTO library_folders(id,user_id,name,parent_id,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING")
                .bind(id).bind(user).bind(value).bind(folder_id).bind(at).execute(&mut *db).await?;
            if created.rows_affected() == 0 {
                return Err(AppError::conflict("Folder identifier already exists."));
            }
        }
        Change::Rename { id, name: value } => {
            parent(db, user, *id).await?;
            sqlx::query("UPDATE library_folders SET name=$3 WHERE user_id=$1 AND id=$2")
                .bind(user)
                .bind(id)
                .bind(name(value)?)
                .execute(&mut *db)
                .await?;
        }
        Change::MoveFolder { id, folder_id } => {
            parent(db, user, *id).await?;
            destination(db, user, *folder_id, Some(*id)).await?;
            sqlx::query("UPDATE library_folders SET parent_id=$3 WHERE user_id=$1 AND id=$2")
                .bind(user)
                .bind(id)
                .bind(folder_id)
                .execute(&mut *db)
                .await?;
        }
        Change::Delete { id } => {
            let current: Option<Option<Uuid>> =
                sqlx::query_scalar("SELECT parent_id FROM library_folders WHERE user_id=$1 AND id=$2")
                    .bind(user)
                    .bind(id)
                    .fetch_optional(&mut *db)
                    .await?;
            if let Some(up) = current {
                sqlx::query("UPDATE library_items SET folder_id=$3 WHERE user_id=$1 AND folder_id=$2")
                    .bind(user)
                    .bind(id)
                    .bind(up)
                    .execute(&mut *db)
                    .await?;
                sqlx::query("UPDATE library_folders SET parent_id=$3 WHERE user_id=$1 AND parent_id=$2")
                    .bind(user)
                    .bind(id)
                    .bind(up)
                    .execute(&mut *db)
                    .await?;
                sqlx::query("DELETE FROM library_folders WHERE user_id=$1 AND id=$2")
                    .bind(user)
                    .bind(id)
                    .execute(&mut *db)
                    .await?;
            }
        }
        Change::MoveItem { id, kind, folder_id } => {
            destination(db, user, *folder_id, None).await?;
            let sql = match kind {
                Kind::Album => "UPDATE library_items SET folder_id=$3 WHERE user_id=$1 AND album_id=$2",
                Kind::Artist => "UPDATE library_items SET folder_id=$3 WHERE user_id=$1 AND artist_id=$2",
                Kind::Playlist => {
                    "UPDATE library_items l SET folder_id=$3 WHERE user_id=$1 AND playlist_id=$2 AND EXISTS(SELECT 1 FROM playlists p WHERE p.id=$2 AND (p.user_id=$1 OR p.is_public))"
                }
            };
            if sqlx::query(sql).bind(user).bind(id).bind(folder_id).execute(db).await?.rows_affected() == 0 {
                return Err(AppError::not_found("Saved library item not found."));
            }
        }
    }
    Ok(())
}
