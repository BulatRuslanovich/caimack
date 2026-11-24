// SPDX-License-Identifier: AGPL-3.0-only

#![cfg(feature = "integration-tests")]

use app::library::playlists::{self, MembershipChange, PlaylistRequest};
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
async fn offline_history_is_bounded_and_merges_out_of_order_plays(db: PgPool) -> anyhow::Result<()> {
    let (user, server, tracks) = fixture(&db).await?;
    let directory = std::env::temp_dir().join(format!("caimack-sync-actions-{}", Uuid::now_v7()));
    let storage = app::storage::Storage::open(&directory)?;
    let mut newer = action("history", None, json!({"trackId":tracks[0],"listenedSeconds":11,"playbackPosition":11}));
    newer.occurred_at = Utc::now() - Duration::hours(2);
    let mut older = action("history", None, json!({"trackId":tracks[0],"listenedSeconds":11,"playbackPosition":5}));
    older.occurred_at = newer.occurred_at - Duration::minutes(10);
    actions::exchange(&db, &storage, user, batch(user, server, &[newer, older])?).await?;
    let positions: Vec<i32> = sqlx::query_scalar("SELECT playback_position FROM listening_history WHERE user_id=$1")
        .bind(user)
        .fetch_all(&db)
        .await?;
    assert_eq!(positions, vec![11], "an older offline event must not rewind a newer history entry");

    sqlx::query(
        "INSERT INTO listening_history(id,user_id,track_id,played_at,playback_position)
        SELECT gen_random_uuid(),$1,$2,now()-interval '1 day',0 FROM generate_series(1,1100)",
    )
    .bind(user)
    .bind(tracks[1])
    .execute(&db)
    .await?;
    let latest = action("history", None, json!({"trackId":tracks[2],"listenedSeconds":11,"playbackPosition":11}));
    actions::exchange(&db, &storage, user, batch(user, server, &[latest])?).await?;
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM listening_history WHERE user_id=$1").bind(user).fetch_one(&db).await?;
    assert_eq!(count, 1000);
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn offline_playlist_deletion_removes_cover_renditions_and_can_be_retried(db: PgPool) -> anyhow::Result<()> {
    let (user, server, _) = fixture(&db).await?;
    let directory = std::env::temp_dir().join(format!("caimack-sync-delete-{}", Uuid::now_v7()));
    let storage = app::storage::Storage::open(&directory)?;
    let playlist = app::library::playlists::create(
        &db,
        user,
        app::library::playlists::PlaylistRequest { name: "Covered".into(), description: None, is_public: false },
    )
    .await?;
    let cover = format!("playlists/{}.webp", playlist.id.simple());
    for size in [app::storage::CoverSize::Full, app::storage::CoverSize::Thumb, app::storage::CoverSize::Large] {
        let path = app::storage::Storage::cover_variant(&cover, size);
        std::fs::write(storage.resolve(&path)?, b"cover")?;
    }
    sqlx::query("UPDATE playlists SET cover_path=$2 WHERE id=$1").bind(playlist.id).bind(&cover).execute(&db).await?;
    let edits = vec![action("playlistDelete", Some(playlist.id), json!({}))];
    // A receipt failure rolls back the deletion and must leave its files intact.
    sqlx::query("ALTER TABLE sync_receipts ADD CONSTRAINT reject_receipt CHECK (false) NOT VALID").execute(&db).await?;
    assert!(actions::exchange(&db, &storage, user, batch(user, server, &edits)?).await.is_err());
    assert_eq!(std::fs::read_dir(directory.join("playlists"))?.count(), 3);
    assert!(
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM playlists WHERE id=$1)")
            .bind(playlist.id)
            .fetch_one(&db)
            .await?
    );
    sqlx::query("ALTER TABLE sync_receipts DROP CONSTRAINT reject_receipt").execute(&db).await?;
    let first = actions::exchange(&db, &storage, user, batch(user, server, &edits)?).await?;
    assert_eq!(actions::exchange(&db, &storage, user, batch(user, server, &edits)?).await?, first);
    assert_eq!(std::fs::read_dir(directory.join("playlists"))?.count(), 0);
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn concurrent_retries_do_not_duplicate_events_or_change_offline_timestamps(db: PgPool) -> anyhow::Result<()> {
    let (user, server, tracks) = fixture(&db).await?;
    let directory = std::env::temp_dir().join(format!("caimack-sync-actions-{}", Uuid::now_v7()));
    let storage = app::storage::Storage::open(&directory)?;
    let events = vec![
        action(
            "signal",
            None,
            json!({"type":"trackCompleted","trackId":tracks[0],"listenedSeconds":11,"durationSeconds":12,"source":"radio"}),
        ),
        action("history", None, json!({"trackId":tracks[0],"listenedSeconds":11,"playbackPosition":11})),
    ];
    let (a, b) = tokio::join!(
        actions::exchange(&db, &storage, user, batch(user, server, &events)?),
        actions::exchange(&db, &storage, user, batch(user, server, &events)?)
    );
    assert_eq!(a?, b?);
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT count(*) FROM playback_events").fetch_one(&db).await?, 1);
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT count(*) FROM listening_history").fetch_one(&db).await?, 1);
    let timestamp: chrono::DateTime<Utc> =
        sqlx::query_scalar("SELECT occurred_at FROM playback_events").fetch_one(&db).await?;
    assert!((timestamp - events[0].occurred_at).num_milliseconds().abs() < 1);
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn playlist_edits_merge_members_and_independent_fields_and_do_not_resurrect_deleted_tracks(
    db: PgPool,
) -> anyhow::Result<()> {
    let (user, server, tracks) = fixture(&db).await?;
    let directory = std::env::temp_dir().join(format!("caimack-sync-actions-{}", Uuid::now_v7()));
    let storage = app::storage::Storage::open(&directory)?;
    let playlist = Uuid::now_v7();
    let create = vec![
        action("playlistCreate", Some(playlist), json!({"name":"First"})),
        action("playlistAdd", Some(playlist), json!({"trackIds":tracks})),
    ];
    actions::exchange(&db, &storage, user, batch(user, server, &create)?).await?;
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
    actions::exchange(&db, &storage, user, batch(user, server, &edits)?).await?;
    let row: (String, String) =
        sqlx::query_as("SELECT name,description FROM playlists WHERE id=$1").bind(playlist).fetch_one(&db).await?;
    assert_eq!(row, ("Edited on phone".into(), "Edited on PC".into()));
    let members: Vec<Uuid> =
        sqlx::query_scalar("SELECT track_id FROM playlist_tracks WHERE playlist_id=$1 ORDER BY position")
            .bind(playlist)
            .fetch_all(&db)
            .await?;
    assert_eq!(members, vec![tracks[1], tracks[2]]);
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn playlist_memberships_copy_and_offline_edits_preserve_independent_changes(db: PgPool) -> anyhow::Result<()> {
    let (user, server, tracks) = fixture(&db).await?;
    let directory = std::env::temp_dir().join(format!("caimack-playlists-{}", Uuid::now_v7()));
    let storage = app::storage::Storage::open(&directory)?;
    let request = || PlaylistRequest { name: "Playlist".into(), description: None, is_public: false };
    let key = Uuid::now_v7();
    let initial = [tracks[1], tracks[0]];
    let (first, retry) = tokio::join!(
        playlists::create_with_tracks_once(&db, user, request(), &initial, Some(key)),
        playlists::create_with_tracks_once(&db, user, request(), &initial, Some(key)),
    );
    let source = first?.id;
    assert_eq!(source, retry?.id);
    assert_eq!(source, key);
    let replay =
        [action("playlistCreate", Some(source), json!({"name":"Playlist","requestId":key,"trackIds":initial}))];
    let receipt = actions::exchange(&db, &storage, user, batch(user, server, &replay)?).await?;
    assert_eq!(receipt["results"][0]["status"], "applied");
    let destination = Uuid::now_v7();
    let create = [action(
        "playlistCreate",
        Some(destination),
        json!({"name":"Offline","requestId":destination,"trackIds":[tracks[0]]}),
    )];
    actions::exchange(&db, &storage, user, batch(user, server, &create)?).await?;
    assert_eq!(
        playlists::create_with_tracks_once(&db, user, request(), &[tracks[0]], Some(destination)).await?.id,
        destination,
    );
    let legacy = playlists::create_with_tracks(&db, user, request(), &[tracks[0]]).await?.id;
    sqlx::query("UPDATE playlist_tracks SET added_at = NULL WHERE playlist_id = $1").bind(legacy).execute(&db).await?;
    assert!(playlists::detail(&db, user, legacy).await?.track_added_at.is_empty());

    let membership = playlists::memberships(&db, user, tracks[1]).await?;
    assert_eq!(membership.len(), 3);
    assert_eq!(
        membership.iter().filter(|item| item.contains_track).map(|item| item.playlist.id).collect::<Vec<_>>(),
        vec![source]
    );
    let copied = playlists::copy_tracks(&db, user, source, destination).await?;
    assert_eq!((copied.changed, copied.unchanged), (1, 1));
    assert_eq!(playlists::track_ids(&db, user, destination).await?, vec![tracks[0], tracks[1]]);
    let duplicate = playlists::copy_tracks(&db, user, source, destination).await?;
    assert_eq!((duplicate.changed, duplicate.unchanged), (0, 2));

    let edits = [action("playlistRemove", Some(destination), json!({"trackIds":[tracks[0]]}))];
    let (phone, web) = tokio::join!(
        actions::exchange(&db, &storage, user, batch(user, server, &edits)?),
        playlists::add_tracks(&db, user, destination, &tracks[2..]),
    );
    assert_eq!(phone?["results"][0]["status"], "applied");
    web?;
    actions::exchange(&db, &storage, user, batch(user, server, &edits)?).await?;
    let remove_again = MembershipChange { track_ids: vec![tracks[0]], present: false };
    assert_eq!(playlists::change_membership(&db, user, destination, remove_again).await?.changed, 0);
    let detail = playlists::detail(&db, user, destination).await?;
    assert_eq!(detail.tracks.iter().map(|track| track.id).collect::<Vec<_>>(), vec![tracks[1], tracks[2]]);
    assert_eq!(detail.track_added_at.len(), 2);

    let other = Uuid::now_v7();
    sqlx::query("INSERT INTO users(id,username,password_hash,created_at) VALUES ($1,'other','unused',now())")
        .bind(other)
        .execute(&db)
        .await?;
    assert!(playlists::memberships(&db, other, tracks[1]).await?.is_empty());
    assert!(playlists::track_ids(&db, other, source).await.is_err());
    let change = MembershipChange { track_ids: vec![tracks[1]], present: false };
    assert!(playlists::change_membership(&db, other, destination, change).await.is_err());
    playlists::delete(&db, &storage, user, source).await?;
    assert!(playlists::create_with_tracks_once(&db, user, request(), &tracks, Some(key)).await.is_err());
    let replay = [action("playlistCreate", Some(source), json!({"name":"Playlist","requestId":key}))];
    let receipt = actions::exchange(&db, &storage, user, batch(user, server, &replay)?).await?;
    assert_eq!(receipt["results"][0]["status"], "rejected");
    std::fs::remove_dir_all(directory)?;
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn a_rejected_edit_does_not_block_following_actions_and_receipts_bind_the_payload(
    db: PgPool,
) -> anyhow::Result<()> {
    let (user, server, tracks) = fixture(&db).await?;
    let directory = std::env::temp_dir().join(format!("caimack-sync-actions-{}", Uuid::now_v7()));
    let storage = app::storage::Storage::open(&directory)?;
    let mut edits = vec![
        action("playlistUpdate", Some(Uuid::now_v7()), json!({"name":"Deleted elsewhere"})),
        action("favorite", Some(tracks[0]), json!({"value":true})),
    ];
    let result = actions::exchange(&db, &storage, user, batch(user, server, &edits)?).await?;
    assert_eq!(result["results"][0]["status"], "rejected");
    assert_eq!(result["results"][1]["status"], "applied");
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT count(*) FROM favorites").fetch_one(&db).await?, 1);
    edits[1].payload = json!({"value":false});
    assert!(matches!(
        actions::exchange(&db, &storage, user, batch(user, server, &edits)?).await,
        Err(app::AppError::Conflict(_))
    ));
    assert!(matches!(
        actions::exchange(&db, &storage, user, batch(user, Uuid::now_v7(), &[])?).await,
        Err(app::AppError::Conflict(_))
    ));
    std::fs::remove_dir_all(directory)?;
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
