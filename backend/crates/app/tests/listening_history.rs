// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

#![cfg(feature = "integration-tests")]

use app::library::history::{self, RecordPlayRequest};
use sqlx::PgPool;
use uuid::Uuid;

async fn song(db: &PgPool, duration: i32) -> sqlx::Result<(Uuid, Uuid)> {
    let user = Uuid::now_v7();
    let artist = Uuid::now_v7();
    let track = Uuid::now_v7();
    sqlx::query("INSERT INTO users(id,username,password_hash,created_at) VALUES ($1,'alice','unused',now())")
        .bind(user)
        .execute(db)
        .await?;
    sqlx::query("INSERT INTO artists(id,name,normalized_name,created_at) VALUES ($1,'Artist','artist',now())")
        .bind(artist)
        .execute(db)
        .await?;
    sqlx::query(
        "INSERT INTO tracks(id,title,normalized_title,artist_id,duration_seconds,file_path,
        original_file_name,mime_type,file_size,content_hash,created_at)
        VALUES ($1,'Song','song',$2,$3,'song.mp3','song.mp3','audio/mpeg',1,'test',now())",
    )
    .bind(track)
    .bind(artist)
    .bind(duration)
    .execute(db)
    .await?;
    Ok((user, track))
}

fn request(track: Uuid, position: i32, listened: i32) -> serde_json::Result<RecordPlayRequest> {
    serde_json::from_value(
        serde_json::json!({"trackId": track, "playbackPosition": position, "listenedSeconds": listened}),
    )
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn seeking_past_the_threshold_does_not_create_a_listening_history_entry(db: PgPool) -> anyhow::Result<()> {
    let (user, track) = song(&db, 180).await?;
    assert!(matches!(history::record(&db, user, request(track, 60, 2)?).await, Err(app::AppError::Validation(_))));
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM listening_history").fetch_one(&db).await?;
    assert_eq!(count, 0);
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn listening_to_almost_all_of_a_short_track_is_recorded(db: PgPool) -> anyhow::Result<()> {
    let (user, track) = song(&db, 12).await?;
    history::record(&db, user, request(track, 11, 11)?).await?;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM listening_history").fetch_one(&db).await?;
    assert_eq!(count, 1);
    Ok(())
}
