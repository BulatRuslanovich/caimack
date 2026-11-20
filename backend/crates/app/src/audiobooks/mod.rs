// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

mod edits;
mod names;
mod scan;
mod state;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::{Duration, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tokio::sync::Notify;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::i18n::{self, Lang};
use crate::{AppError, AppResult};

pub use edits::BookEdit;

#[derive(Clone, Default)]
pub struct Audiobooks {
    catalog: Arc<RwLock<Arc<Snapshot>>>,
    requested: Arc<Notify>,
}

#[derive(Default)]
struct Snapshot {
    root: PathBuf,
    books: HashMap<Uuid, Arc<Book>>,
}

struct Book {
    id: Uuid,
    title: String,
    author: Option<String>,
    narrator: Option<String>,
    duration_ms: i64,
    chapters: Vec<ChapterFile>,
    cover: Option<Artwork>,
    fingerprint: Vec<scan::SourceFile>,
}

struct ChapterFile {
    data: Chapter,
    path: PathBuf,
}

#[derive(Clone)]
pub struct Artwork {
    pub webp: Arc<[u8]>,
    pub etag: String,
}

impl Artwork {
    fn from_webp(webp: Vec<u8>) -> Self {
        let etag = format!("\"{}\"", crate::text::hex_lower(&Sha256::digest(&webp)));
        Self { webp: webp.into(), etag }
    }
}

pub struct AudioFile {
    pub path: PathBuf,
    pub content_type: &'static str,
    pub etag: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Audiobook {
    pub id: Uuid,
    pub title: String,
    pub author: Option<String>,
    pub narrator: Option<String>,
    pub year: Option<i32>,
    pub cover_url: Option<String>,
    pub duration_ms: i64,
    pub chapters: Vec<Chapter>,
    pub saved: bool,
    pub saved_at_ms: Option<i64>,
    pub progress: Option<Progress>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: Uuid,
    pub title: String,
    pub duration_ms: i64,
    pub size_bytes: i64,
    pub stream_url: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub chapter_id: Uuid,
    pub position_ms: i64,
    pub updated_at_ms: i64,
    #[serde(default)]
    pub completed: bool,
}

impl Audiobooks {
    pub async fn experiment_enabled(db: &PgPool) -> AppResult<bool> {
        Ok(sqlx::query_scalar("SELECT enabled FROM server_experiments WHERE name = 'audiobooks'")
            .fetch_optional(db)
            .await?
            .unwrap_or(false))
    }

    pub async fn set_experiment(&self, db: &PgPool, enabled: bool) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO server_experiments (name, enabled) VALUES ('audiobooks', $1)
                     ON CONFLICT (name) DO UPDATE SET enabled = EXCLUDED.enabled",
        )
        .bind(enabled)
        .execute(db)
        .await?;
        self.request_scan();
        Ok(())
    }

    pub fn spawn(
        &self,
        db: PgPool,
        root: PathBuf,
        interval: Option<Duration>,
        cancel: CancellationToken,
    ) -> JoinHandle<()> {
        let audiobooks = self.clone();
        tokio::spawn(async move {
            loop {
                if !matches!(Self::experiment_enabled(&db).await, Ok(true)) {
                    tokio::select! {
                        () = cancel.cancelled() => return,
                        () = audiobooks.requested.notified() => {},
                        () = tokio::time::sleep(Duration::from_secs(30)) => {},
                    }
                    continue;
                }
                let previous = audiobooks.snapshot();
                let root = root.clone();
                let cancel_scan = cancel.clone();
                let result = tokio::task::spawn_blocking(move || scan::read(&root, &previous, &cancel_scan)).await;
                if cancel.is_cancelled() {
                    return;
                }
                match result {
                    Ok(Ok(snapshot)) => {
                        tracing::debug!("Audiobook folder contains {} books", snapshot.books.len());
                        *audiobooks.catalog.write().unwrap_or_else(std::sync::PoisonError::into_inner) =
                            Arc::new(snapshot);
                    }
                    Ok(Err(error)) => tracing::warn!(%error, "Could not scan the audiobook folder"),
                    Err(error) => tracing::error!(%error, "Audiobook scan failed"),
                }
                let next_scan = async {
                    match interval {
                        Some(interval) => tokio::time::sleep(interval).await,
                        None => std::future::pending().await,
                    }
                };
                tokio::select! {
                    () = cancel.cancelled() => return,
                    () = audiobooks.requested.notified() => {},
                    () = next_scan => {},
                }
            }
        })
    }

    pub fn request_scan(&self) {
        self.requested.notify_one();
    }

    pub async fn list(&self, db: &PgPool, user_id: Uuid, lang: Lang) -> AppResult<Vec<Audiobook>> {
        let (mut state, edits) = tokio::try_join!(state::list(db, user_id), edits::list(db))?;
        let mut edits: HashMap<_, _> = edits.into_iter().map(|edit| (edit.book_id, edit)).collect();
        let mut books: Vec<_> = self
            .snapshot()
            .books
            .values()
            .map(|book| book.dto(state.remove(&book.id).unwrap_or_default(), edits.remove(&book.id), lang))
            .collect();
        books.sort_by_cached_key(|book| (book.title.to_lowercase(), book.id));
        Ok(books)
    }

    pub async fn get(&self, db: &PgPool, user_id: Uuid, id: Uuid, lang: Lang) -> AppResult<Audiobook> {
        let snapshot = self.snapshot();
        let book = snapshot.book(id)?;
        let (state, edit) = tokio::try_join!(state::get(db, user_id, id), edits::get(db, id))?;
        Ok(book.dto(state.unwrap_or_default(), edit, lang))
    }

    pub async fn edit(
        &self,
        db: &PgPool,
        id: Uuid,
        edit: BookEdit,
        image: Option<crate::covers::UploadedImage>,
    ) -> AppResult<()> {
        self.snapshot().book(id)?;
        edits::save(db, id, edit, image).await
    }

    pub async fn set_saved(&self, db: &PgPool, user_id: Uuid, id: Uuid, saved: bool) -> AppResult<()> {
        self.snapshot().book(id)?;
        state::set_saved(db, user_id, id, saved).await?;
        Ok(())
    }

    pub async fn set_progress(
        &self,
        db: &PgPool,
        user_id: Uuid,
        id: Uuid,
        mut progress: Progress,
    ) -> AppResult<Progress> {
        let snapshot = self.snapshot();
        let book = snapshot.book(id)?;
        if progress.updated_at_ms <= 0 || progress.position_ms < 0 {
            return Err(AppError::validation("Invalid audiobook progress."));
        }
        progress = book.normalize_progress(progress)?;
        progress.updated_at_ms = progress.updated_at_ms.min(chrono::Utc::now().timestamp_millis());
        let winning = state::set_progress(db, user_id, id, progress).await?;
        Ok(book.normalize_progress(winning).unwrap_or(winning))
    }

    pub async fn cover(&self, db: &PgPool, id: Uuid) -> AppResult<Artwork> {
        let snapshot = self.snapshot();
        edits::cover(db, id, &snapshot.book(id)?.cover)
            .await?
            .ok_or_else(|| AppError::not_found("Audiobook cover not found."))
    }

    pub async fn audio(&self, id: Uuid, chapter_id: Uuid) -> AppResult<AudioFile> {
        let snapshot = self.snapshot();
        let chapter = snapshot.book(id)?.chapter(chapter_id)?;
        let missing = || AppError::not_found("Audiobook audio file not found.");
        let content_type = scan::mime_type(&chapter.path).ok_or_else(missing)?;
        let path = tokio::fs::canonicalize(snapshot.root.join(&chapter.path)).await.map_err(|_| missing())?;
        if !path.starts_with(&snapshot.root) {
            return Err(missing());
        }
        let metadata = tokio::fs::metadata(&path).await.map_err(|_| missing())?;
        if !metadata.is_file() {
            return Err(missing());
        }
        let modified = metadata.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok());
        let modified = modified.map_or(0, |time| time.as_nanos());
        let etag = format!("\"{chapter_id}-{}-{modified}\"", metadata.len());
        Ok(AudioFile { path, content_type, etag })
    }

    fn snapshot(&self) -> Arc<Snapshot> {
        self.catalog.read().unwrap_or_else(std::sync::PoisonError::into_inner).clone()
    }
}

impl Snapshot {
    fn book(&self, id: Uuid) -> AppResult<&Book> {
        self.books.get(&id).map(Arc::as_ref).ok_or_else(|| AppError::not_found("Audiobook not found."))
    }
}

impl Book {
    fn chapter(&self, id: Uuid) -> AppResult<&ChapterFile> {
        self.chapters
            .iter()
            .find(|chapter| chapter.data.id == id)
            .ok_or_else(|| AppError::not_found("Audiobook chapter not found."))
    }

    fn normalize_progress(&self, mut progress: Progress) -> AppResult<Progress> {
        let chapter = self.chapter(progress.chapter_id)?;
        let duration = chapter.data.duration_ms;
        progress.completed &= self.chapters.last().is_some_and(|last| last.data.id == progress.chapter_id);
        // The decoder's end position can differ from the catalog duration. Persist a single
        // terminal position so different clients render completed books consistently.
        progress.position_ms = if progress.completed { duration } else { progress.position_ms.min(duration) };
        Ok(progress)
    }

    fn dto(&self, state: state::BookState, edit: Option<edits::Metadata>, lang: Lang) -> Audiobook {
        let progress = state.progress().and_then(|progress| self.normalize_progress(progress).ok());
        let scanned_etag = self.cover.as_ref().map(|cover| cover.etag.as_str());
        let cover_etag = match &edit {
            Some(edit) if edit.cover_edited => edit.cover_etag.as_deref(),
            _ => scanned_etag,
        };
        let cover_url =
            cover_etag.map(|etag| format!("/api/audiobooks/{}/cover?v={}", self.id, etag.trim_matches('"')));
        let (title, author, narrator, year) = match edit {
            Some(edit) => (edit.title, edit.author, edit.narrator, edit.year),
            None => (self.title.clone(), self.author.clone(), self.narrator.clone(), None),
        };
        Audiobook {
            id: self.id,
            title,
            author,
            narrator,
            year,
            cover_url,
            duration_ms: self.duration_ms,
            chapters: self
                .chapters
                .iter()
                .enumerate()
                .map(|(index, file)| {
                    let mut chapter = file.data.clone();
                    if chapter.title.is_empty() {
                        chapter.title = i18n::localize("Chapter {0}", &[(index + 1).to_string()], lang);
                    }
                    chapter
                })
                .collect(),
            saved: state.saved,
            saved_at_ms: state.saved_at_ms,
            progress,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_final_chapter_can_complete_a_book() -> AppResult<()> {
        let chapter = || ChapterFile {
            data: Chapter {
                id: Uuid::new_v4(),
                title: String::new(),
                duration_ms: 60_000,
                size_bytes: 500,
                stream_url: String::new(),
            },
            path: PathBuf::new(),
        };
        let book = Book {
            id: Uuid::new_v4(),
            title: "Book".into(),
            author: None,
            narrator: None,
            duration_ms: 120_000,
            chapters: vec![chapter(), chapter()],
            cover: None,
            fingerprint: Vec::new(),
        };
        let early =
            Progress { chapter_id: book.chapters[0].data.id, position_ms: 55_000, updated_at_ms: 100, completed: true };
        assert_eq!(book.normalize_progress(early)?, Progress { completed: false, ..early });
        let final_chapter = Progress { chapter_id: book.chapters[1].data.id, position_ms: 59_980, ..early };
        assert_eq!(book.normalize_progress(final_chapter)?, Progress { position_ms: 60_000, ..final_chapter });
        Ok(())
    }
}
