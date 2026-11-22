// SPDX-License-Identifier: AGPL-3.0-only

#![cfg(feature = "integration-tests")]

use app::library::playlists::{self, PlaylistRequest};
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrations = "../../../db/migrations")]
async fn invalid_playlist_names_and_descriptions_are_validation_errors_without_database_changes(
    db: PgPool,
) -> anyhow::Result<()> {
    let user = Uuid::now_v7();
    sqlx::query("INSERT INTO users(id,username,password_hash,created_at) VALUES ($1,'alice','unused',now())")
        .bind(user)
        .execute(&db)
        .await?;
    let original = playlists::create(
        &db,
        user,
        PlaylistRequest { name: "Original".to_owned(), description: None, is_public: false },
    )
    .await?;
    for (name, description) in
        [("   ".to_owned(), None), ("x".repeat(201), None), ("Valid".to_owned(), Some("x".repeat(1001)))]
    {
        let request = || PlaylistRequest { name: name.clone(), description: description.clone(), is_public: false };
        assert!(matches!(playlists::create(&db, user, request()).await, Err(app::AppError::Validation(_))));
        assert!(matches!(
            playlists::update(&db, user, original.id, request()).await,
            Err(app::AppError::Validation(_))
        ));
    }
    let all = playlists::own(&db, user).await?;
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].name, "Original");
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn playlist_import_preserves_order_and_rolls_back_an_incomplete_create(db: PgPool) -> anyhow::Result<()> {
    let user = Uuid::now_v7();
    let artist = Uuid::now_v7();
    let first = Uuid::now_v7();
    let second = Uuid::now_v7();
    sqlx::query("INSERT INTO users(id,username,password_hash,created_at) VALUES ($1,'alice','unused',now())")
        .bind(user)
        .execute(&db)
        .await?;
    sqlx::query("INSERT INTO artists(id,name,normalized_name,created_at) VALUES ($1,'Artist','artist',now())")
        .bind(artist)
        .execute(&db)
        .await?;
    sqlx::query(
        "INSERT INTO tracks(id,title,normalized_title,artist_id,duration_seconds,file_path,original_file_name,mime_type,file_size,content_hash,created_at)
         VALUES ($1,'First','first',$3,160,'first.mp3','first.mp3','audio/mpeg',100,'first',now()),
                ($2,'Second','second',$3,180,'second.mp3','second.mp3','audio/mpeg',100,'second',now())",
    ).bind(first).bind(second).bind(artist).execute(&db).await?;
    let request = || PlaylistRequest { name: "VK Mix".into(), description: None, is_public: false };
    let playlist = playlists::create_with_tracks(&db, user, request(), &[second, first, second]).await?;
    let tracks = playlists::detail(&db, user, playlist.id).await?.tracks;
    assert_eq!(tracks.iter().map(|track| track.id).collect::<Vec<_>>(), [second, first]);
    assert!(!playlist.is_public);
    assert!(matches!(
        playlists::create_with_tracks(&db, user, request(), &[first, Uuid::now_v7()]).await,
        Err(app::AppError::NotFound(_))
    ));
    assert_eq!(playlists::own(&db, user).await?.len(), 1);
    Ok(())
}
