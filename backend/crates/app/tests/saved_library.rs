// SPDX-License-Identifier: AGPL-3.0-only
#![cfg(feature = "integration-tests")]
#[allow(dead_code)]
mod common;
use app::library::{
    collection::{self, Kind},
    playlists::{self, PlaylistRequest},
};
use chrono::{Duration, Utc};
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrations = "../../../db/migrations")]
async fn saved_cards_include_live_catalog_metadata(db: PgPool) -> anyhow::Result<()> {
    let user = common::user(&db, "listener", false).await?;
    let artist = Uuid::now_v7();
    let guest = Uuid::now_v7();
    let album = Uuid::now_v7();
    let track = Uuid::now_v7();
    sqlx::query("INSERT INTO artists(id,name,normalized_name,created_at) VALUES ($1,'Artist','artist',now()), ($2,'Guest','guest',now())")
        .bind(artist).bind(guest).execute(&db).await?;
    sqlx::query("INSERT INTO albums(id,title,normalized_title,artist_id,year,cover_path,created_at) VALUES ($1,'Album','album',$2,2024,'cover.jpg',now())")
        .bind(album).bind(artist).execute(&db).await?;
    sqlx::query("INSERT INTO tracks(id,title,normalized_title,artist_id,album_id,duration_seconds,file_path,original_file_name,mime_type,file_size,content_hash,created_at) VALUES ($1,'Song','song',$2,$3,185,'song.flac','song.flac','audio/flac',100,'hash',now())")
        .bind(track).bind(artist).bind(album).execute(&db).await?;
    sqlx::query("INSERT INTO track_artists(track_id,artist_id,position) VALUES ($1,$2,0),($1,$3,1)")
        .bind(track)
        .bind(artist)
        .bind(guest)
        .execute(&db)
        .await?;
    let playlist =
        playlists::create(&db, user, PlaylistRequest { name: "Mix".into(), description: None, is_public: false })
            .await?;
    sqlx::query("INSERT INTO playlist_tracks(id,playlist_id,track_id,position) VALUES ($1,$2,$3,0)")
        .bind(Uuid::now_v7())
        .bind(playlist.id)
        .bind(track)
        .execute(&db)
        .await?;
    let mut conn = db.acquire().await?;
    for (kind, id) in [(Kind::Album, album), (Kind::Artist, artist), (Kind::Artist, guest)] {
        collection::save(&mut conn, user, kind, id, Utc::now()).await?;
    }
    let items = serde_json::to_value(collection::list(&db, user).await?)?;
    let find = |id: Uuid| items.as_array().unwrap().iter().find(|item| item["id"] == id.to_string()).unwrap();
    assert_eq!(find(album)["trackCount"], 1);
    assert_eq!(find(album)["durationSeconds"], 185);
    assert_eq!(find(album)["year"], 2024);
    assert_eq!(find(artist)["albumCount"], 1);
    assert_eq!(find(guest)["trackCount"], 1, "Guest credits count in the same way as the artist catalog");
    assert_eq!(find(playlist.id)["trackCount"], 1);
    assert_eq!(find(playlist.id)["durationSeconds"], 185);
    assert_eq!(find(playlist.id)["coverTrackId"], track.to_string());
    sqlx::query("DELETE FROM playlist_tracks WHERE playlist_id=$1").bind(playlist.id).execute(&db).await?;
    let updated = serde_json::to_value(collection::list(&db, user).await?)?;
    let empty = updated.as_array().unwrap().iter().find(|item| item["id"] == playlist.id.to_string()).unwrap();
    assert_eq!(empty["trackCount"], 0);
    assert_eq!(empty["durationSeconds"], 0);
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn saves_are_personal_idempotent_independent_and_cascade(db: PgPool) -> anyhow::Result<()> {
    let alice = common::user(&db, "alice", false).await?;
    let bob = common::user(&db, "bob", false).await?;
    let artist = Uuid::now_v7();
    let album = Uuid::now_v7();
    sqlx::query("INSERT INTO artists(id,name,normalized_name,created_at) VALUES ($1,'Artist','artist',now())")
        .bind(artist)
        .execute(&db)
        .await?;
    sqlx::query(
        "INSERT INTO albums(id,title,normalized_title,artist_id,created_at) VALUES ($1,'Album','album',$2,now())",
    )
    .bind(album)
    .bind(artist)
    .execute(&db)
    .await?;
    let mut conn = db.acquire().await?;
    let at = Utc::now() - Duration::days(1);
    collection::save(&mut conn, alice, Kind::Album, album, at).await?;
    collection::save(&mut conn, alice, Kind::Album, album, Utc::now()).await?;
    let items = collection::list(&db, alice).await?;
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].kind, "album");
    assert_eq!(items[0].saved_at.timestamp_micros(), at.timestamp_micros());
    assert!(collection::list(&db, bob).await?.is_empty());
    let favorites: i64 = sqlx::query_scalar("SELECT count(*) FROM favorites").fetch_one(&db).await?;
    assert_eq!(favorites, 0);
    collection::save(&mut conn, alice, Kind::Artist, artist, Utc::now()).await?;
    collection::remove(&mut conn, bob, Kind::Album, album).await?;
    assert_eq!(collection::list(&db, alice).await?.len(), 2);
    collection::remove(&mut conn, alice, Kind::Album, album).await?;
    collection::remove(&mut conn, alice, Kind::Album, album).await?;
    assert_eq!(collection::list(&db, alice).await?[0].kind, "artist");
    assert!(collection::save(&mut conn, alice, Kind::Album, Uuid::now_v7(), at).await.is_err());
    sqlx::query("DELETE FROM albums WHERE id=$1").bind(album).execute(&db).await?;
    sqlx::query("DELETE FROM artists WHERE id=$1").bind(artist).execute(&db).await?;
    assert!(collection::list(&db, alice).await?.is_empty());
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn playlist_visibility_and_removal_do_not_change_ownership(db: PgPool) -> anyhow::Result<()> {
    let alice = common::user(&db, "alice", false).await?;
    let bob = common::user(&db, "bob", false).await?;
    let request = |public| PlaylistRequest { name: "Mix".into(), description: None, is_public: public };
    let playlist = playlists::create(&db, alice, request(false)).await?;
    assert_eq!(collection::list(&db, alice).await?[0].id, playlist.id);
    let mut conn = db.acquire().await?;
    assert!(collection::save(&mut conn, bob, Kind::Playlist, playlist.id, Utc::now()).await.is_err());
    playlists::update(&db, alice, playlist.id, request(true)).await?;
    collection::save(&mut conn, bob, Kind::Playlist, playlist.id, Utc::now()).await?;
    assert_eq!(collection::list(&db, bob).await?[0].id, playlist.id);
    playlists::update(&db, alice, playlist.id, request(false)).await?;
    assert!(collection::list(&db, bob).await?.is_empty());
    collection::remove(&mut conn, alice, Kind::Playlist, playlist.id).await?;
    assert!(collection::list(&db, alice).await?.is_empty());
    assert_eq!(playlists::own(&db, alice).await?.len(), 1);
    collection::remove(&mut conn, bob, Kind::Playlist, playlist.id).await?;
    playlists::update(&db, alice, playlist.id, request(true)).await?;
    assert!(collection::list(&db, bob).await?.is_empty());
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn offline_library_actions_replay_once(db: PgPool) -> anyhow::Result<()> {
    use app::sync::actions::{Action, Batch, exchange};
    let user = common::user(&db, "offline", false).await?;
    let artist = Uuid::now_v7();
    sqlx::query("INSERT INTO artists(id,name,normalized_name,created_at) VALUES ($1,'Artist','artist',now())")
        .bind(artist)
        .execute(&db)
        .await?;
    let server_id: Uuid = sqlx::query_scalar("SELECT id FROM sync_identity").fetch_one(&db).await?;
    let action_id = Uuid::new_v4();
    let occurred_at = Utc::now();
    let batch = || Batch {
        server_id,
        user_id: user,
        actions: vec![Action {
            id: action_id,
            kind: "library".into(),
            entity_id: Some(artist),
            occurred_at,
            payload: serde_json::json!({"kind":"artist","value":true}),
        }],
    };
    assert_eq!(exchange(&db, user, batch()).await?["results"][0]["status"], "applied");
    let mut conn = db.acquire().await?;
    collection::remove(&mut conn, user, Kind::Artist, artist).await?;
    exchange(&db, user, batch()).await?;
    assert!(collection::list(&db, user).await?.is_empty());
    Ok(())
}
