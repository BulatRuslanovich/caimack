// SPDX-License-Identifier: AGPL-3.0-only

use std::collections::HashMap;

use anyhow::{Context, bail};
use sqlx::migrate::{Migrate, Migrator};
use sqlx::{Connection, PgConnection, PgPool};

pub static MIGRATOR: Migrator = sqlx::migrate!("../../../db/migrations");

pub async fn migrate(db: &PgPool) -> anyhow::Result<()> {
    // Close this dedicated connection on errors/cancellation as well, so a failed
    // upgrade cannot leave a session advisory lock in the pool.
    let mut conn = db.acquire().await?.detach();
    conn.lock().await?;
    reconcile_fork_versions(&mut conn).await?;
    let mut migrator = Migrator::with_migrations(MIGRATOR.iter().cloned().collect());
    migrator.set_locking(false);
    migrator.run(&mut conn).await.context("Could not migrate the database")?;
    conn.unlock().await?;
    tracing::info!("Database schema is at migration {}", latest());
    Ok(())
}

/// The local fork shipped collections as 8/9 before upstream assigned them 9/10.
/// Their SQL is identical. Recognize only that exact history; never overwrite a
/// checksum or mark new schema changes as applied.
async fn reconcile_fork_versions(conn: &mut PgConnection) -> anyhow::Result<()> {
    let exists: bool =
        sqlx::query_scalar("SELECT to_regclass('public._sqlx_migrations') IS NOT NULL").fetch_one(&mut *conn).await?;
    if !exists {
        return Ok(());
    }
    let applied = conn.list_applied_migrations(&MIGRATOR.table_name).await?;
    let checksum = |version| applied.iter().find(|m| m.version == version).map(|m| m.checksum.as_ref());
    let saved = MIGRATOR.iter().find(|m| m.version == 9).context("Missing saved-library migration")?;
    let folders = MIGRATOR.iter().find(|m| m.version == 10).context("Missing library-folders migration")?;
    if checksum(8) != Some(saved.checksum.as_ref()) && checksum(9) != Some(folders.checksum.as_ref()) {
        return Ok(());
    }
    if conn.dirty_version(&MIGRATOR.table_name).await?.is_some()
        || applied.iter().any(|m| !matches!(m.version, 1 | 2 | 8 | 9))
        || MIGRATOR.iter().filter(|m| m.version <= 2).any(|m| checksum(m.version) != Some(m.checksum.as_ref()))
        || checksum(8) != Some(saved.checksum.as_ref())
        || checksum(9).is_some_and(|sum| sum != folders.checksum.as_ref())
    {
        bail!("Unrecognized fork migration history. No migration versions have been changed.");
    }
    let mut tx = conn.begin().await?;
    sqlx::query("UPDATE _sqlx_migrations SET version=10 WHERE version=9").execute(&mut *tx).await?;
    sqlx::query("UPDATE _sqlx_migrations SET version=9 WHERE version=8").execute(&mut *tx).await?;
    tx.commit().await?;
    tracing::info!("Aligned legacy fork collection migrations with upstream versions 9/10");
    Ok(())
}

pub async fn verify(db: &PgPool) -> anyhow::Result<()> {
    if !table_exists(db, &MIGRATOR.table_name).await? {
        bail!("The database has no schema version. Run `caimack migrate` (the migrate service in Docker Compose).");
    }

    let mut conn = db.acquire().await?;
    if let Some(version) = conn.dirty_version(&MIGRATOR.table_name).await? {
        bail!("Migration {version} failed halfway. Repair the database, then run `caimack migrate` again.");
    }
    let applied: HashMap<i64, Vec<u8>> = conn
        .list_applied_migrations(&MIGRATOR.table_name)
        .await?
        .into_iter()
        .map(|migration| (migration.version, migration.checksum.into_owned()))
        .collect();

    let known: Vec<Known<'_>> = MIGRATOR
        .iter()
        .filter(|migration| migration.migration_type.is_up_migration())
        .map(|migration| Known {
            version: migration.version,
            description: &migration.description,
            checksum: &migration.checksum,
        })
        .collect();

    match mismatch(&applied, &known) {
        Some(problem) => bail!(problem),
        None => Ok(()),
    }
}

fn latest() -> i64 {
    MIGRATOR.iter().map(|migration| migration.version).max().unwrap_or(0)
}

async fn table_exists(db: &PgPool, table: &str) -> sqlx::Result<bool> {
    sqlx::query_scalar("SELECT to_regclass('public.' || quote_ident($1)) IS NOT NULL").bind(table).fetch_one(db).await
}

struct Known<'a> {
    version: i64,
    description: &'a str,
    checksum: &'a [u8],
}

fn mismatch(applied: &HashMap<i64, Vec<u8>>, known: &[Known<'_>]) -> Option<String> {
    if let Some(newer) = applied.keys().filter(|version| !known.iter().any(|k| k.version == **version)).max() {
        return Some(format!(
            "The database is at migration {newer}, which this build of Caimack does not know. Update Caimack."
        ));
    }
    for migration in known {
        match applied.get(&migration.version) {
            None => {
                return Some(format!(
                    "Migration {} ({}) has not been applied. Run `caimack migrate` (the migrate service in Docker \
                     Compose).",
                    migration.version, migration.description
                ));
            }
            Some(checksum) if checksum.as_slice() != migration.checksum => {
                return Some(format!(
                    "Migration {} ({}) was changed after it was applied to this database.",
                    migration.version, migration.description
                ));
            }
            Some(_) => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn known() -> Vec<Known<'static>> {
        vec![
            Known { version: 1, description: "baseline", checksum: b"one" },
            Known { version: 2, description: "fingerprints", checksum: b"two" },
        ]
    }

    #[test]
    fn up_to_date_schema_passes() {
        let applied = HashMap::from([(1, b"one".to_vec()), (2, b"two".to_vec())]);
        assert_eq!(mismatch(&applied, &known()), None);
    }

    #[test]
    fn pending_migration_is_reported() {
        let applied = HashMap::from([(1, b"one".to_vec())]);
        let problem = mismatch(&applied, &known()).unwrap_or_default();
        assert!(problem.starts_with("Migration 2 (fingerprints) has not been applied"), "{problem}");
    }

    #[test]
    fn edited_migration_is_reported() {
        let applied = HashMap::from([(1, b"changed".to_vec()), (2, b"two".to_vec())]);
        let problem = mismatch(&applied, &known()).unwrap_or_default();
        assert!(problem.starts_with("Migration 1 (baseline) was changed"), "{problem}");
    }

    #[test]
    fn database_from_a_newer_build_is_reported() {
        let applied = HashMap::from([(1, b"one".to_vec()), (2, b"two".to_vec()), (3, b"three".to_vec())]);
        let problem = mismatch(&applied, &known()).unwrap_or_default();
        assert!(problem.starts_with("The database is at migration 3"), "{problem}");
    }
}
