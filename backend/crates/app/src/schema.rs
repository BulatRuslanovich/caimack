// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::HashMap;

use anyhow::{Context, bail};
use sqlx::PgPool;
use sqlx::migrate::{Migrate, Migrator};

pub static MIGRATOR: Migrator = sqlx::migrate!("../../../db/migrations");

pub async fn migrate(db: &PgPool) -> anyhow::Result<()> {
    MIGRATOR.run(db).await.context("Could not migrate the database")?;
    tracing::info!("Database schema is at migration {}", latest());
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
