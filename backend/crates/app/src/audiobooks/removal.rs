// SPDX-License-Identifier: AGPL-3.0-only

use std::fs;
use std::io::ErrorKind;
use std::path::Component;
use std::sync::Arc;

use anyhow::Context;
use uuid::Uuid;

use super::Audiobooks;
use crate::{AppError, AppResult};

impl Audiobooks {
    pub async fn delete(&self, id: Uuid) -> AppResult<()> {
        let guard = Arc::clone(&self.scan_lock).lock_owned().await;
        let audiobooks = self.clone();

        tokio::task::spawn_blocking(move || {
            let snapshot = audiobooks.snapshot();
            let book = snapshot.book(id)?;
            let changed = || {
                audiobooks.request_scan();
                AppError::conflict("The audiobook files have changed. Wait for the catalog to refresh and try again.")
            };
            let chapter = book.chapters.first().ok_or_else(changed)?;
            let mut components = chapter.path.components();
            let Some(Component::Normal(name)) = components.next() else { return Err(changed()) };
            let directory = components.next().is_some();
            let source = snapshot.root.join(name);
            let retired = match fs::symlink_metadata(&source) {
                Err(error) if error.kind() == ErrorKind::NotFound => None,
                metadata => {
                    let metadata = metadata.context("Could not inspect the audiobook source")?;
                    let expected_type = if directory { metadata.is_dir() } else { metadata.is_file() };
                    if !expected_type
                        || source.canonicalize().context("Could not resolve the audiobook source")? != source
                        || !book.fingerprint.iter().any(|file| file.matches(&snapshot.root, &chapter.path))
                    {
                        return Err(changed());
                    }
                    let retired = snapshot.root.join(format!(".delete-{}", Uuid::new_v4()));
                    match fs::rename(&source, &retired) {
                        Err(error)
                            if matches!(error.kind(), ErrorKind::PermissionDenied | ErrorKind::ReadOnlyFilesystem) =>
                        {
                            return Err(AppError::forbidden("The server needs write access to delete the audiobook."));
                        }
                        result => result.context("Could not remove the audiobook source")?,
                    }
                    Some(retired)
                }
            };

            // Scans ignore the hidden path, so cleanup cannot expose a partly deleted book.
            drop(snapshot);
            let mut snapshot = audiobooks.catalog.write().unwrap_or_else(std::sync::PoisonError::into_inner);
            Arc::make_mut(&mut snapshot).books.remove(&id);
            drop(guard);
            if let Some(path) = retired {
                let result = if directory { fs::remove_dir_all(&path) } else { fs::remove_file(&path) };
                if let Err(error) = result {
                    tracing::warn!(%id, path = %path.display(), %error, "Could not clean up the deleted audiobook");
                }
            }
            Ok(())
        })
        .await
        .context("Could not delete the audiobook")?
    }
}
