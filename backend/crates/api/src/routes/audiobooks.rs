// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use anyhow::Context;
use app::AppError;
use app::audiobooks::{Audiobooks, BookEdit, BookUpload, Progress};
use app::covers::MAX_IMAGE_BYTES;
use axum::Router;
use axum::body::Bytes;
use axum::extract::multipart::MultipartError;
use axum::extract::{DefaultBodyLimit, Multipart, Request, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::middleware::{Next, from_fn_with_state};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, put};
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use super::media::read_image_field;
use crate::auth::{Admin, CurrentUser};
use crate::extract::{Json, RequestLang, RoutePath};
use crate::files::{self, FileReply};
use crate::problem::{ApiError, ApiResult};
use crate::state::AppState;

const MEDIA_CACHE: &str = "private, max-age=300";
const MAX_UPLOAD_BODY: usize = 2 * 1024 * 1024 * 1024;
const SERVER_TIME: header::HeaderName = header::HeaderName::from_static("x-caimack-server-time-ms");

pub(super) fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/api/audiobooks", get(list))
        .route("/api/audiobooks/uploads/{id}", put(upload_book).layer(DefaultBodyLimit::max(MAX_UPLOAD_BODY)))
        .route(
            "/api/audiobooks/{id}",
            get(get_book)
                .put(edit_book)
                .delete(delete_book)
                .layer(DefaultBodyLimit::max(MAX_IMAGE_BYTES as usize + 16 * 1024)),
        )
        .route("/api/audiobooks/{id}/saved", put(save).delete(remove))
        .route("/api/audiobooks/{id}/progress", put(set_progress))
        .route("/api/audiobooks/{id}/cover", get(cover))
        .route("/api/audiobooks/{id}/chapters/{chapter_id}/stream", get(stream))
        .route_layer(from_fn_with_state(state, require_experiment))
        .route("/api/experiments/audiobooks", get(experiment))
        .route("/api/admin/experiments/audiobooks", put(set_experiment))
}

#[derive(Serialize, Deserialize)]
struct Experiment {
    enabled: bool,
}

async fn require_experiment(State(state): State<AppState>, request: Request, next: Next) -> ApiResult<Response> {
    if !Audiobooks::experiment_enabled(&state.db).await? {
        return Err(AppError::forbidden("Audiobooks are disabled.").into());
    }
    Ok(next.run(request).await)
}

async fn experiment(State(state): State<AppState>) -> ApiResult<Response> {
    Ok(timed_json(Experiment { enabled: Audiobooks::experiment_enabled(&state.db).await? }))
}

async fn set_experiment(
    State(state): State<AppState>,
    Admin(_): Admin,
    Json(value): Json<Experiment>,
) -> ApiResult<Response> {
    state.audiobooks.set_experiment(&state.db, value.enabled).await?;
    Ok(timed_json(value))
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

async fn delete_book(
    State(state): State<AppState>,
    Admin(_): Admin,
    RoutePath(id): RoutePath<Uuid>,
) -> ApiResult<StatusCode> {
    state.audiobooks.delete(id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn upload_book(
    State(state): State<AppState>,
    Admin(_): Admin,
    RoutePath(id): RoutePath<Uuid>,
    mut form: Multipart,
) -> ApiResult<StatusCode> {
    let invalid = || AppError::validation("Invalid audiobook upload.");
    let mut upload = BookUpload::start(state.storage.audiobooks_root(), id).await?;
    let mut title = None;
    while let Some(mut field) = form.next_field().await.map_err(upload_error)? {
        match field.name() {
            Some("title") if title.is_none() => {
                let mut bytes = Vec::new();
                while let Some(chunk) = field.chunk().await.map_err(upload_error)? {
                    if bytes.len() + chunk.len() > 1200 {
                        return Err(AppError::validation("Enter a title of at most {0} characters.").arg(300).into());
                    }
                    bytes.extend_from_slice(&chunk);
                }
                title = Some(String::from_utf8(bytes).map_err(|_| invalid())?);
            }
            Some("file") => {
                let mut file = upload.chapter(field.file_name().ok_or_else(invalid)?).await?;
                while let Some(chunk) = field.chunk().await.map_err(upload_error)? {
                    file.write_all(&chunk)
                        .await
                        .context("Could not write an audiobook chapter")
                        .map_err(AppError::from)?;
                }
                file.flush().await.context("Could not flush an audiobook chapter").map_err(AppError::from)?;
            }
            _ => return Err(invalid().into()),
        }
    }
    upload.finish(state.audiobooks, title.as_deref().ok_or_else(invalid)?).await?;
    Ok(StatusCode::NO_CONTENT)
}

fn upload_error(error: MultipartError) -> ApiError {
    if error.status() == StatusCode::PAYLOAD_TOO_LARGE {
        AppError::payload_too_large("The audiobook exceeds the 2 GB upload limit.").into()
    } else {
        AppError::validation("Invalid audiobook upload.").into()
    }
}

async fn edit_book(
    State(state): State<AppState>,
    Admin(_): Admin,
    RoutePath(id): RoutePath<Uuid>,
    mut form: Multipart,
) -> ApiResult<StatusCode> {
    let invalid = || AppError::validation("Invalid audiobook details.");
    let mut edit = None;
    let mut image = None;
    while let Some(field) = form.next_field().await.map_err(|_| invalid())? {
        match field.name() {
            Some("details") if edit.is_none() => {
                let details = field.text().await.map_err(|_| invalid())?;
                edit = Some(serde_json::from_str::<BookEdit>(&details).map_err(|_| invalid())?);
            }
            Some("file") if image.is_none() => image = Some(read_image_field(field).await?),
            _ => return Err(invalid().into()),
        }
    }
    state.audiobooks.edit(&state.db, id, edit.ok_or_else(invalid)?, image).await?;
    Ok(StatusCode::NO_CONTENT)
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
    let artwork = state.audiobooks.cover(&state.db, id).await?;
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
        ranges: true,
    };
    Ok(reply.send(&headers).await)
}
