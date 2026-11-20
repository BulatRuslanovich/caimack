// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use app::audiobooks::Progress;
use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, put};
use serde::Serialize;
use uuid::Uuid;

use crate::auth::CurrentUser;
use crate::extract::{Json, RequestLang, RoutePath};
use crate::files::{self, FileReply};
use crate::problem::ApiResult;
use crate::state::AppState;

const MEDIA_CACHE: &str = "private, max-age=300";
const SERVER_TIME: header::HeaderName = header::HeaderName::from_static("x-caimack-server-time-ms");

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/audiobooks", get(list))
        .route("/api/audiobooks/{id}", get(get_book))
        .route("/api/audiobooks/{id}/saved", put(save).delete(remove))
        .route("/api/audiobooks/{id}/progress", put(set_progress))
        .route("/api/audiobooks/{id}/cover", get(cover))
        .route("/api/audiobooks/{id}/chapters/{chapter_id}/stream", get(stream))
}

fn timed_json(body: impl Serialize) -> Response {
    let now = chrono::Utc::now().timestamp_millis().to_string();
    ([(header::CACHE_CONTROL, "private, no-store"), (SERVER_TIME, now.as_str())], Json(body)).into_response()
}

async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    RequestLang(lang): RequestLang,
) -> ApiResult<Response> {
    let catalog = state.audiobooks.list(&state.db, user.user_id, lang).await?;
    Ok(timed_json(catalog))
}

async fn get_book(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    RoutePath(id): RoutePath<Uuid>,
    RequestLang(lang): RequestLang,
) -> ApiResult<Response> {
    let book = state.audiobooks.get(&state.db, user.user_id, id, lang).await?;
    Ok(timed_json(book))
}

async fn save(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    RoutePath(id): RoutePath<Uuid>,
) -> ApiResult<StatusCode> {
    state.audiobooks.set_saved(&state.db, user.user_id, id, true).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    RoutePath(id): RoutePath<Uuid>,
) -> ApiResult<StatusCode> {
    state.audiobooks.set_saved(&state.db, user.user_id, id, false).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn set_progress(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    RoutePath(id): RoutePath<Uuid>,
    Json(progress): Json<Progress>,
) -> ApiResult<Response> {
    let progress = state.audiobooks.set_progress(&state.db, user.user_id, id, progress).await?;
    Ok(timed_json(progress))
}

async fn cover(
    State(state): State<AppState>,
    RoutePath(id): RoutePath<Uuid>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let artwork = state.audiobooks.cover(id)?;
    let not_modified = files::etag_matches(&headers, &artwork.etag);
    let response_headers = [(header::CACHE_CONTROL, MEDIA_CACHE), (header::ETAG, artwork.etag.as_str())];
    if not_modified {
        return Ok((StatusCode::NOT_MODIFIED, response_headers).into_response());
    }
    Ok((response_headers, [(header::CONTENT_TYPE, "image/webp")], Bytes::from_owner(artwork.webp)).into_response())
}

async fn stream(
    State(state): State<AppState>,
    RoutePath((id, chapter_id)): RoutePath<(Uuid, Uuid)>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let file = state.audiobooks.audio(id, chapter_id).await?;
    let reply = FileReply {
        path: file.path,
        content_type: file.content_type.to_owned(),
        etag: file.etag,
        cache_control: MEDIA_CACHE,
        download_name: None,
        ranges: true,
    };
    Ok(reply.send(&headers).await)
}
