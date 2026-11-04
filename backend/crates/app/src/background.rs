// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::sync::{Arc, OnceLock};
use tokio::sync::{AcquireError, OwnedSemaphorePermit, Semaphore};

static HEAVY: OnceLock<Arc<Semaphore>> = OnceLock::new();

pub fn capacity() -> usize {
    std::env::var("BACKGROUND_HEAVY_JOBS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or_else(|| std::thread::available_parallelism().map_or(1, |cores| (cores.get() / 2).clamp(1, 4)))
        .clamp(1, 16)
}

pub async fn permit() -> Result<OwnedSemaphorePermit, AcquireError> {
    HEAVY.get_or_init(|| Arc::new(Semaphore::new(capacity()))).clone().acquire_owned().await
}
