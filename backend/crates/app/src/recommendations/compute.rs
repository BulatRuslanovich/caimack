// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

use std::sync::Arc;

use tokio::sync::Semaphore;

use crate::{AppError, AppResult};

#[derive(Clone)]
pub(super) struct ComputePool(Arc<Semaphore>);

impl Default for ComputePool {
    fn default() -> Self {
        // Interactive recommendations must not queue behind background audio analysis.
        let capacity = std::thread::available_parallelism().map_or(1, |cores| (cores.get() / 2).clamp(1, 4));
        Self(Arc::new(Semaphore::new(capacity)))
    }
}

impl ComputePool {
    pub async fn run<T: Send + 'static>(&self, work: impl FnOnce() -> T + Send + 'static) -> AppResult<T> {
        let permit = Arc::clone(&self.0).acquire_owned().await.map_err(AppError::internal)?;
        tokio::task::spawn_blocking(move || {
            // Retain the slot until the calculation ends, even if its HTTP request is cancelled.
            let _permit = permit;
            work()
        })
        .await
        .map_err(AppError::internal)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn computations_do_not_run_on_the_async_executor() -> AppResult<()> {
        let executor = std::thread::current().id();
        let worker = ComputePool::default().run(|| std::thread::current().id()).await?;
        assert_ne!(executor, worker);
        Ok(())
    }

    #[tokio::test]
    async fn cancelling_a_request_does_not_release_a_running_computation_slot() {
        let pool = ComputePool(Arc::new(Semaphore::new(1)));
        let (started, running) = tokio::sync::oneshot::channel();
        let (release, blocked) = std::sync::mpsc::channel();
        let first_pool = pool.clone();
        let first = tokio::spawn(async move {
            first_pool
                .run(move || {
                    let _ = started.send(());
                    let _ = blocked.recv();
                })
                .await
        });
        running.await.unwrap();
        first.abort();
        assert!(first.await.unwrap_err().is_cancelled());
        assert_eq!(pool.0.available_permits(), 0, "the cancelled HTTP task must not release the worker's slot");
        let mut second = std::pin::pin!(pool.run(|| 42));
        assert!(
            std::future::poll_fn(|cx| std::task::Poll::Ready(
                std::future::Future::poll(second.as_mut(), cx).is_pending()
            ))
            .await
        );
        release.send(()).unwrap();
        assert_eq!(second.await.unwrap(), 42);
    }
}
