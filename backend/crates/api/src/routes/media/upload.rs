// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use app::upload::{self, ProbeFile};
use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use futures_util::TryStreamExt;
use serde::Deserialize;
use tokio_util::io::StreamReader;

use crate::auth::Admin;
use crate::extract::{Json, RequestLang};
use crate::problem::{ApiResult, validation_problem};
use crate::state::AppState;

#[derive(Deserialize)]
pub(super) struct ProbeRequest {
    files: Vec<ProbeFile>,
}

pub(super) async fn upload_check(
    State(state): State<AppState>,
    Admin(user): Admin,
    Json(request): Json<ProbeRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(upload::probe(&state.db, user.user_id, request.files).await?))
}

pub(super) async fn library_scan(
    State(state): State<AppState>,
    Admin(_): Admin,
    RequestLang(lang): RequestLang,
) -> impl IntoResponse {
    Json(state.library.status(lang))
}

pub(super) async fn rescan_library(
    State(state): State<AppState>,
    Admin(_): Admin,
    RequestLang(lang): RequestLang,
) -> impl IntoResponse {
    state.library.request();
    (StatusCode::ACCEPTED, Json(state.library.status(lang)))
}

pub(super) async fn upload(
    State(state): State<AppState>,
    Admin(user): Admin,
    RequestLang(lang): RequestLang,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let Some(raw_name) = headers.get("x-file-name").and_then(|value| value.to_str().ok()).filter(|v| !v.is_empty())
    else {
        return validation_problem("fileName", "The fileName field is required.".to_owned());
    };
    let file_name = percent_decode(raw_name);
    let length = headers.get(header::CONTENT_LENGTH).and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok());

    let reader = StreamReader::new(body.into_data_stream().map_err(std::io::Error::other));
    let result = state.uploads.upload(user.user_id, &file_name, length, reader, lang).await;
    let status = if result.uploaded.is_empty() { StatusCode::BAD_REQUEST } else { StatusCode::OK };
    (status, Json(result)).into_response()
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    let hex = |byte: u8| char::from(byte).to_digit(16).and_then(|digit| u8::try_from(digit).ok());
    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && let (Some(high), Some(low)) = (hex(bytes[index + 1]), hex(bytes[index + 2]))
        {
            decoded.push(high * 16 + low);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_are_percent_decoded() {
        assert_eq!(percent_decode("Mira%20Vale%20-%20%D0%A4.flac"), "Mira Vale - Ф.flac");
    }

    #[test]
    fn broken_escapes_stay_as_they_are() {
        assert_eq!(percent_decode("100%zz%2"), "100%zz%2");
    }
}
