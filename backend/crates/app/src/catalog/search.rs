// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use serde::Serialize;
use serde_with::skip_serializing_none;
use sqlx::{PgPool, Postgres, QueryBuilder};
use uuid::Uuid;

use super::dto::{AlbumDto, ArtistDto, GenreDto, TrackDto};
use super::{albums, artists, genres, tracks};
use crate::AppResult;
use crate::paging::{PageRequest, Paged};
use crate::text::normalize_key;

const MINIMUM_SEARCH_LENGTH: usize = 3;
const MAX_LIMIT: i64 = 50;

#[derive(Debug, Clone)]
pub struct SearchTerm {
    pub value: String,

    pub pattern: String,
}

impl SearchTerm {
    pub fn for_filter(query: Option<&str>) -> Option<Self> {
        let value = normalize_key(query.unwrap_or_default());
        if value.is_empty() {
            return None;
        }
        let escaped = value.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        Some(Self { pattern: format!("%{escaped}%"), value })
    }

    pub fn for_search(query: Option<&str>) -> Option<Self> {
        Self::for_filter(query).filter(|term| term.value.chars().count() >= MINIMUM_SEARCH_LENGTH)
    }
}

fn push_like(query: &mut QueryBuilder<Postgres>, column: &str, term: &SearchTerm) {
    query.push(column).push(" LIKE ").push_bind(term.pattern.clone()).push(" ESCAPE '\\'");
}

pub fn push_track_match(query: &mut QueryBuilder<Postgres>, term: &SearchTerm) {
    query.push("(");
    push_like(query, "t.normalized_title", term);
    query.push(" OR EXISTS (SELECT 1 FROM track_artists mta JOIN artists ma ON ma.id = mta.artist_id WHERE mta.track_id = t.id AND ");
    push_like(query, "ma.normalized_name", term);
    query.push(") OR ");
    push_like(query, "al.normalized_title", term);
    query.push(" OR ");
    push_like(query, "g.normalized_name", term);
    query.push(")");
}

pub fn push_album_match(query: &mut QueryBuilder<Postgres>, term: &SearchTerm) {
    query.push("(");
    push_like(query, "a.normalized_title", term);
    query.push(" OR ");
    push_like(query, "ar.normalized_name", term);
    query.push(")");
}

pub fn push_artist_match(query: &mut QueryBuilder<Postgres>, term: &SearchTerm) {
    push_like(query, "a.normalized_name", term);
}

fn push_genre_match(query: &mut QueryBuilder<Postgres>, term: &SearchTerm) {
    push_like(query, "g.normalized_name", term);
}

fn rank(column: &str, term: &SearchTerm, query: &mut QueryBuilder<Postgres>) {
    query.push("search_rank(").push(column).push(", ").push_bind(term.value.clone()).push(")");
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub enum SearchResultKind {
    Artist,
    Album,
    Track,
    Genre,
}

#[skip_serializing_none]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchTopResult {
    pub kind: SearchResultKind,
    pub artist: Option<ArtistDto>,
    pub album: Option<AlbumDto>,
    pub track: Option<TrackDto>,
    pub genre: Option<GenreDto>,
}

#[skip_serializing_none]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub artists: Vec<ArtistDto>,
    pub albums: Vec<AlbumDto>,
    pub tracks: Vec<TrackDto>,
    pub genres: Vec<GenreDto>,
    pub top: Option<SearchTopResult>,
}

pub async fn search(db: &PgPool, user: Uuid, query: Option<&str>, limit: i64) -> AppResult<SearchResult> {
    let Some(term) = SearchTerm::for_search(query) else {
        return Ok(SearchResult { artists: vec![], albums: vec![], tracks: vec![], genres: vec![], top: None });
    };
    let page = PageRequest { page: 1, page_size: i32::try_from(limit.clamp(1, MAX_LIMIT)).unwrap_or(20) };

    let artists = ranked_artists(db, &term, page).await?.items;
    let albums = ranked_albums(db, &term, page).await?.items;
    let tracks = ranked_tracks(db, user, &term, page).await?.items;
    let genres = ranked_genres(db, &term, page).await?.items;

    let leaders = [
        (SearchResultKind::Artist, artists.first().map(|a| a.name.as_str())),
        (SearchResultKind::Album, albums.first().map(|a| a.title.as_str())),
        (SearchResultKind::Track, tracks.first().map(|t| t.title.as_str())),
        (SearchResultKind::Genre, genres.first().map(|g| g.name.as_str())),
    ];
    let top_kind = leaders
        .iter()
        .filter_map(|(kind, name)| name.map(|name| (*kind, evaluate_rank(&normalize_key(name), &term.value))))
        .min_by_key(|(_, rank)| *rank)
        .map(|(kind, _)| kind);

    let top = top_kind.map(|kind| SearchTopResult {
        kind,
        artist: (kind == SearchResultKind::Artist).then(|| artists[0].clone()),
        album: (kind == SearchResultKind::Album).then(|| albums[0].clone()),
        track: (kind == SearchResultKind::Track).then(|| tracks[0].clone()),
        genre: (kind == SearchResultKind::Genre).then(|| genres[0].clone()),
    });

    Ok(SearchResult { artists, albums, tracks, genres, top })
}

fn evaluate_rank(value: &str, term: &str) -> u8 {
    if value.is_empty() || term.is_empty() {
        4
    } else if value == term {
        0
    } else if value.starts_with(term) {
        1
    } else if format!(" {value}").contains(&format!(" {term}")) {
        2
    } else if value.contains(term) {
        3
    } else {
        4
    }
}

pub async fn search_tracks(
    db: &PgPool,
    user: Uuid,
    query: Option<&str>,
    page: PageRequest,
) -> AppResult<Paged<TrackDto>> {
    match SearchTerm::for_search(query) {
        Some(term) => ranked_tracks(db, user, &term, page).await,
        None => Ok(Paged::empty(page)),
    }
}

pub async fn search_albums(db: &PgPool, query: Option<&str>, page: PageRequest) -> AppResult<Paged<AlbumDto>> {
    match SearchTerm::for_search(query) {
        Some(term) => ranked_albums(db, &term, page).await,
        None => Ok(Paged::empty(page)),
    }
}

pub async fn search_artists(db: &PgPool, query: Option<&str>, page: PageRequest) -> AppResult<Paged<ArtistDto>> {
    match SearchTerm::for_search(query) {
        Some(term) => ranked_artists(db, &term, page).await,
        None => Ok(Paged::empty(page)),
    }
}

pub async fn search_genres(db: &PgPool, query: Option<&str>, page: PageRequest) -> AppResult<Paged<GenreDto>> {
    match SearchTerm::for_search(query) {
        Some(term) => ranked_genres(db, &term, page).await,
        None => Ok(Paged::empty(page)),
    }
}

async fn ranked_tracks(db: &PgPool, user: Uuid, term: &SearchTerm, page: PageRequest) -> AppResult<Paged<TrackDto>> {
    tracks::page(
        db,
        user,
        |query| {
            query.push(" WHERE ");
            push_track_match(query, term);
        },
        |query| {
            rank("t.normalized_title", term, query);
            query.push(", ").push(tracks::POPULARITY).push(" DESC, t.title");
        },
        page,
    )
    .await
}

async fn ranked_artists(db: &PgPool, term: &SearchTerm, page: PageRequest) -> AppResult<Paged<ArtistDto>> {
    artists::page(
        db,
        |query| {
            query.push(" WHERE ");
            push_artist_match(query, term);
        },
        |query| {
            rank("a.normalized_name", term, query);
            query.push(
                ", (SELECT COALESCE(SUM(st.play_count), 0) FROM track_artists rta
                    LEFT JOIN track_stats st ON st.track_id = rta.track_id WHERE rta.artist_id = a.id) DESC, a.name",
            );
        },
        page,
    )
    .await
}

async fn ranked_albums(db: &PgPool, term: &SearchTerm, page: PageRequest) -> AppResult<Paged<AlbumDto>> {
    albums::page(
        db,
        |query| {
            query.push(" WHERE ");
            push_album_match(query, term);
        },
        |query| {
            rank("a.normalized_title", term, query);
            query.push(
                ", (SELECT COALESCE(SUM(st.play_count), 0) FROM tracks rt
                    LEFT JOIN track_stats st ON st.track_id = rt.id WHERE rt.album_id = a.id) DESC, a.title",
            );
        },
        page,
    )
    .await
}

async fn ranked_genres(db: &PgPool, term: &SearchTerm, page: PageRequest) -> AppResult<Paged<GenreDto>> {
    genres::page(
        db,
        |query| {
            query.push(" WHERE ");
            push_genre_match(query, term);
        },
        |query| {
            rank("g.normalized_name", term, query);
            query.push(", (SELECT count(*) FROM tracks gt WHERE gt.genre_id = g.id) DESC, g.name");
        },
        page,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn like_wildcards_in_the_query_are_escaped() {
        let term = SearchTerm::for_filter(Some(" 100%_A\\B ")).unwrap();
        assert_eq!(term.pattern, "%100\\%\\_a\\\\b%");
    }

    #[test]
    fn short_queries_do_not_search() {
        assert!(SearchTerm::for_search(Some("ab")).is_none());
    }

    #[test]
    fn rank_prefers_exact_then_prefix_then_word() {
        let ranks = ["aurora", "aurora lane", "the aurora", "laurora", "zzz"].map(|v| evaluate_rank(v, "aurora"));
        assert_eq!(ranks, [0, 1, 2, 3, 4]);
    }
}
