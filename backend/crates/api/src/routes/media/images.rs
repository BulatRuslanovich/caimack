// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use app::covers::{self, MAX_IMAGE_BYTES, UploadedImage};
use app::storage::CoverSize;
use app::streaming::{self, ImageFile};
use app::{AppError, AppResult};
use axum::extract::{Multipart, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::{Admin, CurrentUser};
use crate::extract::{Json, Query, RoutePath};
use crate::files::FileReply;
use crate::problem::{ApiError, ApiResult, validation_problem};
use crate::state::AppState;

const IMAGE_CACHE: &str = "private, max-age=2592000, stale-while-revalidate=31536000";

#[derive(Deserialize)]
pub(super) struct SizeQuery {
    size: Option<String>,
}

fn cover_size(query: &SizeQuery) -> Result<CoverSize, Box<Response>> {
    match query.size.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(CoverSize::Full),
        Some(text) => CoverSize::parse(text)
            .ok_or_else(|| Box::new(validation_problem("size", format!("The value '{text}' is not valid.")))),
    }
}

async fn image_reply(image: AppResult<ImageFile>, headers: &HeaderMap) -> Response {
    match image {
        Ok(image) => {
            let reply = FileReply {
                path: image.path,
                content_type: image.content_type.to_owned(),
                etag: image.etag,
                cache_control: IMAGE_CACHE,
                download_name: None,
                ranges: false,
            };
            reply.send(headers).await
        }
        Err(error) => ApiError::from(error).into_response(),
    }
}

pub(super) async fn track_cover(
    State(state): State<AppState>,
    RoutePath(id): RoutePath<Uuid>,
    Query(query): Query<SizeQuery>,
    headers: HeaderMap,
) -> Response {
    match cover_size(&query) {
        Ok(size) => image_reply(streaming::track_cover(&state.db, &state.storage, id, size).await, &headers).await,
        Err(rejection) => *rejection,
    }
}

pub(super) async fn album_cover(
    State(state): State<AppState>,
    RoutePath(id): RoutePath<Uuid>,
    Query(query): Query<SizeQuery>,
    headers: HeaderMap,
) -> Response {
    match cover_size(&query) {
        Ok(size) => image_reply(streaming::album_cover(&state.db, &state.storage, id, size).await, &headers).await,
        Err(rejection) => *rejection,
    }
}

pub(super) async fn artist_image(
    State(state): State<AppState>,
    RoutePath(id): RoutePath<Uuid>,
    Query(query): Query<SizeQuery>,
    headers: HeaderMap,
) -> Response {
    match cover_size(&query) {
        Ok(size) => image_reply(streaming::artist_image(&state.db, &state.storage, id, size).await, &headers).await,
        Err(rejection) => *rejection,
    }
}

pub(super) async fn playlist_cover(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    RoutePath(id): RoutePath<Uuid>,
    Query(query): Query<SizeQuery>,
    headers: HeaderMap,
) -> Response {
    match cover_size(&query) {
        Ok(size) => {
            image_reply(streaming::playlist_cover(&state.db, &state.storage, user.user_id, id, size).await, &headers)
                .await
        }
        Err(rejection) => *rejection,
    }
}

async fn read_image(mut form: Multipart) -> AppResult<UploadedImage> {
    while let Some(mut field) = form.next_field().await.map_err(AppError::internal)? {
        if field.name() != Some("file") {
            continue;
        }
        let file_name = field.file_name().unwrap_or_default().to_owned();
        let content_type = field.content_type().map(str::to_owned);
        let mut bytes = Vec::new();
        while let Some(chunk) = field.chunk().await.map_err(AppError::internal)? {
            bytes.extend_from_slice(&chunk);
            if i64::try_from(bytes.len()).unwrap_or(i64::MAX) > MAX_IMAGE_BYTES {
                return Err(AppError::payload_too_large("The file exceeds the {0} MB upload limit.")
                    .arg(MAX_IMAGE_BYTES / (1024 * 1024)));
            }
        }
        if bytes.is_empty() {
            break;
        }
        return Ok(UploadedImage { bytes, content_type, file_name });
    }
    Err(AppError::validation("No image was provided."))
}

pub(super) async fn set_album_cover(
    State(state): State<AppState>,
    Admin(_): Admin,
    RoutePath(id): RoutePath<Uuid>,
    form: Multipart,
) -> ApiResult<impl IntoResponse> {
    let image = read_image(form).await?;
    Ok(Json(covers::set_album_cover(&state.db, &state.storage, id, image).await?))
}

pub(super) async fn remove_album_cover(
    State(state): State<AppState>,
    Admin(_): Admin,
    RoutePath(id): RoutePath<Uuid>,
) -> ApiResult<StatusCode> {
    covers::remove_album_cover(&state.db, &state.storage, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn set_artist_image(
    State(state): State<AppState>,
    Admin(_): Admin,
    RoutePath(id): RoutePath<Uuid>,
    form: Multipart,
) -> ApiResult<impl IntoResponse> {
    let image = read_image(form).await?;
    Ok(Json(covers::set_artist_image(&state.db, &state.storage, id, image).await?))
}

pub(super) async fn remove_artist_image(
    State(state): State<AppState>,
    Admin(_): Admin,
    RoutePath(id): RoutePath<Uuid>,
) -> ApiResult<StatusCode> {
    covers::remove_artist_image(&state.db, &state.storage, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn set_playlist_cover(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    RoutePath(id): RoutePath<Uuid>,
    form: Multipart,
) -> ApiResult<impl IntoResponse> {
    let image = read_image(form).await?;
    Ok(Json(covers::set_playlist_cover(&state.db, &state.storage, user.user_id, id, image).await?))
}

pub(super) async fn remove_playlist_cover(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    RoutePath(id): RoutePath<Uuid>,
) -> ApiResult<StatusCode> {
    covers::remove_playlist_cover(&state.db, &state.storage, user.user_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
