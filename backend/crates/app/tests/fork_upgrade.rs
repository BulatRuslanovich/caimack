// SPDX-License-Identifier: AGPL-3.0-only
#![cfg(feature = "integration-tests")]

use app::schema::{self, MIGRATOR};
use sqlx::{PgPool, migrate::Migrator};
use uuid::Uuid;

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
