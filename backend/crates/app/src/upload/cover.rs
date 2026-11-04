// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use media::images::Rendition;
use uuid::Uuid;

use crate::AppResult;
use crate::covers;
use crate::storage::{COVER_DIRECTORY, Storage};

pub(super) struct PreparedCover {
    storage: Storage,
    path: String,
    persisted: bool,
}

impl PreparedCover {
    pub async fn prepare(storage: &Storage, bytes: Option<Vec<u8>>) -> AppResult<Option<Self>> {
        let Some(bytes) = bytes else { return Ok(None) };
        let set = match covers::renditions(bytes).await {
            Ok(set) => set,
            Err(error) => {
                tracing::warn!("Album stays coverless: the embedded art could not be processed ({error})");
                return Ok(None);
            }
        };
        Self::save(storage, &set).await.map(Some)
    }

    async fn save(storage: &Storage, set: &[Rendition]) -> AppResult<Self> {
        let owner = Uuid::now_v7();
        // A unique path keeps rollback cleanup from touching another upload's cover.
        let cover = Self {
            storage: storage.clone(),
            path: format!("{COVER_DIRECTORY}/{}.webp", owner.simple()),
            persisted: false,
        };
        storage.save_renditions(COVER_DIRECTORY, owner, set).await?;
        Ok(cover)
    }

    pub fn path(&self) -> &str {
        &self.path
    }

    pub fn persist(&mut self) {
        self.persisted = true;
    }
}

impl Drop for PreparedCover {
    fn drop(&mut self) {
        if !self.persisted {
            self.storage.delete_cover(&self.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn unused_renditions_are_removed_without_touching_another_upload() -> anyhow::Result<()> {
        let root = std::env::temp_dir().join(format!("caimack-prepared-cover-{}", Uuid::now_v7()));
        let storage = Storage::open(&root)?;
        let set = [Rendition { edge: media::images::FULL_EDGE, webp: b"cover".to_vec() }];
        let discarded = PreparedCover::save(&storage, &set).await?;
        let mut kept = PreparedCover::save(&storage, &set).await?;
        let discarded_path = discarded.path().to_owned();
        let kept_path = kept.path().to_owned();
        kept.persist();
        drop(discarded);
        drop(kept);
        assert!(storage.existing(&discarded_path).is_none());
        assert!(storage.existing(&kept_path).is_some());
        std::fs::remove_dir_all(root)?;
        Ok(())
    }
}
