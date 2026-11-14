// SPDX-License-Identifier: AGPL-3.0-only
#![cfg(feature = "integration-tests")]

use anyhow::Context;
use app::schema::{self, MIGRATOR};
use sqlx::{PgPool, migrate::Migrator};
use uuid::Uuid;

async fn legacy_fork(db: &PgPool, with_folders: bool) -> anyhow::Result<()> {
    let mut migrations: Vec<_> = MIGRATOR.iter().filter(|m| m.version <= 2).cloned().collect();
    for version in 9..=if with_folders { 10 } else { 9 } {
        let mut migration =
            MIGRATOR.iter().find(|m| m.version == version).context("Missing collection migration")?.clone();
        migration.version -= 1;
        migrations.push(migration);
    }
    Migrator::with_migrations(migrations).run(db).await?;
    Ok(())
}

async fn upgrade_fork(db: PgPool, with_folders: bool) -> anyhow::Result<()> {
    legacy_fork(&db, with_folders).await?;
    let user = Uuid::new_v4();
    let playlist = Uuid::new_v4();
    let folder = Uuid::new_v4();
    sqlx::query("INSERT INTO users(id,username,password_hash,created_at) VALUES($1,'fork','unused',now())")
        .bind(user)
        .execute(&db)
        .await?;
    sqlx::query("INSERT INTO playlists(id,user_id,name,is_public,created_at,updated_at) VALUES($1,$2,'Saved mix',false,now(),now())")
        .bind(playlist).bind(user).execute(&db).await?;
    if with_folders {
        sqlx::query("INSERT INTO library_folders(id,user_id,name) VALUES($1,$2,'My folder')")
            .bind(folder)
            .bind(user)
            .execute(&db)
            .await?;
        sqlx::query("UPDATE library_items SET folder_id=$1 WHERE playlist_id=$2")
            .bind(folder)
            .bind(playlist)
            .execute(&db)
            .await?;
    }
    let before: Vec<(i64, Vec<u8>)> =
        sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations ORDER BY version").fetch_all(&db).await?;
    let saved_at: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT saved_at FROM library_items WHERE playlist_id=$1")
            .bind(playlist)
            .fetch_one(&db)
            .await?;
    schema::migrate(&db).await?;
    schema::verify(&db).await?;
    // Repeated upgrades must recognize the now-canonical history.
    schema::migrate(&db).await?;
    for (version, checksum) in before {
        let canonical = if version >= 8 { version + 1 } else { version };
        let after: Vec<u8> = sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version=$1")
            .bind(canonical)
            .fetch_one(&db)
            .await?;
        assert_eq!(after, checksum, "original checksum at {version}");
    }
    let saved: (chrono::DateTime<chrono::Utc>, Option<Uuid>) =
        sqlx::query_as("SELECT saved_at,folder_id FROM library_items WHERE user_id=$1 AND playlist_id=$2")
            .bind(user)
            .bind(playlist)
            .fetch_one(&db)
            .await?;
    assert_eq!(saved, (saved_at, with_folders.then_some(folder)));
    Ok(())
}

#[sqlx::test(migrations = false)]
async fn fork_database_preserves_saved_items_and_folders(db: PgPool) -> anyhow::Result<()> {
    upgrade_fork(db, true).await
}

#[sqlx::test(migrations = false)]
async fn fork_database_with_only_collections_upgrades(db: PgPool) -> anyhow::Result<()> {
    upgrade_fork(db, false).await
}

#[sqlx::test(migrations = false)]
async fn fork_upgrade_rejects_changed_checksums_without_rewriting_history(db: PgPool) -> anyhow::Result<()> {
    legacy_fork(&db, true).await?;
    sqlx::query("UPDATE _sqlx_migrations SET checksum=$1 WHERE version=8")
        .bind(b"changed".as_slice())
        .execute(&db)
        .await?;
    let before: Vec<(i64, Vec<u8>)> =
        sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations ORDER BY version").fetch_all(&db).await?;
    assert!(schema::migrate(&db).await.is_err());
    let after: Vec<(i64, Vec<u8>)> =
        sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations ORDER BY version").fetch_all(&db).await?;
    assert_eq!(before, after);
    Ok(())
}

#[sqlx::test(migrations = false)]
async fn upstream_database_upgrades_without_rewriting_applied_migrations(db: PgPool) -> anyhow::Result<()> {
    let directory = std::env::temp_dir().join(format!("caimack-upgrade-{}", Uuid::new_v4()));
    std::fs::create_dir(&directory)?;
    for migration in MIGRATOR.iter().filter(|m| m.version <= 3) {
        std::fs::write(
            directory.join(format!("{:04}_upstream.sql", migration.version)),
            migration.sql.as_str().as_bytes(),
        )?;
    }
    Migrator::new(directory.as_path()).await?.run(&db).await?;
    let before: Vec<(i64, Vec<u8>)> =
        sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations ORDER BY version").fetch_all(&db).await?;
    assert_eq!(before.iter().map(|(version, _)| *version).collect::<Vec<_>>(), [1, 2, 3]);
    let user = Uuid::new_v4();
    let playlist = Uuid::new_v4();
    sqlx::query("INSERT INTO users(id,username,password_hash,created_at) VALUES($1,'upgrade','unused',now())")
        .bind(user)
        .execute(&db)
        .await?;
    sqlx::query(
        "INSERT INTO playlists(id,user_id,name,is_public,created_at,updated_at) VALUES($1,$2,'Existing playlist',false,now(),now())",
    )
    .bind(playlist)
    .bind(user)
    .execute(&db)
    .await?;

    schema::migrate(&db).await?;
    schema::verify(&db).await?;
    let after: Vec<(i64, Vec<u8>)> =
        sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations WHERE version<=3 ORDER BY version")
            .fetch_all(&db)
            .await?;
    assert_eq!(after, before);
    let saved: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM library_items WHERE user_id=$1 AND playlist_id=$2)")
            .bind(user)
            .bind(playlist)
            .fetch_one(&db)
            .await?;
    assert!(saved, "upgrading must retain and save existing playlists");
    std::fs::remove_dir_all(directory)?;
    Ok(())
}
