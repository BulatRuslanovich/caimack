// SPDX-License-Identifier: AGPL-3.0-only
#![cfg(feature = "integration-tests")]
#[allow(dead_code)]
mod common;
use app::library::{
    collection::{self, Kind},
    folders::{self, Change},
};
use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

async fn apply(db: &PgPool, user: Uuid, change: Change) -> app::AppResult<()> {
    let mut tx = db.begin().await?;
    folders::apply(&mut tx, user, &change, Utc::now()).await?;
    tx.commit().await?;
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn folders_are_private_nested_and_deletion_preserves_contents(db: PgPool) -> anyhow::Result<()> {
    let alice = common::user(&db, "alice", false).await?;
    let bob = common::user(&db, "bob", false).await?;
    let root = Uuid::new_v4();
    let child = Uuid::new_v4();
    let grandchild = Uuid::new_v4();
    for (id, parent) in [(root, None), (child, Some(root)), (grandchild, Some(child))] {
        apply(&db, alice, Change::Create { id, name: " Music ".into(), folder_id: parent }).await?;
    }
    assert_eq!(folders::list(&db, alice).await?[0].name, "Music");
    assert!(folders::list(&db, bob).await?.is_empty());
    assert!(apply(&db, bob, Change::Rename { id: root, name: "Hijack".into() }).await.is_err());
    assert!(
        apply(&db, bob, Change::Create { id: Uuid::new_v4(), name: "Foreign".into(), folder_id: Some(root) })
            .await
            .is_err()
    );
    assert!(apply(&db, alice, Change::MoveFolder { id: root, folder_id: Some(grandchild) }).await.is_err());
    assert!(
        apply(&db, alice, Change::Create { id: Uuid::new_v4(), name: "  ".into(), folder_id: None }).await.is_err()
    );
    apply(&db, alice, Change::Rename { id: child, name: "Albums".into() }).await?;
    let artist = Uuid::new_v4();
    sqlx::query("INSERT INTO artists(id,name,normalized_name,created_at) VALUES($1,'A','a',now())")
        .bind(artist)
        .execute(&db)
        .await?;
    let mut conn = db.acquire().await?;
    collection::save(&mut conn, alice, Kind::Artist, artist, Utc::now()).await?;
    apply(&db, alice, Change::MoveItem { id: artist, kind: Kind::Artist, folder_id: Some(child) }).await?;
    assert!(apply(&db, bob, Change::MoveItem { id: artist, kind: Kind::Artist, folder_id: None }).await.is_err());
    assert_eq!(collection::list(&db, alice).await?[0].folder_id, Some(child));
    apply(&db, alice, Change::Delete { id: child }).await?;
    assert_eq!(collection::list(&db, alice).await?[0].folder_id, Some(root));
    assert_eq!(folders::list(&db, alice).await?.iter().find(|f| f.id == grandchild).unwrap().parent_id, Some(root));
    apply(&db, alice, Change::Delete { id: root }).await?;
    assert_eq!(collection::list(&db, alice).await?[0].folder_id, None);
    assert_eq!(folders::list(&db, alice).await?[0].parent_id, None);
    apply(&db, alice, Change::MoveItem { id: artist, kind: Kind::Artist, folder_id: Some(grandchild) }).await?;
    collection::save(&mut conn, alice, Kind::Artist, artist, Utc::now()).await?;
    assert_eq!(collection::list(&db, alice).await?[0].folder_id, Some(grandchild));
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn simultaneous_moves_cannot_create_a_cycle(db: PgPool) -> anyhow::Result<()> {
    let user = common::user(&db, "race", false).await?;
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    for id in [a, b] {
        apply(&db, user, Change::Create { id, name: "Folder".into(), folder_id: None }).await?;
    }
    let (one, two) = tokio::join!(
        apply(&db, user, Change::MoveFolder { id: a, folder_id: Some(b) }),
        apply(&db, user, Change::MoveFolder { id: b, folder_id: Some(a) })
    );
    assert_ne!(one.is_ok(), two.is_ok());
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn offline_folder_retries_do_not_recreate_deleted_folders(db: PgPool) -> anyhow::Result<()> {
    use app::sync::actions::{Action, Batch, exchange};
    let user = common::user(&db, "offline", false).await?;
    let server_id = sqlx::query_scalar("SELECT id FROM sync_identity").fetch_one(&db).await?;
    let id = Uuid::new_v4();
    let action_id = Uuid::new_v4();
    let occurred_at = Utc::now();
    let batch = || Batch {
        server_id,
        user_id: user,
        actions: vec![Action {
            id: action_id,
            kind: "libraryOrganize".into(),
            entity_id: None,
            occurred_at,
            payload: serde_json::json!({"operation":"create","id":id,"name":"Offline","folderId":null}),
        }],
    };
    assert_eq!(exchange(&db, user, batch()).await?["results"][0]["status"], "applied");
    apply(&db, user, Change::Delete { id }).await?;
    assert_eq!(exchange(&db, user, batch()).await?["results"][0]["status"], "applied");
    assert!(folders::list(&db, user).await?.is_empty());
    Ok(())
}
