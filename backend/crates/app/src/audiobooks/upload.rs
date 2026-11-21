// SPDX-License-Identifier: AGPL-3.0-only

use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::Context;
use tokio::fs::{File, OpenOptions};
use tokio_util::sync::CancellationToken;
use uuid::{Uuid, Version};

use super::{Audiobooks, Snapshot, scan};
use crate::{AppError, AppResult};

pub(super) const TITLE_FILE: &str = ".caimack-title";
const MAX_CHAPTERS: usize = 1000;

pub struct BookUpload {
    root: PathBuf,
    staging: PathBuf,
    id: Uuid,
    chapters: Vec<String>,
}

impl BookUpload {
    pub async fn start(root: PathBuf, id: Uuid) -> AppResult<Self> {
        if id.get_version() != Some(Version::Random) {
            return Err(AppError::validation("Invalid audiobook upload."));
        }
        tokio::task::spawn_blocking(move || {
            std::fs::create_dir_all(&root).context("Could not create the audiobook uploads folder")?;
            let root = root.canonicalize().context("Could not open the audiobook uploads folder")?;
            let staging = root.join(format!(".upload-{}", Uuid::new_v4()));
            std::fs::create_dir(&staging).context("Could not create the audiobook staging folder")?;
            let upload = Self { root, staging, id, chapters: Vec::new() };
            std::fs::create_dir(upload.book_dir()).context("Could not create the staged book folder")?;
            Ok(upload)
        })
        .await
        .context("Could not start the audiobook upload")?
    }

    fn book_dir(&self) -> PathBuf {
        self.staging.join(self.id.to_string())
    }

    pub async fn chapter(&mut self, name: &str) -> AppResult<File> {
        if name.starts_with('.')
            || name.len() > 255
            || name.chars().any(|ch| ch.is_control() || r#"/\:*?"<>|"#.contains(ch))
            || scan::mime_type(Path::new(name)).is_none()
        {
            return Err(AppError::validation("Invalid audiobook chapter file: {0}.").arg(name));
        }
        if self.chapters.len() == MAX_CHAPTERS {
            return Err(AppError::validation("An audiobook can have at most {0} chapters.").arg(MAX_CHAPTERS));
        }

        let file = OpenOptions::new().write(true).create_new(true).open(self.book_dir().join(name)).await;
        let file = match file {
            Err(err) if err.kind() == ErrorKind::AlreadyExists => {
                return Err(AppError::validation("Audiobook chapter names must be unique: {0}.").arg(name));
            }
            result => result.context("Could not create a staged audiobook chapter")?,
        };
        self.chapters.push(name.to_owned());
        Ok(file)
    }

    pub async fn finish(self, catalog: Audiobooks, title: &str) -> AppResult<()> {
        let title = title.trim();
        if title.is_empty() || title.chars().count() > 300 || title.chars().any(char::is_control) {
            return Err(AppError::validation("Enter a title of at most {0} characters.").arg(300));
        }
        if self.chapters.is_empty() {
            return Err(AppError::validation("Choose at least one audiobook chapter."));
        }
        let title = title.to_owned();

        let (upload, books) = tokio::task::spawn_blocking(move || {
            std::fs::write(self.book_dir().join(TITLE_FILE), title).context("Could not write the audiobook title")?;
            let staged = scan::read(&self.staging, &Snapshot::default(), &CancellationToken::new())?;
            let book = staged.books.get(&self.id);
            if book.is_none_or(|book| book.chapters.len() != self.chapters.len()) {
                let unreadable = self.chapters.iter().find(|name| {
                    book.is_none_or(|book| {
                        !book
                            .chapters
                            .iter()
                            .any(|chapter| chapter.path.file_name().is_some_and(|file| file == name.as_str()))
                    })
                });
                return Err(match unreadable {
                    Some(name) => AppError::validation("Could not read audiobook chapter: {0}.").arg(name),
                    None => AppError::validation("Some audiobook chapters could not be read."),
                });
            }
            Ok((self, staged.books))
        })
        .await
        .context("Could not read the uploaded audiobook")??;

        // Keep a scan that started before the rename from replacing the new catalog entry.
        let guard = Arc::clone(&catalog.scan_lock).lock_owned().await;
        tokio::task::spawn_blocking(move || {
            let _guard = guard;
            let destination = upload.root.join(upload.id.to_string());
            if destination.join(TITLE_FILE).is_file() {
                return Ok(());
            }
            if destination.exists() {
                return Err(AppError::conflict("An audiobook already uses this upload ID."));
            }
            std::fs::rename(upload.book_dir(), destination).context("Could not publish the uploaded audiobook")?;
            let mut snapshot = catalog.catalog.write().unwrap_or_else(std::sync::PoisonError::into_inner);
            let snapshot = Arc::make_mut(&mut snapshot);
            snapshot.root.clone_from(&upload.root);
            snapshot.books.extend(books);
            Ok(())
        })
        .await
        .context("Could not finish the audiobook upload")?
    }
}

impl Drop for BookUpload {
    fn drop(&mut self) {
        let staging = std::mem::take(&mut self.staging);
        tokio::task::spawn_blocking(move || {
            if let Err(error) = std::fs::remove_dir_all(&staging)
                && error.kind() != ErrorKind::NotFound
            {
                tracing::warn!(path = %staging.display(), %error, "Could not clean up the audiobook upload");
            }
        });
    }
}
