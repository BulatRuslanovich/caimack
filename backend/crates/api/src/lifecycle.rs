// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::future::Future;
use std::time::Duration;

use anyhow::Context;
use tokio::task::{JoinError, JoinHandle};
use tokio_util::sync::CancellationToken;

const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

pub async fn serve(
    server: impl Future<Output = std::io::Result<()>>,
    mut workers: Vec<JoinHandle<()>>,
    cancel: CancellationToken,
    signal: impl Future<Output = ()>,
) -> anyhow::Result<()> {
    let mut server = std::pin::pin!(server);
    let (server_finished, result) = tokio::select! {
        result = &mut server => (true, result.context("The server stopped unexpectedly")),
        () = signal => (false, Ok(())),
        error = worker_failure(&mut workers) => (false, Err(anyhow::anyhow!("Background worker crashed: {error}"))),
    };

    // Close long-lived responses before waiting for the HTTP server to drain.
    cancel.cancel();
    let drained = tokio::time::timeout(SHUTDOWN_TIMEOUT, async {
        if !server_finished {
            server.await.context("The server stopped unexpectedly")?;
        }
        for worker in &mut workers {
            worker.await.context("A background worker failed during shutdown")?;
        }
        anyhow::Ok(())
    })
    .await;

    for worker in workers {
        worker.abort();
    }
    match drained {
        Ok(drained) => result.and(drained),
        Err(_) => {
            tracing::warn!("Shutdown exceeded {} seconds; stopping remaining tasks", SHUTDOWN_TIMEOUT.as_secs());
            result
        }
    }
}

async fn worker_failure(workers: &mut Vec<JoinHandle<()>>) -> JoinError {
    loop {
        if workers.is_empty() {
            std::future::pending::<()>().await;
        }
        let (result, index, _) = futures_util::future::select_all(workers.iter_mut()).await;
        let _finished = workers.swap_remove(index);
        if let Err(error) = result {
            return error;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn shutdown_has_a_deadline_even_when_a_connection_never_closes() {
        let cancel = CancellationToken::new();
        let started = tokio::time::Instant::now();
        serve(std::future::pending(), vec![], cancel.clone(), std::future::ready(())).await.unwrap();
        assert!(cancel.is_cancelled());
        assert_eq!(started.elapsed(), SHUTDOWN_TIMEOUT);
    }

    #[tokio::test(start_paused = true)]
    async fn a_finite_backfill_does_not_stop_the_server() {
        let cancel = CancellationToken::new();
        let stopped = cancel.clone();
        let server = async move {
            stopped.cancelled().await;
            Ok(())
        };
        let started = tokio::time::Instant::now();
        serve(server, vec![tokio::spawn(async {})], cancel, tokio::time::sleep(Duration::from_secs(1))).await.unwrap();
        assert_eq!(started.elapsed(), Duration::from_secs(1));
    }

    #[tokio::test]
    async fn a_worker_panic_cancels_the_server_and_is_reported() {
        let cancel = CancellationToken::new();
        let stopped = cancel.clone();
        let server = async move {
            stopped.cancelled().await;
            Ok(())
        };
        let result = serve(
            server,
            vec![tokio::spawn(async { panic!("worker failed") })],
            cancel.clone(),
            std::future::pending(),
        )
        .await;
        assert!(result.is_err());
        assert!(cancel.is_cancelled());
    }
}
