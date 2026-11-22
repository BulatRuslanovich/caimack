// SPDX-License-Identifier: AGPL-3.0-only

use app::AppError;
use app::integrations::vk::{self, MAX_BYTES, MAX_COVER_BYTES, VkAudio};
use axum::Router;
use axum::extract::multipart::MultipartError;
use axum::extract::{DefaultBodyLimit, Multipart, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::post;

use crate::auth::Admin;
use crate::extract::{Json, RequestLang};
use crate::problem::{ApiError, ApiResult};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/api/integrations/vk-music/import",
        post(import_vk_audio).layer(DefaultBodyLimit::max(MAX_BYTES + MAX_COVER_BYTES + 8192)),
    )
}

async fn import_vk_audio(
    State(state): State<AppState>,
    Admin(user): Admin,
    RequestLang(lang): RequestLang,
    mut form: Multipart,
) -> ApiResult<impl IntoResponse> {
    let invalid = || AppError::validation("Invalid VK Music upload.");
    let mut title = None;
    let mut artist = None;
    let mut format = None;
    let mut audio = None;
    let mut album = None;
    let mut cover = None;
    while let Some(field) = form.next_field().await.map_err(vk_upload_error)? {
        match field.name() {
            Some("title") if title.is_none() => title = Some(field.text().await.map_err(vk_upload_error)?),
            Some("artist") if artist.is_none() => artist = Some(field.text().await.map_err(vk_upload_error)?),
            Some("format") if format.is_none() => format = Some(field.text().await.map_err(vk_upload_error)?),
            Some("audio") if audio.is_none() => audio = Some(field.bytes().await.map_err(vk_upload_error)?),
            Some("album") if album.is_none() => album = Some(field.text().await.map_err(vk_upload_error)?),
            Some("cover") if cover.is_none() => cover = Some(field.bytes().await.map_err(vk_upload_error)?),
            _ => return Err(invalid().into()),
        }
    }
    let request = VkAudio {
        title: title.as_deref().ok_or_else(invalid)?,
        artist: artist.as_deref().ok_or_else(invalid)?,
        format: format.as_deref().ok_or_else(invalid)?,
        audio: audio.as_deref().ok_or_else(invalid)?,
        album: album.as_deref(),
        cover: cover.as_deref(),
    };
    let result = vk::import(&state.uploads, user.user_id, request, lang).await?;
    Ok(Json(result))
}

fn vk_upload_error(error: MultipartError) -> ApiError {
    if error.status() == StatusCode::PAYLOAD_TOO_LARGE {
        AppError::payload_too_large("The VK Music upload is too large.").into()
    } else {
        AppError::validation("Invalid VK Music upload.").into()
    }
}
