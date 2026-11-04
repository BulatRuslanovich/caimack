// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::str::FromStr;
use std::time::Duration;

use anyhow::{Context, bail};
use sqlx::PgPool;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};

use crate::config::DatabaseConfig;

const CONNECT_ATTEMPTS: u32 = 12;
const RETRY_DELAY: Duration = Duration::from_secs(5);

pub async fn connect(config: &DatabaseConfig) -> anyhow::Result<PgPool> {
    let options = PgConnectOptions::from_str(&config.url).context("DATABASE_URL is not a valid Postgres URL")?;
    let pool = PgPoolOptions::new().max_connections(config.max_connections).connect_lazy_with(options);

    for attempt in 1..=CONNECT_ATTEMPTS {
        match pool.acquire().await {
            Ok(_) => return Ok(pool),
            Err(error) if attempt < CONNECT_ATTEMPTS => {
                tracing::warn!("Database not ready (attempt {attempt}/{CONNECT_ATTEMPTS}): {error}");
                tokio::time::sleep(RETRY_DELAY).await;
            }
            Err(error) => {
                return Err(error).context(
                    "The database did not accept connections. Check that postgres is running and that DATABASE_URL points at it.",
                );
            }
        }
    }

    bail!("The database did not accept connections.")
}
