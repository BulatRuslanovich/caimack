// SPDX-License-Identifier: AGPL-3.0-only

use media::images::FULL_EDGE;
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use super::Artwork;
use crate::covers::{self, UploadedImage};
use crate::{AppError, AppResult};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookEdit {
    pub title: String,
    pub author: Option<String>,
    pub narrator: Option<String>,
    pub year: Option<i32>,
    #[serde(default)]
    pub remove_cover: bool,
}

#[derive(sqlx::FromRow)]
pub(super) struct Metadata {
    pub book_id: Uuid,
    pub title: String,
    pub author: Option<String>,
    pub narrator: Option<String>,
    pub year: Option<i32>,
    pub cover_edited: bool,
    pub cover_etag: Option<String>,
}

pub(super) async fn list(db: &PgPool) -> sqlx::Result<Vec<Metadata>> {
    sqlx::query_as("SELECT book_id, title, author, narrator, year, cover_edited, cover_etag FROM audiobook_edits")
        .fetch_all(db)
        .await
}

pub(super) async fn get(db: &PgPool, id: Uuid) -> sqlx::Result<Option<Metadata>> {
    sqlx::query_as(
        "SELECT book_id, title, author, narrator, year, cover_edited, cover_etag FROM audiobook_edits WHERE book_id = $1",
    )
    .bind(id)
    .fetch_optional(db)
    .await
}

pub(super) async fn cover(db: &PgPool, id: Uuid, scanned: &Option<Artwork>) -> AppResult<Option<Artwork>> {
    let edited = sqlx::query_as::<_, (Option<Vec<u8>>, Option<String>)>(
        "SELECT cover_webp, cover_etag FROM audiobook_edits WHERE book_id = $1 AND cover_edited",
    )
    .bind(id)
    .fetch_optional(db)
    .await?;
    Ok(match edited {
        Some((webp, etag)) => webp.zip(etag).map(|(webp, etag)| Artwork { webp: webp.into(), etag }),
        None => scanned.clone(),
    })
}

pub(super) async fn save(db: &PgPool, id: Uuid, edit: BookEdit, image: Option<UploadedImage>) -> AppResult<()> {
    let title = edit.title.trim();
    let author = credit(edit.author.as_deref())?;
    let narrator = credit(edit.narrator.as_deref())?;
    if title.is_empty() || title.chars().count() > 300 {
        return Err(AppError::validation("Enter a title of at most {0} characters.").arg(300));
    }
    if edit.year.is_some_and(|year| !(1500..=2999).contains(&year)) {
        return Err(AppError::validation("Enter a year between {0} and {1}.").arg(1500).arg(2999));
    }
    if edit.remove_cover && image.is_some() {
        return Err(AppError::validation("Choose whether to replace or remove the cover."));
    }
    let artwork = if let Some(image) = image {
        let mut sizes = covers::accept_for_edges(image, &[FULL_EDGE]).await?;
        let rendition = sizes.pop().ok_or_else(|| AppError::validation("That file could not be read as an image."))?;
        Some(Artwork::from_webp(rendition.webp))
    } else {
        None
    };
    sqlx::query(
        "INSERT INTO audiobook_edits (book_id, title, author, narrator, year, cover_edited, cover_webp, cover_etag)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (book_id) DO UPDATE SET title = EXCLUDED.title, author = EXCLUDED.author,
             narrator = EXCLUDED.narrator, year = EXCLUDED.year,
             cover_edited = audiobook_edits.cover_edited OR EXCLUDED.cover_edited,
             cover_webp = CASE WHEN EXCLUDED.cover_edited THEN EXCLUDED.cover_webp ELSE audiobook_edits.cover_webp END,
             cover_etag = CASE WHEN EXCLUDED.cover_edited THEN EXCLUDED.cover_etag ELSE audiobook_edits.cover_etag END",
    )
    .bind(id)
    .bind(title)
    .bind(author)
    .bind(narrator)
    .bind(edit.year)
    .bind(edit.remove_cover || artwork.is_some())
    .bind(artwork.as_ref().map(|art| art.webp.as_ref()))
    .bind(artwork.as_ref().map(|art| &art.etag))
    .execute(db)
    .await?;
    Ok(())
}

fn credit(value: Option<&str>) -> AppResult<Option<&str>> {
    let value = value.map(str::trim).filter(|value| !value.is_empty());
    if value.is_some_and(|value| value.chars().count() > 300) {
        return Err(AppError::validation("Enter at most {0} characters.").arg(300));
    }
    Ok(value)
}
