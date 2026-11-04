// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::i18n::Lang;
use crate::{AppError, AppResult, json};

const KEPT_JOBS: usize = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ImportKind {
    Likes,
    Album,
    Track,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ImportStatus {
    Queued,
    Running,
    Finished,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportFailure {
    pub title: String,
    pub reason: String,
}

#[skip_serializing_none]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDto {
    pub id: Uuid,
    pub kind: ImportKind,
    pub title: Option<String>,
    pub status: ImportStatus,
    pub error: Option<String>,
    pub total: usize,
    pub done: usize,
    pub added: usize,
    pub skipped: usize,
    pub current: Option<String>,
    pub failures: Vec<ImportFailure>,
    #[serde(serialize_with = "json::time")]
    pub created_at: DateTime<Utc>,
}

pub struct ImportJob {
    pub id: Uuid,
    pub kind: ImportKind,
    pub source_id: Option<String>,
    pub token: String,

    pub lang: Lang,
    pub created_at: DateTime<Utc>,
    pub cancelled: CancellationToken,
    progress: Mutex<Progress>,
}

struct Progress {
    status: ImportStatus,
    title: Option<String>,
    error: Option<String>,
    current: Option<String>,
    total: usize,
    done: usize,
    added: usize,
    skipped: usize,
    failures: Vec<ImportFailure>,
}

impl ImportJob {
    fn progress(&self) -> MutexGuard<'_, Progress> {
        self.progress.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub fn is_active(&self) -> bool {
        matches!(self.progress().status, ImportStatus::Queued | ImportStatus::Running)
    }

    pub fn start(&self, title: Option<String>, total: usize) {
        let mut progress = self.progress();
        progress.status = ImportStatus::Running;
        progress.title = title;
        progress.total = total;
    }

    pub fn importing(&self, track: &str) {
        self.progress().current = Some(track.to_owned());
    }

    pub fn added(&self) {
        let mut progress = self.progress();
        progress.added += 1;
        progress.step();
    }

    pub fn skipped(&self) {
        let mut progress = self.progress();
        progress.skipped += 1;
        progress.step();
    }

    pub fn track_failed(&self, track: &str, reason: String) {
        let mut progress = self.progress();
        progress.failures.push(ImportFailure { title: track.to_owned(), reason });
        progress.step();
    }

    pub fn finish(&self) {
        let mut progress = self.progress();
        progress.status = if self.cancelled.is_cancelled() { ImportStatus::Cancelled } else { ImportStatus::Finished };
        progress.current = None;
    }

    pub fn fail(&self, error: String) {
        let mut progress = self.progress();
        progress.status = ImportStatus::Failed;
        progress.error = Some(error);
        progress.current = None;
    }

    pub fn dto(&self) -> ImportDto {
        let progress = self.progress();
        ImportDto {
            id: self.id,
            kind: self.kind,
            title: progress.title.clone(),
            status: progress.status,
            error: progress.error.clone(),
            total: progress.total,
            done: progress.done,
            added: progress.added,
            skipped: progress.skipped,
            current: progress.current.clone(),
            failures: progress.failures.clone(),
            created_at: self.created_at,
        }
    }
}

impl Progress {
    fn step(&mut self) {
        self.done += 1;
        self.current = None;
    }
}

#[derive(Clone)]
pub struct ImportQueue {
    sender: mpsc::UnboundedSender<Arc<ImportJob>>,
    jobs: Arc<Mutex<HashMap<Uuid, Arc<ImportJob>>>>,
}

impl ImportQueue {
    pub fn new() -> (Self, mpsc::UnboundedReceiver<Arc<ImportJob>>) {
        let (sender, receiver) = mpsc::unbounded_channel();
        (Self { sender, jobs: Arc::default() }, receiver)
    }

    fn jobs(&self) -> MutexGuard<'_, HashMap<Uuid, Arc<ImportJob>>> {
        self.jobs.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub fn enqueue(
        &self,
        kind: ImportKind,
        source_id: Option<String>,
        token: String,
        lang: Lang,
    ) -> AppResult<ImportDto> {
        let mut jobs = self.jobs();
        if jobs.values().any(|job| job.is_active() && job.kind == kind && job.source_id == source_id) {
            return Err(AppError::conflict("This import is already running."));
        }

        let job = Arc::new(ImportJob {
            id: Uuid::now_v7(),
            kind,
            source_id,
            token,
            lang,
            created_at: Utc::now(),
            cancelled: CancellationToken::new(),
            progress: Mutex::new(Progress {
                status: ImportStatus::Queued,
                title: None,
                error: None,
                current: None,
                total: 0,
                done: 0,
                added: 0,
                skipped: 0,
                failures: Vec::new(),
            }),
        });
        jobs.insert(job.id, job.clone());
        forget_oldest(&mut jobs);

        let dto = job.dto();
        if self.sender.send(job).is_err() {
            tracing::error!("The Yandex Music import worker is not running");
        }
        Ok(dto)
    }

    pub fn list(&self) -> Vec<ImportDto> {
        let mut list: Vec<ImportDto> = self.jobs().values().map(|job| job.dto()).collect();
        list.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
        list
    }

    pub fn remove(&self, id: Uuid) -> bool {
        let mut jobs = self.jobs();
        let Some(job) = jobs.get(&id) else { return false };
        if job.is_active() {
            job.cancelled.cancel();
        } else {
            jobs.remove(&id);
        }
        true
    }
}

fn forget_oldest(jobs: &mut HashMap<Uuid, Arc<ImportJob>>) {
    let mut finished: Vec<(DateTime<Utc>, Uuid)> =
        jobs.values().filter(|job| !job.is_active()).map(|job| (job.created_at, job.id)).collect();
    finished.sort_by(|a, b| b.cmp(a));
    for (_, id) in finished.into_iter().skip(KEPT_JOBS) {
        jobs.remove(&id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn queue() -> (ImportQueue, mpsc::UnboundedReceiver<Arc<ImportJob>>) {
        ImportQueue::new()
    }

    #[test]
    fn the_same_source_cannot_run_twice() {
        let (queue, _receiver) = queue();
        let first = queue.enqueue(ImportKind::Album, Some("1".into()), "t".into(), Lang::En);
        assert!(first.is_ok());
        let again = queue.enqueue(ImportKind::Album, Some("1".into()), "t".into(), Lang::En);
        assert!(matches!(again, Err(AppError::Conflict(_))));
        assert!(queue.enqueue(ImportKind::Album, Some("2".into()), "t".into(), Lang::En).is_ok());
    }

    #[test]
    fn removing_cancels_a_running_import_and_forgets_a_finished_one() -> AppResult<()> {
        let (queue, mut receiver) = queue();
        let dto = queue.enqueue(ImportKind::Likes, None, "t".into(), Lang::En)?;
        let job = receiver.try_recv().map_err(AppError::internal)?;

        assert!(queue.remove(dto.id));
        assert!(job.cancelled.is_cancelled());
        job.finish();
        assert_eq!(queue.list()[0].status, ImportStatus::Cancelled);

        assert!(queue.remove(dto.id));
        assert!(queue.list().is_empty());
        assert!(!queue.remove(dto.id));
        Ok(())
    }

    #[test]
    fn progress_counts_every_track_once() -> AppResult<()> {
        let (queue, mut receiver) = queue();
        queue.enqueue(ImportKind::Likes, None, "t".into(), Lang::En)?;
        let job = receiver.try_recv().map_err(AppError::internal)?;

        job.start(Some("Likes".into()), 3);
        job.importing("A — 1");
        job.added();
        job.skipped();
        job.track_failed("A — 3", "nope".into());
        job.finish();

        let dto = job.dto();
        assert_eq!((dto.status, dto.total, dto.done, dto.added, dto.skipped), (ImportStatus::Finished, 3, 3, 1, 1));
        assert_eq!(dto.current, None);
        assert_eq!(dto.failures[0].reason, "nope");
        Ok(())
    }
}
