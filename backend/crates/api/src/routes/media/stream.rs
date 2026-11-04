// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use app::library::settings::AudioQuality;
use app::streaming;
use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::extract::{Json, Query, RoutePath};
use crate::files::FileReply;
use crate::problem::{ApiError, ApiResult, validation_problem};
use crate::state::AppState;

pub(super) async fn stream(
    State(state): State<AppState>,
    RoutePath(id): RoutePath<Uuid>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let track = streaming::open_track(&state.db, &state.storage, id).await?;
    let reply = FileReply {
        path: track.path,
        content_type: track.content_type,
        etag: track.etag,
        cache_control: "private, max-age=604800",
        download_name: None,
        ranges: true,
    };
    Ok(reply.send(&headers).await)
}

pub(super) async fn download(
    State(state): State<AppState>,
    RoutePath(id): RoutePath<Uuid>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let track = streaming::open_track(&state.db, &state.storage, id).await?;
    let reply = FileReply {
        path: track.path,
        content_type: track.content_type,
        etag: track.etag,
        cache_control: "private, no-store",
        download_name: Some(track.download_name),
        ranges: true,
    };
    Ok(reply.send(&headers).await)
}

#[derive(Serialize)]
struct Waveform {
    peaks: Vec<i32>,
}

pub(super) async fn waveform(
    State(state): State<AppState>,
    RoutePath(id): RoutePath<Uuid>,
) -> ApiResult<impl IntoResponse> {
    let peaks = streaming::waveform(&state.db, id).await?;
    Ok(([(header::CACHE_CONTROL, "private, max-age=86400")], Json(Waveform { peaks })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MasterQuery {
    max_quality: Option<String>,
}

fn quality(field: &str, value: Option<&str>, default: AudioQuality) -> Result<AudioQuality, Box<Response>> {
    match value.map(str::trim).filter(|v| !v.is_empty()) {
        None => Ok(default),
        Some(text) => AudioQuality::parse(text)
            .ok_or_else(|| Box::new(validation_problem(field, format!("The value '{text}' is not valid.")))),
    }
}

pub(super) async fn hls_master(
    State(state): State<AppState>,
    RoutePath(id): RoutePath<Uuid>,
    Query(query): Query<MasterQuery>,
) -> Response {
    let max = match quality("maxQuality", query.max_quality.as_deref(), AudioQuality::Normal) {
        Ok(max) => max,
        Err(rejection) => return *rejection,
    };
    let master = match streaming::hls_master(&state.db, &state.storage, &state.transcodes, id, max).await {
        Ok(master) => master,
        Err(error) => return ApiError::from(error).into_response(),
    };

    let mut headers = HeaderMap::new();
    if let Ok(etag) = HeaderValue::from_str(&master.etag) {
        headers.insert(header::ETAG, etag);
    }
    match master.playlist {
        Some(playlist) => {
            headers.insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("private, max-age=3600, stale-while-revalidate=86400"),
            );
            headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/vnd.apple.mpegurl"));
            (StatusCode::OK, headers, playlist).into_response()
        }
        None => {
            headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            headers.insert(header::RETRY_AFTER, HeaderValue::from_static("2"));
            (StatusCode::ACCEPTED, headers).into_response()
        }
    }
}

pub(super) async fn hls_asset(
    State(state): State<AppState>,
    RoutePath((id, quality_name, file_name)): RoutePath<(Uuid, String, String)>,
    headers: HeaderMap,
) -> Response {
    let quality = match quality("quality", Some(&quality_name), AudioQuality::Normal) {
        Ok(quality) => quality,
        Err(rejection) => return *rejection,
    };
    match streaming::hls_asset(&state.db, &state.storage, &state.hashes, id, quality, &file_name).await {
        Ok(asset) => {
            let reply = FileReply {
                path: asset.path,
                content_type: asset.content_type.to_owned(),
                etag: asset.etag,
                cache_control: "private, max-age=31536000, immutable",
                download_name: None,
                ranges: true,
            };
            reply.send(&headers).await
        }
        Err(error) => ApiError::from(error).into_response(),
    }
}
