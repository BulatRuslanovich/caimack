// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::io::Write;
use std::str::FromStr;

use anyhow::Context;
use app::config::DatabaseConfig;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use uuid::Uuid;

pub async fn run() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(2);
    let username = args.next().context("Usage: caimack recommendations-evaluate <username> [seed-track-uuid ...]")?;
    let seeds: Vec<Uuid> =
        args.map(|arg| Uuid::parse_str(&arg).context("Seed track IDs must be UUIDs")).collect::<anyhow::Result<_>>()?;
    let _ = dotenvy::dotenv();
    let config = DatabaseConfig::from_env()?;
    let options = PgConnectOptions::from_str(&config.url).context("Invalid DATABASE_URL")?;
    let db = PgPoolOptions::new()
        .max_connections(2)
        .after_connect(|connection, _| {
            Box::pin(async move {
                sqlx::query("SET default_transaction_read_only = on").execute(&mut *connection).await?;
                sqlx::query("SET statement_timeout = '60s'").execute(connection).await?;
                Ok(())
            })
        })
        .connect_with(options)
        .await?;
    let report = app::recommendations::evaluation::report(&db, &username, &seeds).await?;
    let stdout = std::io::stdout();
    let mut output = stdout.lock();
    serde_json::to_writer_pretty(&mut output, &report)?;
    writeln!(output)?;
    Ok(())
}
