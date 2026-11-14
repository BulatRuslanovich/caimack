// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use app::recommendations::home::MixKind;
use app::sync;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::{
    Router,
    extract::State,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::auth::CurrentUser;
use crate::extract::{Json, Query, RoutePath};
use crate::files::FileReply;
use crate::problem::ApiResult;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/sync/snapshot", get(snapshot))
        .route("/api/sync/vectors", get(vectors))
        .route("/api/sync/actions", post(actions))
        .route("/api/sync/tracks/{id}/tags", get(tags))
        .route("/api/sync/tracks/{id}/audio", get(audio))
}

async fn snapshot(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> ApiResult<impl IntoResponse> {
    let mut snapshot = sync::snapshot(&state.db, &state.storage, user.user_id).await?;
    let reco = &state.recommendations;
    snapshot["recommendationsEnabled"] = json!(reco.enabled);
    if reco.enabled {
        let mut mixes = serde_json::Map::new();
        for kind in [MixKind::Daily, MixKind::New, MixKind::Top] {
            mixes.insert(
                format!("{kind:?}").to_lowercase(),
                serde_json::to_value(reco.mix(user.user_id, kind).await?).map_err(app::AppError::internal)?,
            );
        }
        snapshot["mixes"] = Value::Object(mixes);
        snapshot["radio"] =
            serde_json::to_value(reco.offline_radio(user.user_id).await?).map_err(app::AppError::internal)?;
    } else {
        snapshot["mixes"] = json!({});
        snapshot["radio"] = json!({"tracks":[]});
    }
    snapshot["feed"] = serde_json::to_value(reco.feed(&state.storage, &state.stats, user.user_id, 20).await?)
        .map_err(app::AppError::internal)?;
    snapshot["settings"] = serde_json::to_value(app::library::settings::get(&state.db, user.user_id).await?)
        .map_err(app::AppError::internal)?;
    Ok(([("Cache-Control", "private, no-store")], Json(snapshot)))
}

async fn vectors(State(state): State<AppState>) -> ApiResult<impl IntoResponse> {
    Ok(([("Cache-Control", "private, no-store")], Json(sync::vectors(&state.db).await?)))
}

async fn actions(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(batch): Json<sync::actions::Batch>,
) -> ApiResult<impl IntoResponse> {
    let result = sync::actions::exchange(&state.db, user.user_id, batch).await?;
    state.recommendations.listeners.forget(user.user_id);
    Ok(Json(result))
}

#[derive(Deserialize)]
struct Version {
    version: String,
}

async fn tags(
    State(state): State<AppState>,
    RoutePath(id): RoutePath<Uuid>,
    Query(query): Query<Version>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(sync::tags::get(&state.db, &state.storage, id, &query.version).await?))
}

async fn audio(
    State(state): State<AppState>,
    RoutePath(id): RoutePath<Uuid>,
    Query(query): Query<Version>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let track = app::streaming::open_track(&state.db, &state.storage, id).await?;
    if track.etag != format!("\"{}\"", query.version) {
        return Ok(StatusCode::PRECONDITION_FAILED.into_response());
    }
    Ok(FileReply {
        path: track.path,
        content_type: track.content_type,
        etag: track.etag,
        cache_control: "private, no-store",
        download_name: None,
        ranges: true,
    }
    .send(&headers)
    .await)
}
