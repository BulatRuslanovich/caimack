// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::playback::signals::{EventType, PlaybackEventRequest, normalize_source};
use crate::{AppError, AppResult};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    pub id: Uuid,
    pub kind: String,
    pub entity_id: Option<Uuid>,
    pub occurred_at: DateTime<Utc>,
    pub payload: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Batch {
    pub server_id: Uuid,
    pub user_id: Uuid,
    pub actions: Vec<Action>,
}

/// The effect and its receipt commit together. Retrying after a dropped HTTP
/// response cannot duplicate listening history or resurrect a deleted playlist.
pub async fn exchange(db: &PgPool, user: Uuid, batch: Batch) -> AppResult<Value> {
    if batch.actions.len() > 100 {
        return Err(AppError::validation("At most 100 sync actions are accepted per batch."));
    }
    let server: Uuid = sqlx::query_scalar("SELECT id FROM sync_identity").fetch_one(db).await?;
    if user != batch.user_id || server != batch.server_id {
        return Err(AppError::conflict("The offline library belongs to another account or server."));
    }
    let mut results = Vec::new();
    for action in batch.actions {
        let hash = super::hash(&serde_json::to_vec(&action).map_err(AppError::internal)?);
        let mut tx = db.begin().await?;
        // Also serialize the first insert; a receipt lookup alone cannot guard a
        // concurrent replay of an action whose transaction has not committed yet.
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 6))")
            .bind(user.to_string())
            .execute(&mut *tx)
            .await?;
        let prior: Option<(String, Value)> =
            sqlx::query_as("SELECT request_hash,result FROM sync_receipts WHERE user_id=$1 AND action_id=$2")
                .bind(user)
                .bind(action.id)
                .fetch_optional(&mut *tx)
                .await?;
        if let Some((prior_hash, result)) = prior {
            if prior_hash != hash {
                return Err(AppError::conflict("A sync action identifier was reused with different contents."));
            }
            results.push(result);
            tx.commit().await?;
            continue;
        }
        sqlx::query("SAVEPOINT sync_action").execute(&mut *tx).await?;
        let result = match apply(&mut tx, user, &action).await {
            Ok(()) => json!({"id":action.id,"status":"applied"}),
            Err(error) if error.status() < 500 => {
                sqlx::query("ROLLBACK TO SAVEPOINT sync_action").execute(&mut *tx).await?;
                json!({"id":action.id,"status":"rejected","message":error.to_string()})
            }
            Err(error) => return Err(error),
        };
        sqlx::query("INSERT INTO sync_receipts (user_id,action_id,request_hash,result) VALUES ($1,$2,$3,$4)")
            .bind(user)
            .bind(action.id)
            .bind(hash)
            .bind(&result)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        results.push(result);
    }
    Ok(json!({"results":results}))
}

fn invalid() -> AppError {
    AppError::validation("Invalid offline action.")
}
fn id(action: &Action) -> AppResult<Uuid> {
    action.entity_id.ok_or_else(invalid)
}
fn uuid(value: &Value) -> AppResult<Uuid> {
    value.as_str().and_then(|s| Uuid::parse_str(s).ok()).ok_or_else(invalid)
}
fn seconds(value: &Value) -> i32 {
    value.as_i64().unwrap_or_default().clamp(0, 86_400) as i32
}
fn time(action: &Action) -> DateTime<Utc> {
    action.occurred_at.clamp(DateTime::UNIX_EPOCH, Utc::now())
}

async fn owned(db: &mut PgConnection, user: Uuid, id: Uuid) -> AppResult<()> {
    let owner: Option<Uuid> =
        sqlx::query_scalar("SELECT user_id FROM playlists WHERE id=$1 FOR UPDATE").bind(id).fetch_optional(db).await?;
    match owner {
        None => Err(AppError::not_found("Playlist no longer exists.")),
        Some(owner) if owner != user => Err(AppError::forbidden("Only the playlist owner can edit it.")),
        Some(_) => Ok(()),
    }
}

async fn track_exists(db: &mut PgConnection, id: Uuid) -> AppResult<bool> {
    Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tracks WHERE id=$1)").bind(id).fetch_one(db).await?)
}

async fn apply(db: &mut PgConnection, user: Uuid, action: &Action) -> AppResult<()> {
    let p = &action.payload;
    match action.kind.as_str() {
        "libraryOrganize" => {
            let change = serde_json::from_value(p.clone()).map_err(|_| invalid())?;
            crate::library::folders::apply(db, user, &change, time(action)).await?;
        }
        "signal" => {
            let event: PlaybackEventRequest = serde_json::from_value(p.clone()).map_err(|_| invalid())?;
            let kind = event.kind.as_deref().and_then(EventType::parse).ok_or_else(invalid)?;
            let track = if kind.about_track() {
                let track = event.track_id.ok_or_else(invalid)?;
                if !track_exists(db, track).await? {
                    return Ok(());
                }
                Some(track)
            } else {
                None
            };
            let source = normalize_source(event.source.as_deref());
            if (kind == EventType::ShelfShown && source.is_none())
                || (matches!(kind, EventType::ArtistOpened | EventType::AlbumOpened) && event.entity_id.is_none())
            {
                return Err(invalid());
            }
            sqlx::query("INSERT INTO playback_events
                (id,user_id,track_id,entity_id,type,occurred_at,position_seconds,listened_seconds,duration_seconds,session_id,source)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
                .bind(Uuid::new_v4()).bind(user).bind(track).bind(event.entity_id).bind(kind as i32)
                .bind(time(action)).bind(event.position_seconds.unwrap_or_default().clamp(0,86_400))
                .bind(event.listened_seconds.unwrap_or_default().clamp(0,86_400))
                .bind(event.duration_seconds.unwrap_or_default().clamp(0,86_400))
                .bind(event.session_id.unwrap_or(Uuid::nil())).bind(source).execute(&mut *db).await?;
        }
        "history" => {
            let track = uuid(&p["trackId"])?;
            let duration: Option<i32> = sqlx::query_scalar("SELECT duration_seconds FROM tracks WHERE id=$1")
                .bind(track)
                .fetch_optional(&mut *db)
                .await?;
            if duration
                .is_some_and(|duration| seconds(&p["listenedSeconds"]) >= 30.min(duration.saturating_sub(1).max(1)))
            {
                sqlx::query(
                    "INSERT INTO listening_history (id,user_id,track_id,played_at,playback_position)
                    VALUES ($1,$2,$3,$4,$5)",
                )
                .bind(Uuid::new_v4())
                .bind(user)
                .bind(track)
                .bind(time(action))
                .bind(seconds(&p["playbackPosition"]))
                .execute(&mut *db)
                .await?;
            }
        }
        "library" => {
            let kind = serde_json::from_value(p["kind"].clone()).map_err(|_| invalid())?;
            if p["value"].as_bool().ok_or_else(invalid)? {
                crate::library::collection::save(db, user, kind, id(action)?, time(action)).await?;
            } else {
                crate::library::collection::remove(db, user, kind, id(action)?).await?;
            }
        }
        "favorite" => {
            let track = id(action)?;
            if !track_exists(db, track).await? {
                return Ok(());
            }
            if p["value"].as_bool().ok_or_else(invalid)? {
                sqlx::query(
                    "INSERT INTO favorites (user_id,track_id,created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
                )
                .bind(user)
                .bind(track)
                .bind(time(action))
                .execute(&mut *db)
                .await?;
            } else {
                sqlx::query("DELETE FROM favorites WHERE user_id=$1 AND track_id=$2")
                    .bind(user)
                    .bind(track)
                    .execute(&mut *db)
                    .await?;
            }
        }
        "playlistCreate" => {
            let playlist = id(action)?;
            let name = p["name"].as_str().ok_or_else(invalid)?.trim();
            let description = p["description"].as_str();
            validate_playlist(name, description)?;
            let created = sqlx::query(
                "INSERT INTO playlists (id,user_id,name,description,is_public,created_at,updated_at)
                VALUES ($1,$2,$3,$4,$5,$6,now()) ON CONFLICT(id) DO NOTHING",
            )
            .bind(playlist)
            .bind(user)
            .bind(name)
            .bind(description)
            .bind(p["isPublic"].as_bool().unwrap_or(false))
            .bind(time(action))
            .execute(&mut *db)
            .await?;
            if created.rows_affected() == 0 {
                return Err(AppError::conflict("Playlist identifier already exists."));
            }
        }
        "playlistUpdate" => {
            let playlist = id(action)?;
            owned(db, user, playlist).await?;
            // Send only fields edited locally. Concurrent edits to other fields
            // survive; for the same field the last accepted edit wins.
            if let Some(name) = p.get("name") {
                let name = name.as_str().ok_or_else(invalid)?.trim();
                validate_playlist(name, None)?;
                sqlx::query("UPDATE playlists SET name=$2 WHERE id=$1")
                    .bind(playlist)
                    .bind(name)
                    .execute(&mut *db)
                    .await?;
            }
            if let Some(description) = p.get("description") {
                let description =
                    if description.is_null() { None } else { Some(description.as_str().ok_or_else(invalid)?) };
                validate_playlist("valid", description)?;
                sqlx::query("UPDATE playlists SET description=$2 WHERE id=$1")
                    .bind(playlist)
                    .bind(description)
                    .execute(&mut *db)
                    .await?;
            }
            if let Some(public) = p.get("isPublic") {
                sqlx::query("UPDATE playlists SET is_public=$2 WHERE id=$1")
                    .bind(playlist)
                    .bind(public.as_bool().ok_or_else(invalid)?)
                    .execute(&mut *db)
                    .await?;
            }
            touch(db, playlist).await?;
        }
        "playlistDelete" => {
            let playlist = id(action)?;
            let owner: Option<Uuid> = sqlx::query_scalar("SELECT user_id FROM playlists WHERE id=$1 FOR UPDATE")
                .bind(playlist)
                .fetch_optional(&mut *db)
                .await?;
            if owner.is_some_and(|owner| owner != user) {
                return Err(AppError::forbidden("Only the playlist owner can edit it."));
            }
            sqlx::query("DELETE FROM playlists WHERE id=$1 AND user_id=$2")
                .bind(playlist)
                .bind(user)
                .execute(&mut *db)
                .await?;
        }
        "playlistAdd" | "playlistRemove" | "playlistOrder" => {
            let playlist = id(action)?;
            owned(db, user, playlist).await?;
            let mut ids = Vec::new();
            let values = p["trackIds"].as_array().filter(|a| a.len() <= 10_000).ok_or_else(invalid)?;
            for value in values {
                let id = uuid(value)?;
                if !ids.contains(&id) {
                    ids.push(id);
                }
            }
            match action.kind.as_str() {
                "playlistAdd" => {
                    sqlx::query("INSERT INTO playlist_tracks (id,playlist_id,track_id,position)
                        SELECT gen_random_uuid(),$1,t.id,COALESCE((SELECT max(position)+1 FROM playlist_tracks WHERE playlist_id=$1),0)
                            + (wanted.ordinality-1)::int
                        FROM unnest($2::uuid[]) WITH ORDINALITY wanted(id,ordinality) JOIN tracks t ON t.id=wanted.id
                        ON CONFLICT(playlist_id,track_id) DO NOTHING")
                        .bind(playlist).bind(&ids).execute(&mut *db).await?;
                }
                "playlistRemove" => {
                    sqlx::query("DELETE FROM playlist_tracks WHERE playlist_id=$1 AND track_id=ANY($2)")
                        .bind(playlist)
                        .bind(&ids)
                        .execute(&mut *db)
                        .await?;
                }
                _ => {
                    // Order the intersection, preserving concurrent additions.
                    // Tracks removed on the server are never reinserted by reorder.
                    sqlx::query("UPDATE playlist_tracks pt SET position=o.position FROM (
                        SELECT pt.id,(row_number() OVER (ORDER BY COALESCE(w.ordinality,2147483647),pt.position,pt.id)-1)::int AS position
                        FROM playlist_tracks pt LEFT JOIN unnest($2::uuid[]) WITH ORDINALITY w(id,ordinality) ON w.id=pt.track_id
                        WHERE pt.playlist_id=$1) o WHERE pt.id=o.id")
                        .bind(playlist).bind(&ids).execute(&mut *db).await?;
                }
            }
            touch(db, playlist).await?;
        }
        "tasteRule" => {
            let kind: i16 = match p["action"].as_str() {
                Some("block") => 1,
                Some("downrank") => 2,
                Some("cooldown") => 3,
                _ => return Err(invalid()),
            };
            let target: i16 = match p["targetType"].as_str() {
                Some("track") => 1,
                Some("artist") => 2,
                Some("album") => 3,
                Some("genre") => 4,
                _ => return Err(invalid()),
            };
            let target_id = uuid(&p["targetId"])?;
            let exists: bool = sqlx::query_scalar("SELECT CASE $1::int2
                WHEN 1 THEN EXISTS(SELECT 1 FROM tracks WHERE id=$2) WHEN 2 THEN EXISTS(SELECT 1 FROM artists WHERE id=$2)
                WHEN 3 THEN EXISTS(SELECT 1 FROM albums WHERE id=$2) ELSE EXISTS(SELECT 1 FROM genres WHERE id=$2) END")
                .bind(target).bind(target_id).fetch_one(&mut *db).await?;
            if !exists {
                return Ok(());
            }
            let days = p["days"].as_i64().unwrap_or(30);
            if !(1..=365).contains(&days) {
                return Err(invalid());
            }
            let until = (kind == 3).then(|| time(action) + chrono::Duration::days(days));
            sqlx::query(
                "INSERT INTO taste_rules (id,user_id,action,target_type,target_id,until,created_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,target_type,target_id) DO UPDATE SET
                action=EXCLUDED.action,until=EXCLUDED.until,created_at=EXCLUDED.created_at",
            )
            .bind(Uuid::new_v4())
            .bind(user)
            .bind(kind)
            .bind(target)
            .bind(target_id)
            .bind(until)
            .bind(time(action))
            .execute(&mut *db)
            .await?;
        }
        _ => return Err(invalid()),
    }
    Ok(())
}

async fn touch(db: &mut PgConnection, playlist: Uuid) -> AppResult<()> {
    sqlx::query("UPDATE playlists SET updated_at=now() WHERE id=$1").bind(playlist).execute(db).await?;
    Ok(())
}

fn validate_playlist(name: &str, description: Option<&str>) -> AppResult<()> {
    if !(1..=200).contains(&name.chars().count()) || description.is_some_and(|s| s.chars().count() > 1000) {
        return Err(invalid());
    }
    Ok(())
}
