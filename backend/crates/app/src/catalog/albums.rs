// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use serde::Serialize;
use serde_with::skip_serializing_none;
use sqlx::{PgPool, Postgres, QueryBuilder};
use uuid::Uuid;

use super::dto::{AlbumDto, TrackDto};
use super::search::{SearchTerm, push_album_match};
use super::tracks;
use crate::paging::{PageRequest, Paged};
use crate::{AppError, AppResult};

const ALBUM_SELECT: &str = "
    SELECT a.id, a.title, a.artist_id, ar.name AS artist_name, a.year,
           (SELECT count(*)::int FROM tracks at WHERE at.album_id = a.id) AS track_count,
           (SELECT COALESCE(SUM(at.duration_seconds), 0)::int FROM tracks at WHERE at.album_id = a.id) AS duration_seconds,
           a.cover_path IS NOT NULL AS has_cover, a.created_at";

const ALBUM_FROM: &str = " FROM albums a JOIN artists ar ON ar.id = a.artist_id";

pub fn select() -> QueryBuilder<Postgres> {
    let mut query = QueryBuilder::new(ALBUM_SELECT);
    query.push(ALBUM_FROM);
    query
}

pub async fn fetch(db: &PgPool, mut query: QueryBuilder<Postgres>) -> AppResult<Vec<AlbumDto>> {
    Ok(query.build_query_as().fetch_all(db).await?)
}

pub async fn page(
    db: &PgPool,
    filter: impl Fn(&mut QueryBuilder<Postgres>),
    order: impl Fn(&mut QueryBuilder<Postgres>),
    page: PageRequest,
) -> AppResult<Paged<AlbumDto>> {
    let mut count = QueryBuilder::new("SELECT count(*)");
    count.push(ALBUM_FROM);
    filter(&mut count);
    let total: i64 = count.build_query_scalar().fetch_one(db).await?;

    let mut query = select();
    filter(&mut query);
    query.push(" ORDER BY ");
    order(&mut query);
    query.push(" LIMIT ").push_bind(page.limit()).push(" OFFSET ").push_bind(page.offset());

    Ok(Paged::new(fetch(db, query).await?, total, page))
}

pub async fn get_summary(db: &PgPool, id: Uuid) -> AppResult<AlbumDto> {
    let mut query = select();
    query.push(" WHERE a.id = ").push_bind(id);
    fetch(db, query).await?.into_iter().next().ok_or_else(|| AppError::not_found("Album not found."))
}

pub async fn list(
    db: &PgPool,
    page_request: PageRequest,
    artist_id: Option<Uuid>,
    filter_by_recent: bool,
    search: Option<&str>,
) -> AppResult<Paged<AlbumDto>> {
    let term = SearchTerm::for_filter(search);
    page(
        db,
        |query| {
            let mut glue = " WHERE ";
            if let Some(term) = &term {
                query.push(glue);
                push_album_match(query, term);
                glue = " AND ";
            }
            if let Some(artist_id) = artist_id {
                query.push(glue).push("a.artist_id = ").push_bind(artist_id);
            }
        },
        |query| {
            query.push(if filter_by_recent { "a.created_at DESC" } else { "a.title" });
        },
        page_request,
    )
    .await
}

#[skip_serializing_none]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumDetailDto {
    pub id: Uuid,
    pub title: String,
    pub artist_id: Uuid,
    pub artist_name: String,
    pub year: Option<i32>,
    pub has_cover: bool,
    pub duration_seconds: i32,
    pub tracks: Vec<TrackDto>,
}

pub async fn detail(db: &PgPool, user: Uuid, id: Uuid) -> AppResult<AlbumDetailDto> {
    let album = get_summary(db, id).await?;

    let mut query = tracks::select(user);
    query.push(" WHERE t.album_id = ").push_bind(id);
    query.push(" ORDER BY COALESCE(t.disc_number, 1), COALESCE(t.track_number, 2147483647), t.title");
    let tracks = tracks::fetch(db, query).await?;

    Ok(AlbumDetailDto {
        id: album.id,
        title: album.title,
        artist_id: album.artist_id,
        artist_name: album.artist_name,
        year: album.year,
        has_cover: album.has_cover,
        duration_seconds: album.duration_seconds,
        tracks,
    })
}
