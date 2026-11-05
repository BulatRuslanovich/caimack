// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use app::catalog::edit::{self, UpdateAlbumRequest, UpdateArtistRequest, UpdateTrackRequest};
use app::catalog::tracks::{TrackFilter, TrackSort};
use app::catalog::{albums, artists, genres, lyrics, overview, search, tracks};
use axum::Router;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use media::key::MusicalKey;
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::{Admin, CurrentUser};
use crate::extract::{Json, Paging, Query, RoutePath, optional};
use crate::problem::ApiResult;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/tracks", get(list_tracks))
        .route("/api/tracks/shuffle", get(shuffle_tracks))
        .route("/api/tracks/lookup", post(lookup_tracks))
        .route("/api/tracks/bulk-delete", post(bulk_delete_tracks))
        .route("/api/tracks/{id}", put(update_track).delete(delete_track))
        .route("/api/tracks/{id}/lyrics", get(get_lyrics).put(replace_lyrics))
        .route("/api/albums", get(list_albums))
        .route("/api/albums/{id}", get(album_detail).put(update_album))
        .route("/api/artists", get(list_artists))
        .route("/api/artists/{id}", get(artist_detail).put(rename_artist))
        .route("/api/artists/{id}/top-tracks", get(artist_top_tracks))
        .route("/api/genres", get(list_genres))
        .route("/api/genres/{id}/tracks", get(genre_tracks))
        .route("/api/search", get(search_all))
        .route("/api/search/tracks", get(search_tracks))
        .route("/api/search/albums", get(search_albums))
        .route("/api/search/artists", get(search_artists))
        .route("/api/search/genres", get(search_genres))
        .route("/api/library/overview", get(library_overview))
}

fn optional_bool<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<bool>, D::Error> {
    match Option::<String>::deserialize(deserializer)? {
        None => Ok(None),
        Some(text) if text.trim().is_empty() => Ok(None),
        Some(text) => match text.trim().to_ascii_lowercase().as_str() {
            "true" => Ok(Some(true)),
            "false" => Ok(Some(false)),
            other => Err(serde::de::Error::custom(format!("'{other}' is not a boolean"))),
        },
    }
}

fn invalid_query(field: &str, value: &str) -> Response {
    crate::problem::validation_problem(field, format!("The value '{value}' is not valid."))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrackListQuery {
    #[serde(flatten)]
    paging: Paging,
    q: Option<String>,
    sort: Option<String>,
    #[serde(flatten)]
    filter: TrackFilterQuery,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrackFilterQuery {
    #[serde(default, deserialize_with = "optional")]
    bpm_min: Option<f64>,
    #[serde(default, deserialize_with = "optional")]
    bpm_max: Option<f64>,
    key: Option<String>,
}

impl TrackFilterQuery {
    fn parse(&self) -> Result<TrackFilter, Box<Response>> {
        let mut keys = Vec::new();
        for code in self.key.iter().flat_map(|list| list.split(',')).map(str::trim).filter(|code| !code.is_empty()) {
            match MusicalKey::from_camelot(code) {
                Some(key) => keys.push(key),
                None => return Err(Box::new(invalid_query("key", code))),
            }
        }
        Ok(TrackFilter { bpm_min: self.bpm_min, bpm_max: self.bpm_max, keys })
    }
}

async fn list_tracks(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(query): Query<TrackListQuery>,
) -> Response {
    let sort = match query.sort.as_deref().filter(|s| !s.trim().is_empty()) {
        None => TrackSort::default(),
        Some(text) => match TrackSort::parse(text) {
            Some(sort) => sort,
            None => return invalid_query("sort", text),
        },
    };
    let filter = match query.filter.parse() {
        Ok(filter) => filter,
        Err(error) => return *error,
    };
    let result = tracks::list(&state.db, user.user_id, query.paging.request(), sort, query.q.as_deref(), &filter).await;
    respond(result)
}

fn respond<T: serde::Serialize>(result: app::AppResult<T>) -> Response {
    match result {
        Ok(value) => Json(value).into_response(),
        Err(error) => crate::problem::ApiError::from(error).into_response(),
    }
}

#[derive(Deserialize)]
struct ShuffleQuery {
    #[serde(default, deserialize_with = "optional")]
    limit: Option<i64>,
    q: Option<String>,
    #[serde(flatten)]
    filter: TrackFilterQuery,
}

async fn shuffle_tracks(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(query): Query<ShuffleQuery>,
) -> Response {
    let filter = match query.filter.parse() {
        Ok(filter) => filter,
        Err(error) => return *error,
    };
    respond(tracks::shuffle(&state.db, user.user_id, query.limit, query.q.as_deref(), &filter).await)
}

#[derive(Deserialize)]
struct IdsRequest {
    #[serde(default)]
    ids: Option<Vec<Uuid>>,
}

async fn lookup_tracks(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(request): Json<IdsRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(tracks::lookup(&state.db, user.user_id, &request.ids.unwrap_or_default()).await?))
}

async fn bulk_delete_tracks(
    State(state): State<AppState>,
    Admin(_): Admin,
    Json(request): Json<IdsRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(edit::delete_tracks(&state.db, &state.storage, &request.ids.unwrap_or_default()).await?))
}

async fn update_track(
    State(state): State<AppState>,
    Admin(user): Admin,
    RoutePath(id): RoutePath<Uuid>,
    Json(request): Json<UpdateTrackRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(edit::update_track(&state.db, &state.storage, user.user_id, id, request).await?))
}

async fn delete_track(
    State(state): State<AppState>,
    Admin(_): Admin,
    RoutePath(id): RoutePath<Uuid>,
) -> ApiResult<StatusCode> {
    edit::delete_track(&state.db, &state.storage, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_lyrics(State(state): State<AppState>, RoutePath(id): RoutePath<Uuid>) -> ApiResult<Response> {
    Ok(match lyrics::get(&state.db, id).await? {
        Some(found) => Json(found).into_response(),
        None => StatusCode::NO_CONTENT.into_response(),
    })
}

#[derive(Deserialize)]
struct LyricsRequest {
    text: Option<String>,
}

async fn replace_lyrics(
    State(state): State<AppState>,
    Admin(_): Admin,
    RoutePath(id): RoutePath<Uuid>,
    Json(request): Json<LyricsRequest>,
) -> ApiResult<Response> {
    Ok(match lyrics::replace(&state.db, id, request.text.as_deref()).await? {
        Some(saved) => Json(saved).into_response(),
        None => StatusCode::NO_CONTENT.into_response(),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AlbumListQuery {
    #[serde(flatten)]
    paging: Paging,
    #[serde(default, deserialize_with = "optional")]
    artist_id: Option<Uuid>,
    q: Option<String>,
    #[serde(default, deserialize_with = "optional_bool")]
    filter_by_recent: Option<bool>,
}

async fn list_albums(
    State(state): State<AppState>,
    Query(query): Query<AlbumListQuery>,
) -> ApiResult<impl IntoResponse> {
    let page = query.paging.request();
    let recent = query.filter_by_recent.unwrap_or(false);
    Ok(Json(albums::list(&state.db, page, query.artist_id, recent, query.q.as_deref()).await?))
}

async fn album_detail(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    RoutePath(id): RoutePath<Uuid>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(albums::detail(&state.db, user.user_id, id).await?))
}

async fn update_album(
    State(state): State<AppState>,
    Admin(_): Admin,
    RoutePath(id): RoutePath<Uuid>,
    Json(request): Json<UpdateAlbumRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(edit::update_album(&state.db, id, request).await?))
}

#[derive(Deserialize)]
struct SearchListQuery {
    #[serde(flatten)]
    paging: Paging,
    q: Option<String>,
}

async fn list_artists(
    State(state): State<AppState>,
    Query(query): Query<SearchListQuery>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(artists::list(&state.db, query.paging.request(), query.q.as_deref()).await?))
}

async fn artist_detail(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    RoutePath(id): RoutePath<Uuid>,
    Query(paging): Query<Paging>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(artists::detail(&state.db, user.user_id, id, paging.request()).await?))
}

#[derive(Deserialize)]
struct LimitQuery {
    #[serde(default, deserialize_with = "optional")]
    limit: Option<i64>,
}

async fn artist_top_tracks(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    RoutePath(id): RoutePath<Uuid>,
    Query(query): Query<LimitQuery>,
) -> ApiResult<impl IntoResponse> {
    let limit = query.limit.unwrap_or(10);
    Ok(Json(artists::top_tracks(&state.db, user.user_id, id, limit).await?))
}

async fn rename_artist(
    State(state): State<AppState>,
    Admin(_): Admin,
    RoutePath(id): RoutePath<Uuid>,
    Json(request): Json<UpdateArtistRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(edit::rename_artist(&state.db, id, request).await?))
}

async fn list_genres(State(state): State<AppState>) -> ApiResult<impl IntoResponse> {
    Ok(Json(genres::list(&state.db).await?))
}

async fn genre_tracks(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    RoutePath(id): RoutePath<Uuid>,
    Query(paging): Query<Paging>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(genres::tracks(&state.db, user.user_id, id, paging.request()).await?))
}

#[derive(Deserialize)]
struct SearchQuery {
    q: Option<String>,
    #[serde(default, deserialize_with = "optional")]
    limit: Option<i64>,
}

async fn search_all(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(query): Query<SearchQuery>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(search::search(&state.db, user.user_id, query.q.as_deref(), query.limit.unwrap_or(20)).await?))
}

async fn search_tracks(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(query): Query<SearchListQuery>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(search::search_tracks(&state.db, user.user_id, query.q.as_deref(), query.paging.request()).await?))
}

async fn search_albums(
    State(state): State<AppState>,
    Query(query): Query<SearchListQuery>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(search::search_albums(&state.db, query.q.as_deref(), query.paging.request()).await?))
}

async fn search_artists(
    State(state): State<AppState>,
    Query(query): Query<SearchListQuery>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(search::search_artists(&state.db, query.q.as_deref(), query.paging.request()).await?))
}

async fn search_genres(
    State(state): State<AppState>,
    Query(query): Query<SearchListQuery>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(search::search_genres(&state.db, query.q.as_deref(), query.paging.request()).await?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OverviewQuery {
    #[serde(default, deserialize_with = "optional")]
    section_size: Option<i64>,
}

async fn library_overview(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(query): Query<OverviewQuery>,
) -> ApiResult<impl IntoResponse> {
    let size = query.section_size.unwrap_or(12);
    Ok(Json(overview::overview(&state.db, &state.storage, &state.stats, user.user_id, size).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_sort_is_rejected_by_parse() {
        assert!(TrackSort::parse("popular").is_none());
    }

    #[test]
    fn sort_accepts_any_case_and_numbers() {
        assert_eq!(
            [TrackSort::parse("RECENT"), TrackSort::parse("3")],
            [Some(TrackSort::Recent), Some(TrackSort::Album)]
        );
    }
}
