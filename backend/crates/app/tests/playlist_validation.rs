// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

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
