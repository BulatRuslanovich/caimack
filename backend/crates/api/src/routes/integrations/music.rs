// SPDX-License-Identifier: AGPL-3.0-only

use std::convert::Infallible;
use std::time::Duration;

use app::AppError;
use app::integrations::music::{ImportRequest, SearchGroups, SearchKind};
use axum::Router;
use axum::body::Body;
use axum::extract::DefaultBodyLimit;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use futures_util::{StreamExt, stream};
use serde::Deserialize;
use serde_json::Value;
use serde_json::json;
use uuid::Uuid;

use crate::auth::Admin;
use crate::extract::{Json, Query, RequestLang, RoutePath};
use crate::problem::ApiResult;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/music/sources", get(sources))
        .route("/api/music/search", post(search))
        .route("/api/music/playlist", post(playlist))
        .route("/api/music/playlist/source", post(playlist_source))
        .route("/api/music/imports", get(imports).post(start))
        .route("/api/music/imports/{id}", get(items).delete(cancel))
        .route("/api/music/imports/{id}/retry", post(retry))
        .route("/api/music/imports/{id}/upgrade/{position}", post(upgrade))
        .route("/api/music/imports/{id}/pick/{position}", post(pick))
        .route("/api/music/browser", get(browser_next))
        .route("/api/music/browser/{id}", post(browser_complete).layer(DefaultBodyLimit::max(37 * 1024 * 1024)))
}

fn register(state: &AppState, user: Uuid, headers: &HeaderMap) {
    let token = headers.get("x-yandex-music-token").and_then(|value| value.to_str().ok());
    state.music.register_token(user, token);
}

async fn sources(State(state): State<AppState>, Admin(user): Admin, headers: HeaderMap) -> impl IntoResponse {
    register(&state, user.user_id, &headers);
    ([(header::CACHE_CONTROL, "no-store")], Json(state.music.source_catalog(user.user_id)))
}

#[derive(Deserialize)]
struct Search {
    query: String,
    sources: Vec<String>,
    #[serde(default)]
    kind: SearchKind,
}

async fn search(
    State(state): State<AppState>,
    Admin(user): Admin,
    RequestLang(lang): RequestLang,
    headers: HeaderMap,
    Json(search): Json<Search>,
) -> ApiResult<Response> {
    register(&state, user.user_id, &headers);
    let query = search.query.trim().to_owned();
    if !(2..=200).contains(&query.chars().count()) {
        return Err(AppError::validation("Enter a search between 2 and 200 characters.").into());
    }
    let kind = search.kind;
    let sources = state.music.search_sources(user.user_id, &search.sources, kind);
    let mut groups = SearchGroups::new(&query);
    let events = stream::iter(sources).map(move |source| {
        let music = state.music.clone();
        let query = query.clone();
        async move {
            let result = tokio::time::timeout(Duration::from_secs(48), music.search(user.user_id, source, &query, !matches!(kind, SearchKind::Tracks))).await;
            (source, result)
        }
    }).buffer_unordered(10).map(move |(source, result)| {
        let event = match result {
            Ok(Ok(found)) => {
                let track_groups = groups.add(if matches!(kind, SearchKind::Albums) { Vec::new() } else { found.tracks });
                json!({ "source": source, "groups": track_groups, "albums": found.albums })
            }
            Ok(Err(error)) => json!({
                "source": source,
                "error": error.message().map(|message| message.localized(lang)).unwrap_or_else(|| "Search failed.".into()),
            }),
            Err(_) => json!({ "source": source, "error": "Search timed out." }),
        };
        Ok::<_, Infallible>(format!("{event}\n"))
    });
    Ok((
        [(header::CONTENT_TYPE, "application/x-ndjson"), (header::CACHE_CONTROL, "no-store")],
        Body::from_stream(events),
    )
        .into_response())
}

#[derive(Deserialize)]
struct Link {
    url: String,
}

async fn playlist_source(
    State(state): State<AppState>,
    Admin(user): Admin,
    headers: HeaderMap,
    Json(request): Json<Link>,
) -> ApiResult<impl IntoResponse> {
    register(&state, user.user_id, &headers);
    if request.url.len() > 1000 {
        return Err(AppError::validation("The playlist link is too long.").into());
    }
    Ok(Json(state.music.playlist_source(user.user_id, &request.url)?))
}

async fn playlist(
    State(state): State<AppState>,
    Admin(user): Admin,
    headers: HeaderMap,
    Json(request): Json<Link>,
) -> ApiResult<impl IntoResponse> {
    register(&state, user.user_id, &headers);
    if request.url.len() > 1000 {
        return Err(AppError::validation("The playlist link is too long.").into());
    }
    let (preview_id, snapshot) = state.music.preview_playlist(user.user_id, &request.url).await?;
    Ok(Json(json!({ "previewId": preview_id, "playlist": snapshot })))
}

async fn imports(
    State(state): State<AppState>,
    Admin(user): Admin,
    headers: HeaderMap,
) -> ApiResult<impl IntoResponse> {
    register(&state, user.user_id, &headers);
    Ok(Json(state.music.imports(user.user_id).await?))
}

async fn start(
    State(state): State<AppState>,
    Admin(user): Admin,
    headers: HeaderMap,
    Json(request): Json<ImportRequest>,
) -> ApiResult<impl IntoResponse> {
    register(&state, user.user_id, &headers);
    let id = state.music.enqueue(user.user_id, request).await?;
    Ok((StatusCode::ACCEPTED, Json(json!({ "id": id }))))
}

#[derive(Deserialize)]
struct Items {
    #[serde(default)]
    offset: i64,
}

async fn items(
    State(state): State<AppState>,
    Admin(user): Admin,
    RoutePath(id): RoutePath<Uuid>,
    Query(query): Query<Items>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(state.music.items(user.user_id, id, query.offset).await?))
}

async fn retry(
    State(state): State<AppState>,
    Admin(user): Admin,
    headers: HeaderMap,
    RoutePath(id): RoutePath<Uuid>,
) -> ApiResult<StatusCode> {
    register(&state, user.user_id, &headers);
    state.music.retry(user.user_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn cancel(
    State(state): State<AppState>,
    Admin(user): Admin,
    RoutePath(id): RoutePath<Uuid>,
) -> ApiResult<StatusCode> {
    state.music.cancel(user.user_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn browser_next(State(state): State<AppState>, Admin(user): Admin) -> impl IntoResponse {
    ([(header::CACHE_CONTROL, "no-store")], Json(state.music.browser_next(user.user_id)))
}

#[derive(Deserialize)]
struct BrowserResponse {
    value: Option<Value>,
    error: Option<String>,
}

async fn browser_complete(
    State(state): State<AppState>,
    Admin(user): Admin,
    RoutePath(id): RoutePath<Uuid>,
    Json(reply): Json<BrowserResponse>,
) -> ApiResult<StatusCode> {
    state.music.browser_complete(
        user.user_id,
        id,
        reply.value.ok_or_else(|| reply.error.unwrap_or_else(|| "unavailable".into())),
    )?;
    Ok(StatusCode::NO_CONTENT)
}

async fn upgrade(
    State(state): State<AppState>,
    Admin(user): Admin,
    headers: HeaderMap,
    RoutePath((id, position)): RoutePath<(Uuid, i32)>,
) -> ApiResult<StatusCode> {
    register(&state, user.user_id, &headers);
    state.music.upgrade(user.user_id, id, position).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn pick(
    State(state): State<AppState>,
    Admin(user): Admin,
    headers: HeaderMap,
    RoutePath((id, position)): RoutePath<(Uuid, i32)>,
    Json(selection): Json<app::integrations::music::TrackSelection>,
) -> ApiResult<StatusCode> {
    register(&state, user.user_id, &headers);
    state.music.choose(user.user_id, id, position, selection).await?;
    Ok(StatusCode::NO_CONTENT)
}
