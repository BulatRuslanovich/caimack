// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::HashMap;

use sqlx::{PgPool, Postgres, QueryBuilder};
use uuid::Uuid;

use super::dto::{GenreDto, TrackDto};
use super::tracks;
use crate::paging::{PageRequest, Paged};
use crate::{AppError, AppResult};

const GENRE_COVER_COUNT: i64 = 4;

const GENRE_SELECT: &str =
    "SELECT g.id, g.name, (SELECT count(*)::int FROM tracks gt WHERE gt.genre_id = g.id) AS track_count FROM genres g";

pub async fn page(
    db: &PgPool,
    filter: impl Fn(&mut QueryBuilder<Postgres>),
    order: impl Fn(&mut QueryBuilder<Postgres>),
    page: PageRequest,
) -> AppResult<Paged<GenreDto>> {
    let mut count = QueryBuilder::new("SELECT count(*) FROM genres g");
    filter(&mut count);
    let total: i64 = count.build_query_scalar().fetch_one(db).await?;

    let mut query = QueryBuilder::new(GENRE_SELECT);
    filter(&mut query);
    query.push(" ORDER BY ");
    order(&mut query);
    query.push(" LIMIT ").push_bind(page.limit()).push(" OFFSET ").push_bind(page.offset());

    Ok(Paged::new(query.build_query_as().fetch_all(db).await?, total, page))
}

pub async fn list(db: &PgPool) -> AppResult<Vec<GenreDto>> {
    let mut genres: Vec<GenreDto> =
        QueryBuilder::new(format!("{GENRE_SELECT} ORDER BY g.name")).build_query_as().fetch_all(db).await?;

    let covers = sqlx::query!(
        r#"SELECT genre_id AS "genre_id!", album_id AS "album_id!"
           FROM (
               SELECT genre_id, album_id,
                      row_number() OVER (PARTITION BY genre_id ORDER BY album_id) AS row_num
               FROM (
                   SELECT DISTINCT t.genre_id AS genre_id, t.album_id AS album_id
                   FROM tracks t
                   JOIN albums a ON a.id = t.album_id
                   WHERE t.genre_id IS NOT NULL AND a.cover_path IS NOT NULL
               ) pairs
           ) ranked
           WHERE row_num <= $1"#,
        GENRE_COVER_COUNT
    )
    .fetch_all(db)
    .await?;

    let mut by_genre: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    for cover in covers {
        by_genre.entry(cover.genre_id).or_default().push(cover.album_id);
    }
    for genre in &mut genres {
        if let Some(albums) = by_genre.remove(&genre.id) {
            genre.cover_album_ids = albums;
        }
    }
    Ok(genres)
}

pub async fn tracks(db: &PgPool, user: Uuid, id: Uuid, page_request: PageRequest) -> AppResult<Paged<TrackDto>> {
    let exists = sqlx::query_scalar!(r#"SELECT EXISTS (SELECT 1 FROM genres WHERE id = $1) AS "exists!""#, id)
        .fetch_one(db)
        .await?;
    if !exists {
        return Err(AppError::not_found("Genre not found."));
    }

    tracks::page(
        db,
        user,
        |query| {
            query.push(" WHERE t.genre_id = ").push_bind(id);
        },
        |query| {
            query.push("ar.name, t.title");
        },
        page_request,
    )
    .await
}
