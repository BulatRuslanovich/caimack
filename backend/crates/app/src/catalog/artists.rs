// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use serde::Serialize;
use sqlx::{PgPool, Postgres, QueryBuilder};
use uuid::Uuid;

use super::dto::{AlbumDto, ArtistDto, TrackDto};
use super::search::{SearchTerm, push_artist_match};
use super::{albums, tracks};
use crate::paging::{PageRequest, Paged};
use crate::{AppError, AppResult};

pub const MAX_TOP_TRACKS: i64 = 50;

const ARTIST_SELECT: &str = "
    SELECT a.id, a.name,
           (SELECT count(*)::int FROM albums aa WHERE aa.artist_id = a.id) AS album_count,
           (SELECT count(*)::int FROM track_artists ta WHERE ta.artist_id = a.id) AS track_count,
           a.image_path IS NOT NULL AS has_image
    FROM artists a";

pub async fn page(
    db: &PgPool,
    filter: impl Fn(&mut QueryBuilder<Postgres>),
    order: impl Fn(&mut QueryBuilder<Postgres>),
    page: PageRequest,
) -> AppResult<Paged<ArtistDto>> {
    let mut count = QueryBuilder::new("SELECT count(*) FROM artists a");
    filter(&mut count);
    let total: i64 = count.build_query_scalar().fetch_one(db).await?;

    let mut query = QueryBuilder::new(ARTIST_SELECT);
    filter(&mut query);
    query.push(" ORDER BY ");
    order(&mut query);
    query.push(" LIMIT ").push_bind(page.limit()).push(" OFFSET ").push_bind(page.offset());

    Ok(Paged::new(query.build_query_as().fetch_all(db).await?, total, page))
}

pub async fn fetch_where(
    db: &PgPool,
    filter: impl Fn(&mut QueryBuilder<Postgres>),
    order: &str,
    limit: i64,
) -> AppResult<Vec<ArtistDto>> {
    let mut query = QueryBuilder::new(ARTIST_SELECT);
    filter(&mut query);
    query.push(" ORDER BY ").push(order).push(" LIMIT ").push_bind(limit);
    Ok(query.build_query_as().fetch_all(db).await?)
}

pub async fn get_summary(db: &PgPool, id: Uuid) -> AppResult<ArtistDto> {
    fetch_where(
        db,
        |query| {
            query.push(" WHERE a.id = ").push_bind(id);
        },
        "a.name",
        1,
    )
    .await?
    .into_iter()
    .next()
    .ok_or_else(|| AppError::not_found("Artist not found."))
}

pub async fn list(db: &PgPool, page_request: PageRequest, search: Option<&str>) -> AppResult<Paged<ArtistDto>> {
    let term = SearchTerm::for_filter(search);
    page(
        db,
        |query| {
            if let Some(term) = &term {
                query.push(" WHERE ");
                push_artist_match(query, term);
            }
        },
        |query| {
            query.push("a.name");
        },
        page_request,
    )
    .await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistDetailDto {
    pub id: Uuid,
    pub name: String,
    pub has_image: bool,
    pub albums: Vec<AlbumDto>,
    pub tracks: Paged<TrackDto>,
}

fn credited(query: &mut QueryBuilder<Postgres>, artist: Uuid) {
    query.push(" WHERE EXISTS (SELECT 1 FROM track_artists cta WHERE cta.track_id = t.id AND cta.artist_id = ");
    query.push_bind(artist).push(")");
}

pub async fn detail(db: &PgPool, user: Uuid, id: Uuid, track_page: PageRequest) -> AppResult<ArtistDetailDto> {
    let artist = get_summary(db, id).await?;

    let mut query = albums::select();
    query.push(" WHERE a.artist_id = ").push_bind(id);
    query.push(" OR EXISTS (SELECT 1 FROM tracks xt JOIN track_artists xta ON xta.track_id = xt.id WHERE xt.album_id = a.id AND xta.artist_id = ");
    query.push_bind(id).push(")");
    query.push(" ORDER BY a.year IS NULL, a.year DESC, a.title");
    let albums = albums::fetch(db, query).await?;

    let tracks = tracks::page(
        db,
        user,
        |query| credited(query, id),
        |query| {
            query.push("t.title");
        },
        track_page,
    )
    .await?;

    Ok(ArtistDetailDto { id: artist.id, name: artist.name, has_image: artist.has_image, albums, tracks })
}

pub async fn top_tracks(db: &PgPool, user: Uuid, id: Uuid, limit: i64) -> AppResult<Vec<TrackDto>> {
    get_summary(db, id).await?;

    let mut query = tracks::select(user);
    credited(&mut query, id);
    query.push(" ORDER BY ").push(tracks::POPULARITY).push(" DESC, COALESCE(s.play_count, 0) DESC, t.title");
    query.push(" LIMIT ").push_bind(limit.clamp(1, MAX_TOP_TRACKS));
    tracks::fetch(db, query).await
}
