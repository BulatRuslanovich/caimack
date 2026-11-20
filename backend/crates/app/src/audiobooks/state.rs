// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::HashMap;

use sqlx::PgPool;
use uuid::Uuid;

use super::Progress;

#[derive(Default, sqlx::FromRow)]
pub(super) struct BookState {
    book_id: Uuid,
    pub saved: bool,
    chapter_id: Option<Uuid>,
    position_ms: Option<i64>,
    updated_at_ms: Option<i64>,
    completed: Option<bool>,
}

impl BookState {
    pub(super) fn progress(&self) -> Option<Progress> {
        Some(Progress {
            chapter_id: self.chapter_id?,
            position_ms: self.position_ms?,
            updated_at_ms: self.updated_at_ms?,
            completed: self.completed?,
        })
    }
}

pub(super) async fn get(db: &PgPool, user_id: Uuid, book_id: Uuid) -> sqlx::Result<Option<BookState>> {
    sqlx::query_as(
        "SELECT book_id, saved, chapter_id, position_ms, updated_at_ms, completed
         FROM audiobook_state WHERE user_id = $1 AND book_id = $2",
    )
    .bind(user_id)
    .bind(book_id)
    .fetch_optional(db)
    .await
}

pub(super) async fn list(db: &PgPool, user_id: Uuid) -> sqlx::Result<HashMap<Uuid, BookState>> {
    let rows: Vec<BookState> = sqlx::query_as(
        "SELECT book_id, saved, chapter_id, position_ms, updated_at_ms, completed
         FROM audiobook_state WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(|state| (state.book_id, state)).collect())
}

pub(super) async fn set_saved(db: &PgPool, user_id: Uuid, book_id: Uuid, saved: bool) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO audiobook_state (user_id, book_id, saved) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, book_id) DO UPDATE SET saved = $3",
    )
    .bind(user_id)
    .bind(book_id)
    .bind(saved)
    .execute(db)
    .await?;
    Ok(())
}

pub(super) async fn set_progress(
    db: &PgPool,
    user_id: Uuid,
    book_id: Uuid,
    progress: Progress,
) -> sqlx::Result<Progress> {
    let updated = sqlx::query_as(
        "INSERT INTO audiobook_state (user_id, book_id, chapter_id, position_ms, updated_at_ms, completed)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, book_id) DO UPDATE
         SET chapter_id = EXCLUDED.chapter_id, position_ms = EXCLUDED.position_ms,
             updated_at_ms = EXCLUDED.updated_at_ms, completed = EXCLUDED.completed
         WHERE audiobook_state.updated_at_ms IS NULL OR audiobook_state.updated_at_ms < EXCLUDED.updated_at_ms
         RETURNING chapter_id, position_ms, updated_at_ms, completed",
    )
    .bind(user_id)
    .bind(book_id)
    .bind(progress.chapter_id)
    .bind(progress.position_ms)
    .bind(progress.updated_at_ms)
    .bind(progress.completed)
    .fetch_optional(db)
    .await?;
    if let Some(updated) = updated {
        return Ok(updated);
    }
    // A newer or identical sample already exists. Return the position the other devices will see.
    get(db, user_id, book_id).await?.and_then(|state| state.progress()).ok_or(sqlx::Error::RowNotFound)
}

#[cfg(all(test, feature = "integration-tests"))]
mod tests {
    use super::*;

    #[sqlx::test(migrations = "../../../db/migrations")]
    async fn newer_explicit_seek_wins_over_late_offline_update(db: PgPool) -> anyhow::Result<()> {
        let user_id = Uuid::new_v4();
        let other_user = Uuid::new_v4();
        for (id, username) in [(user_id, "listener"), (other_user, "other")] {
            sqlx::query("INSERT INTO users(id, username, password_hash, created_at) VALUES ($1, $2, '', now())")
                .bind(id)
                .bind(username)
                .execute(&db)
                .await?;
        }
        let book_id = Uuid::new_v4();
        let other_book = Uuid::new_v4();
        let offline =
            Progress { chapter_id: Uuid::new_v4(), position_ms: 300_000, updated_at_ms: 100, completed: true };
        let restarted = Progress { chapter_id: Uuid::new_v4(), position_ms: 0, updated_at_ms: 200, completed: false };

        tokio::try_join!(
            set_progress(&db, user_id, book_id, offline),
            set_progress(&db, user_id, book_id, restarted),
            set_saved(&db, user_id, book_id, true),
            set_progress(&db, user_id, other_book, offline),
        )?;
        assert_eq!(set_progress(&db, user_id, book_id, offline).await?, restarted);
        let book = get(&db, user_id, book_id).await?.unwrap_or_default();
        assert!(book.saved);
        assert_eq!(book.progress(), Some(restarted));
        assert_eq!(get(&db, user_id, other_book).await?.and_then(|book| book.progress()), Some(offline));
        assert!(get(&db, other_user, book_id).await?.is_none());

        set_saved(&db, user_id, book_id, false).await?;
        let book = get(&db, user_id, book_id).await?.unwrap_or_default();
        assert!(!book.saved);
        assert_eq!(book.progress(), Some(restarted));
        Ok(())
    }
}
