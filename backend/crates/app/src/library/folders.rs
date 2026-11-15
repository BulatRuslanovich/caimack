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
    Reorder { folder_id: Option<Uuid>, order: Vec<String> },
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

pub async fn order<'e>(
    db: impl sqlx::PgExecutor<'e>,
    user: Uuid,
) -> AppResult<std::collections::BTreeMap<String, Vec<String>>> {
    let rows: Vec<(String, sqlx::types::Json<Vec<String>>)> =
        sqlx::query_as("SELECT scope,item_keys FROM library_order WHERE user_id=$1").bind(user).fetch_all(db).await?;
    Ok(rows.into_iter().map(|(scope, keys)| (scope, keys.0)).collect())
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
        Change::Reorder { folder_id, order } => {
            destination(db, user, *folder_id, None).await?;
            if order.len() > 10000 || order.iter().collect::<std::collections::HashSet<_>>().len() != order.len() {
                return Err(AppError::validation("Invalid library order."));
            }
            let mut allowed = std::collections::HashSet::new();
            for item in super::collection::list(&mut *db, user).await? {
                if item.folder_id == *folder_id {
                    allowed.insert(format!("{}:{}", item.kind, item.id));
                }
            }
            for folder in list(&mut *db, user).await? {
                if folder.parent_id == *folder_id {
                    allowed.insert(format!("folder:{}", folder.id));
                }
            }
            if folder_id.is_none() {
                allowed.extend(["favorites".to_owned(), "downloads".to_owned()]);
            }
            if order.iter().any(|key| !allowed.contains(key)) {
                return Err(AppError::validation("Order must contain only entries from this library folder."));
            }
            let scope = folder_id.map(|id| id.to_string()).unwrap_or_else(|| "root".into());
            sqlx::query("INSERT INTO library_order(user_id,scope,item_keys) VALUES($1,$2,$3) ON CONFLICT(user_id,scope) DO UPDATE SET item_keys=excluded.item_keys")
                .bind(user).bind(scope).bind(sqlx::types::Json(order)).execute(&mut *db).await?;
        }
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
                sqlx::query("DELETE FROM library_order WHERE user_id=$1 AND scope=$2")
                    .bind(user)
                    .bind(id.to_string())
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
