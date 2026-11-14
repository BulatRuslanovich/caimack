// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

#![cfg(feature = "integration-tests")]

use app::sync::actions::{self, Action, Batch};
use chrono::{Duration, Utc};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

async fn fixture(db: &PgPool) -> anyhow::Result<(Uuid, Uuid, Vec<Uuid>)> {
    let user = Uuid::now_v7();
    let artist = Uuid::now_v7();
    sqlx::query("INSERT INTO users(id,username,password_hash,created_at) VALUES ($1,'offline','unused',now())")
        .bind(user)
        .execute(db)
        .await?;
    sqlx::query("INSERT INTO artists(id,name,normalized_name,created_at) VALUES ($1,'Artist','artist',now())")
        .bind(artist)
        .execute(db)
        .await?;
    let mut tracks = Vec::new();
    for n in 0..3 {
        let id = Uuid::now_v7();
        sqlx::query("INSERT INTO tracks(id,title,normalized_title,artist_id,duration_seconds,file_path,original_file_name,mime_type,file_size,content_hash,created_at)
            VALUES ($1,'Song','song',$2,12,$3,$3,'audio/mpeg',15,$4,now())")
            .bind(id).bind(artist).bind(format!("music/{n}.mp3")).bind(format!("hash{n}")).execute(db).await?;
        tracks.push(id);
    }
    let server = sqlx::query_scalar("SELECT id FROM sync_identity").fetch_one(db).await?;
    Ok((user, server, tracks))
}

fn action(kind: &str, entity: Option<Uuid>, payload: Value) -> Action {
    Action {
        id: Uuid::now_v7(),
        kind: kind.to_owned(),
        entity_id: entity,
        occurred_at: Utc::now() - Duration::days(40),
        payload,
    }
}
fn batch(user: Uuid, server: Uuid, actions: &[Action]) -> anyhow::Result<Batch> {
    Ok(serde_json::from_value(json!({"userId":user,"serverId":server,"actions":actions}))?)
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn concurrent_retries_do_not_duplicate_events_or_change_offline_timestamps(db: PgPool) -> anyhow::Result<()> {
    let (user, server, tracks) = fixture(&db).await?;
    let events = vec![
        action(
            "signal",
            None,
            json!({"type":"trackCompleted","trackId":tracks[0],"listenedSeconds":11,"durationSeconds":12,"source":"radio"}),
        ),
        action("history", None, json!({"trackId":tracks[0],"listenedSeconds":11,"playbackPosition":11})),
    ];
    let (a, b) = tokio::join!(
        actions::exchange(&db, user, batch(user, server, &events)?),
        actions::exchange(&db, user, batch(user, server, &events)?)
    );
    assert_eq!(a?, b?);
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT count(*) FROM playback_events").fetch_one(&db).await?, 1);
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT count(*) FROM listening_history").fetch_one(&db).await?, 1);
    let timestamp: chrono::DateTime<Utc> =
        sqlx::query_scalar("SELECT occurred_at FROM playback_events").fetch_one(&db).await?;
    assert!((timestamp - events[0].occurred_at).num_milliseconds().abs() < 1);
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn playlist_edits_merge_members_and_independent_fields_and_do_not_resurrect_deleted_tracks(
    db: PgPool,
) -> anyhow::Result<()> {
    let (user, server, tracks) = fixture(&db).await?;
    let playlist = Uuid::now_v7();
    let create = vec![
        action("playlistCreate", Some(playlist), json!({"name":"First"})),
        action("playlistAdd", Some(playlist), json!({"trackIds":tracks})),
    ];
    actions::exchange(&db, user, batch(user, server, &create)?).await?;
    sqlx::query("UPDATE playlists SET description='Edited on PC' WHERE id=$1").bind(playlist).execute(&db).await?;
    sqlx::query("DELETE FROM playlist_tracks WHERE playlist_id=$1 AND track_id=$2")
        .bind(playlist)
        .bind(tracks[0])
        .execute(&db)
        .await?;
    let edits = vec![
        action("playlistUpdate", Some(playlist), json!({"name":"Edited on phone"})),
        action("playlistOrder", Some(playlist), json!({"trackIds":[tracks[1],tracks[0]]})),
    ];
    actions::exchange(&db, user, batch(user, server, &edits)?).await?;
    let row: (String, String) =
        sqlx::query_as("SELECT name,description FROM playlists WHERE id=$1").bind(playlist).fetch_one(&db).await?;
    assert_eq!(row, ("Edited on phone".into(), "Edited on PC".into()));
    let members: Vec<Uuid> =
        sqlx::query_scalar("SELECT track_id FROM playlist_tracks WHERE playlist_id=$1 ORDER BY position")
            .bind(playlist)
            .fetch_all(&db)
            .await?;
    assert_eq!(members, vec![tracks[1], tracks[2]]);
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn a_rejected_edit_does_not_block_following_actions_and_receipts_bind_the_payload(
    db: PgPool,
) -> anyhow::Result<()> {
    let (user, server, tracks) = fixture(&db).await?;
    let mut edits = vec![
        action("playlistUpdate", Some(Uuid::now_v7()), json!({"name":"Deleted elsewhere"})),
        action("favorite", Some(tracks[0]), json!({"value":true})),
    ];
    let result = actions::exchange(&db, user, batch(user, server, &edits)?).await?;
    assert_eq!(result["results"][0]["status"], "rejected");
    assert_eq!(result["results"][1]["status"], "applied");
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT count(*) FROM favorites").fetch_one(&db).await?, 1);
    edits[1].payload = json!({"value":false});
    assert!(matches!(
        actions::exchange(&db, user, batch(user, server, &edits)?).await,
        Err(app::AppError::Conflict(_))
    ));
    assert!(matches!(
        actions::exchange(&db, user, batch(user, Uuid::now_v7(), &[])?).await,
        Err(app::AppError::Conflict(_))
    ));
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn metadata_exports_keep_audio_identity_but_replacements_change_it(db: PgPool) -> anyhow::Result<()> {
    let (user, _, tracks) = fixture(&db).await?;
    let directory = std::env::temp_dir().join(format!("caimack-sync-{}", Uuid::now_v7()));
    let storage = app::storage::Storage::open(&directory)?;
    let before = app::sync::snapshot(&db, &storage, user).await?;
    sqlx::query("UPDATE tracks SET media_cache_hash=content_hash,content_hash='tagged' WHERE id=$1")
        .bind(tracks[0])
        .execute(&db)
        .await?;
    let tagged = app::sync::snapshot(&db, &storage, user).await?;
    assert_eq!(before["files"][0]["audioVersion"], tagged["files"][0]["audioVersion"]);
    assert_ne!(before["files"][0]["fileHash"], tagged["files"][0]["fileHash"]);
    sqlx::query("UPDATE tracks SET media_cache_hash=NULL,content_hash='new-audio' WHERE id=$1")
        .bind(tracks[0])
        .execute(&db)
        .await?;
    let replaced = app::sync::snapshot(&db, &storage, user).await?;
    assert_ne!(tagged["files"][0]["audioVersion"], replaced["files"][0]["audioVersion"]);
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn external_tag_edits_keep_the_encoded_audio_identity(db: PgPool) -> anyhow::Result<()> {
    let (user, _, tracks) = fixture(&db).await?;
    let directory = std::env::temp_dir().join(format!("caimack-sync-{}", Uuid::now_v7()));
    let storage = app::storage::Storage::open(&directory)?;
    let path = directory.join("music/0.mp3");
    let original = b"ID3\x04\x00\x00\x00\x00\x00\x05helloENCODED AUDIO";
    std::fs::write(&path, original)?;
    let before = app::sync::snapshot(&db, &storage, user).await?;
    let edited = b"ID3\x04\x00\x00\x00\x00\x00\x07goodbyeENCODED AUDIO";
    std::fs::write(&path, edited)?;
    sqlx::query("UPDATE tracks SET content_hash=$2,media_cache_hash=NULL WHERE id=$1")
        .bind(tracks[0])
        .bind(app::sync::hash(edited))
        .execute(&db)
        .await?;
    let after = app::sync::snapshot(&db, &storage, user).await?;
    assert_eq!(before["files"][0]["audioVersion"], after["files"][0]["audioVersion"]);
    let replacement = b"ID3\x04\x00\x00\x00\x00\x00\x07goodbyeDIFFERENT AUDIO";
    std::fs::write(&path, replacement)?;
    sqlx::query("UPDATE tracks SET content_hash=$2,media_cache_hash=NULL WHERE id=$1")
        .bind(tracks[0])
        .bind(app::sync::hash(replacement))
        .execute(&db)
        .await?;
    let replaced = app::sync::snapshot(&db, &storage, user).await?;
    assert_ne!(after["files"][0]["audioVersion"], replaced["files"][0]["audioVersion"]);
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn snapshot_preserves_rich_lyrics_and_provider_attribution(db: PgPool) -> anyhow::Result<()> {
    let (user, _, tracks) = fixture(&db).await?;
    let directory = std::env::temp_dir().join(format!("caimack-rich-sync-{}", Uuid::now_v7()));
    let storage = app::storage::Storage::open(&directory)?;
    let lines = json!([{"at":1000,"text":"Hello","words":[{"at":1000,"end":2000,"text":"Hello"}]}]);
    sqlx::query("INSERT INTO track_lyrics(track_id,plain,synced,source,provider,source_format,attribution,original_lyrics,updated_at)
        VALUES($1,'Hello',$2,2,'Test provider','ttml',$3,'original rich text',now())")
        .bind(tracks[0]).bind(&lines).bind(json!({"url":"https://example.test/lyrics"})).execute(&db).await?;
    let snapshot = app::sync::snapshot(&db, &storage, user).await?;
    let lyric = &snapshot["lyrics"][tracks[0].to_string()];
    assert_eq!(lyric["lines"], lines);
    assert_eq!(lyric["provider"], "Test provider");
    assert_eq!(lyric["source"], "Provider");
    assert_eq!(lyric["syncType"], "syllable");
    assert_eq!(lyric["attribution"]["url"], "https://example.test/lyrics");
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn metadata_only_exports_preserve_provider_lyrics(db: PgPool) -> anyhow::Result<()> {
    let (_, _, tracks) = fixture(&db).await?;
    sqlx::query("INSERT INTO track_lyrics(track_id,plain,synced,source,updated_at) VALUES($1,'Words','[]',2,now())")
        .bind(tracks[0])
        .execute(&db)
        .await?;
    sqlx::query("UPDATE tracks SET media_cache_hash=content_hash,content_hash='tag-export' WHERE id=$1")
        .bind(tracks[0])
        .execute(&db)
        .await?;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM track_lyrics WHERE track_id=$1")
        .bind(tracks[0])
        .fetch_one(&db)
        .await?;
    assert_eq!(count, 1, "embedding artwork must not delete provider lyrics");
    sqlx::query("UPDATE tracks SET media_cache_hash=NULL,content_hash='replacement' WHERE id=$1")
        .bind(tracks[0])
        .execute(&db)
        .await?;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM track_lyrics WHERE track_id=$1")
        .bind(tracks[0])
        .fetch_one(&db)
        .await?;
    assert_eq!(count, 0, "replacing the audio must invalidate provider lyrics");
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn duration_edits_restart_provider_lookup_after_audio_identity_migration(db: PgPool) -> anyhow::Result<()> {
    let (_, _, tracks) = fixture(&db).await?;
    sqlx::query(
        "UPDATE enrichment_jobs SET last_outcome='not_found',next_attempt_at=now()+interval '7 days' WHERE track_id=$1",
    )
    .bind(tracks[0])
    .execute(&db)
    .await?;
    sqlx::query("UPDATE tracks SET duration_seconds=duration_seconds+1 WHERE id=$1")
        .bind(tracks[0])
        .execute(&db)
        .await?;
    let outcomes: Vec<Option<String>> =
        sqlx::query_scalar("SELECT last_outcome FROM enrichment_jobs WHERE track_id=$1")
            .bind(tracks[0])
            .fetch_all(&db)
            .await?;
    assert_eq!(outcomes, vec![None, None]);
    Ok(())
}
