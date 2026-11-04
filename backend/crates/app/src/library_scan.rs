// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{DateTime, Utc};
use media::formats;
use serde::Serialize;
use sqlx::PgPool;
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::catalog::edit;
use crate::error::Message;
use crate::i18n::Lang;
use crate::storage::{self, LIBRARY_DIRECTORY, Storage, StoredFile};
use crate::upload::Uploads;
use crate::{AppError, json};

const STARTUP_DELAY: Duration = Duration::from_secs(15);
const MISSING_GRACE: chrono::Duration = chrono::Duration::days(30);
const MAX_PROBLEMS: usize = 50;
const MAX_COVER_BYTES: u64 = 20 * 1024 * 1024;
const COVER_NAMES: [&str; 3] = ["cover", "folder", "front"];
const COVER_EXTENSIONS: [&str; 3] = ["jpg", "jpeg", "png"];
const OTHER_AUDIO: [&str; 12] = ["m4a", "aac", "ogg", "opus", "wav", "aif", "aiff", "ape", "wma", "wv", "alac", "dsf"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Status {
    Linked = 1,
    Removed = 2,
    Skipped = 3,
    Failed = 4,
}

impl Status {
    fn from_db(value: i16) -> Self {
        match value {
            1 => Self::Linked,
            2 => Self::Removed,
            3 => Self::Skipped,
            _ => Self::Failed,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProblemDto {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStatusDto {
    pub configured: bool,
    pub running: bool,
    #[serde(serialize_with = "json::optional_time")]
    pub started_at: Option<DateTime<Utc>>,
    #[serde(serialize_with = "json::optional_time")]
    pub finished_at: Option<DateTime<Utc>>,
    pub files: u64,
    pub checked: u64,
    pub added: u64,
    pub moved: u64,
    pub updated: u64,
    pub skipped: u64,
    pub failed: u64,
    pub missing: u64,
    pub removed: u64,
    pub unsupported: u64,
    pub problems: Vec<ScanProblemDto>,
}

#[derive(Debug, Default)]
struct Progress {
    status: ScanStatusDto,
    problems: Vec<(String, Message)>,
}

#[derive(Debug, Clone)]
struct DiskFile {
    path: String,
    size: i64,
    modified: DateTime<Utc>,
}

#[derive(Debug, Default)]
struct Walked {
    files: Vec<DiskFile>,
    unsupported: u64,
    unusable: Vec<String>,
}

enum Action {
    Unchanged { was_missing: bool },
    Removed { content_hash: Option<String> },
    Changed { track: Uuid, content_hash: Option<String> },
    Added,
}

#[derive(Debug)]
struct Known {
    size: i64,
    modified: DateTime<Utc>,
    content_hash: Option<String>,
    track_id: Option<Uuid>,
    status: Status,
    missing_since: Option<DateTime<Utc>>,
}

#[derive(Clone)]
pub struct LibraryScanner {
    db: PgPool,
    storage: Storage,
    uploads: Uploads,
    progress: Arc<Mutex<Progress>>,
    wake: Arc<Notify>,
}

impl LibraryScanner {
    pub fn new(db: PgPool, storage: Storage, uploads: Uploads) -> Self {
        Self { db, storage, uploads, progress: Arc::default(), wake: Arc::new(Notify::new()) }
    }

    pub fn status(&self, lang: Lang) -> ScanStatusDto {
        let mut status = self
            .progress
            .lock()
            .map(|progress| {
                let mut status = progress.status.clone();
                status.problems = progress
                    .problems
                    .iter()
                    .map(|(path, reason)| ScanProblemDto { path: path.clone(), reason: reason.localized(lang) })
                    .collect();
                status
            })
            .unwrap_or_default();
        status.configured = self.storage.library_root().is_some();
        status
    }

    pub fn request(&self) {
        self.wake.notify_one();
    }

    pub fn spawn(self, interval: Option<Duration>, cancel: CancellationToken) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let mut wait = STARTUP_DELAY;
            let mut first = true;
            loop {
                tokio::select! {
                    () = cancel.cancelled() => return,
                    () = self.wake.notified() => {}
                    () = tokio::time::sleep(wait), if first || interval.is_some() => {}
                }
                first = false;
                wait = interval.unwrap_or(wait);
                if let Some(root) = self.storage.library_root() {
                    self.scan(&root, &cancel).await;
                }
            }
        })
    }

    async fn scan(&self, root: &Path, cancel: &CancellationToken) {
        self.update(|progress| {
            *progress = Progress::default();
            progress.status.running = true;
            progress.status.started_at = Some(Utc::now());
        });
        let started = std::time::Instant::now();
        if let Err(error) = self.run(root, cancel).await {
            tracing::error!("Scanning the music folder failed: {error:#}");
            self.problem(String::new(), message("The music folder could not be scanned."));
        }
        let status = self.status(Lang::En);
        tracing::info!(
            "Scanned the music folder in {:.1} s: {} files, {} added, {} moved, {} updated, {} skipped, {} failed, {} missing, {} removed",
            started.elapsed().as_secs_f64(),
            status.files,
            status.added,
            status.moved,
            status.updated,
            status.skipped,
            status.failed,
            status.missing,
            status.removed
        );
        self.update(|progress| {
            progress.status.running = false;
            progress.status.finished_at = Some(Utc::now());
        });
    }

    async fn run(&self, root: &Path, cancel: &CancellationToken) -> anyhow::Result<()> {
        sqlx::query!(
            "UPDATE library_files SET status = $1 WHERE status = $2 AND track_id IS NULL",
            Status::Removed as i16,
            Status::Linked as i16
        )
        .execute(&self.db)
        .await?;

        let walk_root = root.to_path_buf();
        let walked = tokio::task::spawn_blocking(move || walk(&walk_root)).await?;
        self.update(|progress| {
            progress.status.files = walked.files.len() as u64;
            progress.status.unsupported = walked.unsupported;
        });
        for path in &walked.unusable {
            self.failed(path, message("The file name contains ':', which the player cannot serve."));
        }

        let mut known: HashMap<String, Known> = sqlx::query!(
            "SELECT path, size_bytes, modified_at, content_hash, track_id, status, missing_since FROM library_files"
        )
        .fetch_all(&self.db)
        .await?
        .into_iter()
        .map(|row| {
            let known = Known {
                size: row.size_bytes,
                modified: row.modified_at,
                content_hash: row.content_hash,
                track_id: row.track_id,
                status: Status::from_db(row.status),
                missing_since: row.missing_since,
            };
            (row.path, known)
        })
        .collect();

        if walked.files.is_empty() && known.values().any(|row| row.status == Status::Linked) {
            tracing::warn!("The music folder is empty: assuming it is not mounted and keeping every track");
            self.problem(String::new(), message("The music folder is empty. Is the drive connected?"));
            return Ok(());
        }

        let on_disk: HashSet<&str> = walked.files.iter().map(|file| file.path.as_str()).collect();
        let mut gone: HashMap<String, (String, Uuid)> = known
            .iter()
            .filter(|(path, row)| !on_disk.contains(path.as_str()) && row.status == Status::Linked)
            .filter_map(|(path, row)| Some((row.content_hash.clone()?, (path.clone(), row.track_id?))))
            .collect();

        for file in &walked.files {
            if cancel.is_cancelled() {
                return Ok(());
            }
            self.update(|progress| progress.status.checked += 1);
            let action = match known.get(&file.path) {
                Some(row) if row.size == file.size && row.modified == file.modified => {
                    Action::Unchanged { was_missing: row.missing_since.is_some() }
                }
                Some(row) if row.status == Status::Removed => {
                    Action::Removed { content_hash: row.content_hash.clone() }
                }
                Some(Known { status: Status::Linked, track_id: Some(track), content_hash, .. }) => {
                    Action::Changed { track: *track, content_hash: content_hash.clone() }
                }
                _ => Action::Added,
            };
            match action {
                Action::Unchanged { was_missing: true } => {
                    sqlx::query!("UPDATE library_files SET missing_since = NULL WHERE path = $1", file.path)
                        .execute(&self.db)
                        .await?;
                }
                Action::Unchanged { was_missing: false } => {}
                Action::Removed { content_hash } => {
                    self.remember(file, content_hash.as_deref(), None, Status::Removed, None).await?;
                }
                Action::Changed { track, content_hash } => {
                    self.changed(root, file, track, content_hash.as_deref()).await?;
                }
                Action::Added => self.added(root, file, &mut gone, &mut known).await?,
            }
        }

        let now = Utc::now();
        for (path, row) in &known {
            if on_disk.contains(path.as_str()) {
                continue;
            }
            let track = row.track_id.filter(|_| row.status == Status::Linked);
            if track.is_none() && row.status != Status::Removed {
                sqlx::query!("DELETE FROM library_files WHERE path = $1", path).execute(&self.db).await?;
                continue;
            }
            match row.missing_since {
                None => {
                    sqlx::query!("UPDATE library_files SET missing_since = $2 WHERE path = $1", path, now)
                        .execute(&self.db)
                        .await?;
                    if track.is_some() {
                        self.update(|progress| progress.status.missing += 1);
                    }
                }
                Some(since) if now - since >= MISSING_GRACE => {
                    if let Some(track) = track {
                        let still_here = sqlx::query_scalar!(
                            r#"SELECT EXISTS (SELECT 1 FROM tracks WHERE id = $1 AND file_path = $2) AS "exists!""#,
                            track,
                            library_path(path)
                        )
                        .fetch_one(&self.db)
                        .await?;
                        if still_here {
                            edit::delete_tracks(&self.db, &self.storage, &[track]).await?;
                        }
                        self.update(|progress| progress.status.removed += 1);
                    }
                    sqlx::query!("DELETE FROM library_files WHERE path = $1", path).execute(&self.db).await?;
                }
                Some(_) if track.is_some() => self.update(|progress| progress.status.missing += 1),
                Some(_) => {}
            }
        }
        Ok(())
    }

    async fn changed(&self, root: &Path, file: &DiskFile, track: Uuid, previous: Option<&str>) -> anyhow::Result<()> {
        let Some((size, hash)) = self.hash(root, file).await else { return Ok(()) };
        if previous == Some(hash.as_str()) {
            return self.remember(file, Some(&hash), Some(track), Status::Linked, None).await;
        }

        let updated = sqlx::query!(
            "UPDATE tracks SET content_hash = $2, file_size = $3 WHERE id = $1 AND file_path = $4",
            track,
            hash,
            size,
            library_path(&file.path)
        )
        .execute(&self.db)
        .await;
        match updated {
            Ok(_) => {
                if let Some(old) = previous {
                    self.storage.delete_transcodes(old);
                }
                self.uploads.hashes.forget(track);
                self.update(|progress| progress.status.updated += 1);
                self.remember(file, Some(&hash), Some(track), Status::Linked, None).await
            }
            Err(sqlx::Error::Database(error)) if error.is_unique_violation() => {
                let reason = message("The file now has the same content as another track.");
                self.failed(&file.path, reason.clone());
                self.remember(file, Some(&hash), Some(track), Status::Linked, Some(&reason)).await
            }
            Err(error) => Err(error.into()),
        }
    }

    async fn added(
        &self,
        root: &Path,
        file: &DiskFile,
        gone: &mut HashMap<String, (String, Uuid)>,
        known: &mut HashMap<String, Known>,
    ) -> anyhow::Result<()> {
        let Some(format) = formats::for_file_name(&file.path) else { return Ok(()) };
        let Some((size, hash)) = self.hash(root, file).await else { return Ok(()) };

        if let Some((old_path, track)) = gone.remove(&hash) {
            sqlx::query!(
                "UPDATE tracks SET file_path = $2, original_file_name = $3 WHERE id = $1 AND file_path = $4",
                track,
                library_path(&file.path),
                file_name(&file.path),
                library_path(&old_path)
            )
            .execute(&self.db)
            .await?;
            sqlx::query!("DELETE FROM library_files WHERE path = $1", old_path).execute(&self.db).await?;
            known.remove(&old_path);
            self.update(|progress| progress.status.moved += 1);
            return self.remember(file, Some(&hash), Some(track), Status::Linked, None).await;
        }

        let stored =
            StoredFile { relative_path: library_path(&file.path), size_bytes: size, content_hash: hash.clone() };
        let directory = root.join(&file.path).parent().map(Path::to_path_buf);
        let cover = match directory {
            Some(directory) => tokio::task::spawn_blocking(move || folder_cover(&directory)).await.unwrap_or(None),
            None => None,
        };
        match self.uploads.import(file_name(&file.path), &stored, format, cover).await {
            Ok(imported) => {
                self.update(|progress| progress.status.added += 1);
                self.remember(file, Some(&hash), Some(imported.id), Status::Linked, None).await
            }
            Err(AppError::Conflict(reason)) => {
                self.update(|progress| progress.status.skipped += 1);
                self.remember(file, Some(&hash), None, Status::Skipped, Some(&reason)).await
            }
            Err(error) => {
                let reason = match error.message() {
                    Some(reason) => reason.clone(),
                    None => {
                        tracing::error!("Importing {} failed: {error:#}", file.path);
                        message("The file could not be processed.")
                    }
                };
                self.failed(&file.path, reason.clone());
                self.remember(file, Some(&hash), None, Status::Failed, Some(&reason)).await
            }
        }
    }

    async fn hash(&self, root: &Path, file: &DiskFile) -> Option<(i64, String)> {
        let path = root.join(&file.path);
        match tokio::task::spawn_blocking(move || storage::hash_file(&path)).await {
            Ok(Ok(hashed)) => Some(hashed),
            Ok(Err(error)) => {
                tracing::warn!("Could not read {}: {error}", file.path);
                self.failed(&file.path, message("The file could not be read."));
                None
            }
            Err(error) => {
                tracing::error!("Hashing {} crashed: {error}", file.path);
                None
            }
        }
    }

    async fn remember(
        &self,
        file: &DiskFile,
        content_hash: Option<&str>,
        track: Option<Uuid>,
        status: Status,
        problem: Option<&Message>,
    ) -> anyhow::Result<()> {
        sqlx::query!(
            "INSERT INTO library_files (path, size_bytes, modified_at, content_hash, track_id, status, problem,
                                        missing_since, scanned_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8)
             ON CONFLICT (path) DO UPDATE SET
                 size_bytes = EXCLUDED.size_bytes, modified_at = EXCLUDED.modified_at,
                 content_hash = EXCLUDED.content_hash, track_id = EXCLUDED.track_id, status = EXCLUDED.status,
                 problem = EXCLUDED.problem, missing_since = NULL, scanned_at = EXCLUDED.scanned_at",
            file.path,
            file.size,
            file.modified,
            content_hash,
            track,
            status as i16,
            problem.map(|reason| reason.to_string().chars().take(300).collect::<String>()),
            Utc::now()
        )
        .execute(&self.db)
        .await?;
        Ok(())
    }

    fn failed(&self, path: &str, reason: Message) {
        self.update(|progress| progress.status.failed += 1);
        self.problem(path.to_owned(), reason);
    }

    fn problem(&self, path: String, reason: Message) {
        self.update(|progress| {
            if progress.problems.len() < MAX_PROBLEMS {
                progress.problems.push((path, reason));
            }
        });
    }

    fn update(&self, change: impl FnOnce(&mut Progress)) {
        if let Ok(mut progress) = self.progress.lock() {
            change(&mut progress);
        }
    }
}

pub async fn release(db: &PgPool, relative: &str) -> sqlx::Result<()> {
    let Some(path) = relative.strip_prefix(LIBRARY_DIRECTORY).and_then(|rest| rest.strip_prefix('/')) else {
        return Ok(());
    };
    sqlx::query!("UPDATE library_files SET status = $2, track_id = NULL WHERE path = $1", path, Status::Removed as i16)
        .execute(db)
        .await?;
    Ok(())
}

fn message(template: &'static str) -> Message {
    Message { template, args: Vec::new() }
}

fn library_path(path: &str) -> String {
    format!("{LIBRARY_DIRECTORY}/{path}")
}

fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn walk(root: &Path) -> Walked {
    let mut walked = Walked::default();
    let entries = walkdir::WalkDir::new(root)
        .follow_links(true)
        .into_iter()
        .filter_entry(|entry| entry.depth() == 0 || !entry.file_name().to_string_lossy().starts_with('.'));
    for entry in entries.filter_map(Result::ok) {
        if !entry.file_type().is_file() {
            continue;
        }
        let Ok(relative) = entry.path().strip_prefix(root) else { continue };
        let Some(path) = relative.to_str().map(|path| path.replace('\\', "/")) else { continue };
        if formats::for_file_name(&path).is_none() {
            let extension = Path::new(&path).extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase);
            if extension.is_some_and(|extension| OTHER_AUDIO.contains(&extension.as_str())) {
                walked.unsupported += 1;
            }
            continue;
        }
        if path.contains(':') {
            walked.unusable.push(path);
            continue;
        }
        let Ok(metadata) = entry.metadata() else { continue };
        let Some(modified) = metadata
            .modified()
            .ok()
            .map(DateTime::<Utc>::from)
            .and_then(|at| DateTime::from_timestamp_micros(at.timestamp_micros()))
        else {
            continue;
        };
        walked.files.push(DiskFile { path, size: i64::try_from(metadata.len()).unwrap_or(i64::MAX), modified });
    }
    walked.files.sort_by(|a, b| a.path.cmp(&b.path));
    walked
}

fn folder_cover(directory: &Path) -> Option<Vec<u8>> {
    let entries = std::fs::read_dir(directory).ok()?;
    let mut candidates: Vec<(usize, PathBuf)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let stem = path.file_stem()?.to_str()?.to_ascii_lowercase();
            let extension = path.extension()?.to_str()?.to_ascii_lowercase();
            let rank = COVER_NAMES.iter().position(|name| *name == stem)?;
            COVER_EXTENSIONS.contains(&extension.as_str()).then_some((rank, path))
        })
        .collect();
    candidates.sort();
    let (_, path) = candidates.into_iter().next()?;
    let size = std::fs::metadata(&path).ok()?.len();
    (size <= MAX_COVER_BYTES).then(|| std::fs::read(&path).ok()).flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("caimack-library-{}", Uuid::now_v7().simple()));
        std::fs::create_dir_all(&dir).unwrap_or_default();
        dir
    }

    fn touch(dir: &Path, relative: &str, bytes: &[u8]) {
        let path = dir.join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap_or_default();
        }
        std::fs::write(path, bytes).unwrap_or_default();
    }

    #[test]
    fn walking_keeps_supported_audio_and_counts_the_rest() {
        let dir = folder();
        touch(&dir, "Artist/Album/01 Song.mp3", b"a");
        touch(&dir, "Artist/Album/02 Song.FLAC", b"bb");
        touch(&dir, "Artist/Album/03 Song.m4a", b"c");
        touch(&dir, "Artist/Album/cover.jpg", b"img");
        touch(&dir, "Artist/Album/._01 Song.mp3", b"junk");
        touch(&dir, ".hidden/secret.mp3", b"x");

        let walked = walk(&dir);
        let paths: Vec<&str> = walked.files.iter().map(|file| file.path.as_str()).collect();

        assert_eq!(paths, ["Artist/Album/01 Song.mp3", "Artist/Album/02 Song.FLAC"]);
        assert_eq!(walked.files[1].size, 2);
        assert_eq!(walked.unsupported, 1);
        std::fs::remove_dir_all(dir).unwrap_or_default();
    }

    #[test]
    fn folder_art_prefers_cover_then_folder_then_front() {
        let dir = folder();
        touch(&dir, "front.png", b"front");
        touch(&dir, "Folder.JPG", b"folder");
        touch(&dir, "Band.jpg", b"band");
        assert_eq!(folder_cover(&dir).as_deref(), Some(&b"folder"[..]));

        touch(&dir, "cover.jpeg", b"cover");
        assert_eq!(folder_cover(&dir).as_deref(), Some(&b"cover"[..]));
        std::fs::remove_dir_all(dir).unwrap_or_default();
    }

    #[test]
    fn library_paths_live_under_the_music_folder() {
        assert_eq!(library_path("A/B/c.mp3"), "library/A/B/c.mp3");
        assert_eq!(file_name("A/B/c.mp3"), "c.mp3");
    }
}
