// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use sqlx::PgPool;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::library::settings::AudioQuality;
use crate::storage::Storage;

const URGENT_CAPACITY: usize = 128;
const WARMUP_CAPACITY: usize = 512;
const BACKFILL_DELAY: Duration = Duration::from_secs(30);
const BACKFILL_BATCH: usize = 8;
const BACKFILL_PAUSE: Duration = Duration::from_secs(5);

pub const WARMUP_QUALITIES: [AudioQuality; 2] = [AudioQuality::Low, AudioQuality::Normal];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranscodeRequest {
    pub content_hash: String,
    pub source: String,
    pub quality: AudioQuality,
}

impl TranscodeRequest {
    fn key(&self) -> String {
        format!("{}:{}", self.content_hash, self.quality.slug())
    }
}

pub fn worthwhile(quality: AudioQuality, codec: Option<&str>, source_kbps: Option<i32>) -> bool {
    let Some(kbps) = quality.hls_kbps() else { return false };
    media::formats::is_lossless(codec) || source_kbps.is_none_or(|source| i64::from(kbps) < i64::from(source))
}

pub fn warmup_for(content_hash: &str, source: &str, codec: Option<&str>, kbps: Option<i32>) -> Vec<TranscodeRequest> {
    WARMUP_QUALITIES
        .into_iter()
        .filter(|&quality| worthwhile(quality, codec, kbps))
        .map(|quality| TranscodeRequest { content_hash: content_hash.to_owned(), source: source.to_owned(), quality })
        .collect()
}

#[derive(Clone)]
pub struct TranscodeQueue {
    urgent: mpsc::Sender<TranscodeRequest>,
    warmup: mpsc::Sender<TranscodeRequest>,
    urgent_keys: Arc<Mutex<HashSet<String>>>,
    warmup_keys: Arc<Mutex<HashSet<String>>>,
}

pub struct TranscodeReceivers {
    urgent: mpsc::Receiver<TranscodeRequest>,
    warmup: mpsc::Receiver<TranscodeRequest>,
}

impl TranscodeQueue {
    pub fn new() -> (Self, TranscodeReceivers) {
        let (urgent, urgent_rx) = mpsc::channel(URGENT_CAPACITY);
        let (warmup, warmup_rx) = mpsc::channel(WARMUP_CAPACITY);
        let queue = Self { urgent, warmup, urgent_keys: Arc::default(), warmup_keys: Arc::default() };
        (queue, TranscodeReceivers { urgent: urgent_rx, warmup: warmup_rx })
    }

    pub fn try_enqueue_urgent(&self, request: TranscodeRequest) -> bool {
        enqueue(&self.urgent, &self.urgent_keys, request)
    }

    pub fn try_enqueue_warmup(&self, request: TranscodeRequest) -> bool {
        enqueue(&self.warmup, &self.warmup_keys, request)
    }
}

fn enqueue(sender: &mpsc::Sender<TranscodeRequest>, keys: &Mutex<HashSet<String>>, request: TranscodeRequest) -> bool {
    let key = request.key();
    let Ok(mut queued) = keys.lock() else { return false };
    if !queued.insert(key.clone()) {
        return false;
    }
    if sender.try_send(request).is_ok() {
        return true;
    }
    queued.remove(&key);
    false
}

fn dequeued(keys: &Mutex<HashSet<String>>, request: &TranscodeRequest) {
    if let Ok(mut queued) = keys.lock() {
        queued.remove(&request.key());
    }
}

pub fn spawn(
    db: PgPool,
    storage: Storage,
    queue: TranscodeQueue,
    receivers: TranscodeReceivers,
    cancel: CancellationToken,
) -> Vec<tokio::task::JoinHandle<()>> {
    let workers = crate::background::capacity();
    let warmup_workers = (workers - 1).max(1);
    let running: Arc<Mutex<HashSet<String>>> = Arc::default();
    let warmup = Arc::new(tokio::sync::Mutex::new(receivers.warmup));

    let mut handles = Vec::new();
    let urgent_keys = Arc::clone(&queue.urgent_keys);
    let mut urgent = receivers.urgent;
    let (storage_u, running_u, cancel_u) = (storage.clone(), Arc::clone(&running), cancel.clone());
    handles.push(tokio::spawn(async move {
        loop {
            let request = tokio::select! {
                () = cancel_u.cancelled() => break,
                request = urgent.recv() => request,
            };
            let Some(request) = request else { break };
            dequeued(&urgent_keys, &request);
            transcode(&storage_u, &running_u, request, &cancel_u).await;
        }
    }));

    for _ in 0..warmup_workers {
        let (storage, running, cancel, warmup) =
            (storage.clone(), Arc::clone(&running), cancel.clone(), Arc::clone(&warmup));
        let keys = Arc::clone(&queue.warmup_keys);
        handles.push(tokio::spawn(async move {
            loop {
                let request = tokio::select! {
                    () = cancel.cancelled() => break,
                    request = async { warmup.lock().await.recv().await } => request,
                };
                let Some(request) = request else { break };
                dequeued(&keys, &request);
                transcode(&storage, &running, request, &cancel).await;
            }
        }));
    }

    handles.push(tokio::spawn(backfill(db, storage, queue, cancel)));
    tracing::debug!("Transcode worker started: 1 urgent worker, {warmup_workers} warmup workers");
    handles
}

async fn transcode(
    storage: &Storage,
    running: &Mutex<HashSet<String>>,
    request: TranscodeRequest,
    cancel: &CancellationToken,
) {
    let key = request.key();
    if !running.lock().is_ok_and(|mut set| set.insert(key.clone())) {
        return;
    }

    let outcome = async {
        let Some(bitrate) = request.quality.hls_kbps() else { return Ok(()) };
        let Some(source) = storage.existing(&request.source) else {
            tracing::warn!("Skipped transcoding {key}: {} is missing from storage", request.source);
            return Ok(());
        };
        if storage.hls_variant_ready(&request.content_hash, request.quality) {
            return Ok(());
        }

        let target = storage.hls_variant_dir(&request.content_hash, request.quality)?;
        if let Some(parent) = target.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let started = Instant::now();
        let _permit = tokio::select! {
            () = cancel.cancelled() => return Ok(()),
            permit = crate::background::permit() => permit?,
        };
        let done = tokio::select! {
            () = cancel.cancelled() => return Ok(()),
            done = media::ffmpeg::transcode_to_hls(&source, &target, bitrate) => done?,
        };
        if done {
            tracing::debug!(
                "Prepared the {} HLS rendition of {} in {:.1} s",
                request.quality.slug(),
                request.content_hash,
                started.elapsed().as_secs_f64()
            );
        }
        anyhow::Ok(())
    }
    .await;

    if let Err(error) = outcome {
        tracing::error!("Transcoding {key} failed unexpectedly: {error:#}");
    }
    if let Ok(mut set) = running.lock() {
        set.remove(&key);
    }
}

async fn backfill(db: PgPool, storage: Storage, queue: TranscodeQueue, cancel: CancellationToken) {
    tokio::select! {
        () = cancel.cancelled() => return,
        () = tokio::time::sleep(BACKFILL_DELAY) => {}
    }

    let tracks = match sqlx::query!("SELECT DISTINCT content_hash, file_path, codec, bitrate_kbps FROM tracks")
        .fetch_all(&db)
        .await
    {
        Ok(tracks) => tracks,
        Err(error) => {
            tracing::error!("Transcode backfill stopped unexpectedly: {error}");
            return;
        }
    };

    let mut pending: std::collections::VecDeque<TranscodeRequest> = tracks
        .iter()
        .flat_map(|t| warmup_for(&t.content_hash, &t.file_path, t.codec.as_deref(), t.bitrate_kbps))
        .filter(|request| !storage.hls_variant_ready(&request.content_hash, request.quality))
        .collect();
    if pending.is_empty() {
        return;
    }
    tracing::info!("Warming {} missing renditions", pending.len());

    while !pending.is_empty() {
        let mut carried = Vec::new();
        for _ in 0..BACKFILL_BATCH {
            let Some(request) = pending.pop_front() else { break };
            if !storage.hls_variant_ready(&request.content_hash, request.quality)
                && !queue.try_enqueue_warmup(request.clone())
            {
                carried.push(request);
            }
        }
        pending.extend(carried);
        if !pending.is_empty() {
            tokio::select! {
                () = cancel.cancelled() => return,
                () = tokio::time::sleep(BACKFILL_PAUSE) => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lossy_source_at_or_below_the_variant_is_not_transcoded() {
        assert!(!worthwhile(AudioQuality::Normal, Some("mp3"), Some(128)));
    }

    #[test]
    fn lossless_is_always_transcoded() {
        assert!(worthwhile(AudioQuality::Normal, Some("flac"), Some(100)));
    }

    #[test]
    fn duplicate_requests_are_queued_once() {
        let (queue, _receivers) = TranscodeQueue::new();
        let request = TranscodeRequest {
            content_hash: "h".to_owned(),
            source: "music/x.mp3".to_owned(),
            quality: AudioQuality::Low,
        };
        assert_eq!([queue.try_enqueue_warmup(request.clone()), queue.try_enqueue_warmup(request)], [true, false]);
    }
}
