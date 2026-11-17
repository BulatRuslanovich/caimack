// SPDX-License-Identifier: AGPL-3.0-only

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

#[sqlx::test(migrations = "../../../db/migrations")]
async fn batched_playback_events_preserve_validation_limits_and_normalized_fields(db: PgPool) -> anyhow::Result<()> {
    use app::playback::signals::{self, RecordEventsRequest, RecordEventsResult};

    let (user, track) = song(&db, 180).await?;
    let reported: Vec<_> = (0..105)
        .map(|position| {
            serde_json::json!({
                "type":"trackCompleted",
                "trackId": if position == 99 { Uuid::now_v7() } else { track },
                "positionSeconds":position,
                "listenedSeconds":100_000,
                "durationSeconds":-1,
                "sessionId":Uuid::now_v7(),
                "source":" radio "
            })
        })
        .collect();
    let request: RecordEventsRequest = serde_json::from_value(serde_json::json!({"events":reported}))?;
    assert_eq!(signals::record(&db, user, request).await?, RecordEventsResult { accepted: 99, rejected: 6 });
    let row: (i64, i32, i32, i64, i64, i64) = sqlx::query_as(
        "SELECT count(*),min(position_seconds),max(position_seconds),sum(listened_seconds),
            sum(duration_seconds),count(DISTINCT session_id)
         FROM playback_events WHERE user_id=$1 AND track_id=$2 AND type=3 AND source='radio'",
    )
    .bind(user)
    .bind(track)
    .fetch_one(&db)
    .await?;
    assert_eq!(row, (99, 0, 98, 99 * 86_400, 0, 99));
    let empty = serde_json::from_value(serde_json::json!({"events":[]}))?;
    assert_eq!(signals::record(&db, user, empty).await?, RecordEventsResult { accepted: 0, rejected: 0 });
    Ok(())
}
