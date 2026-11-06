// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use app::recommendations::duplicates::{DismissDuplicatesRequest, MergeDuplicatesRequest};
use app::recommendations::home::MixKind;
use app::recommendations::radio::RadioRequestDto;
use app::recommendations::rules::CreateRuleRequest;
use axum::Router;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::{Admin, CurrentUser};
use crate::extract::{Json, Query, RoutePath, optional};
use crate::problem::{ApiResult, validation_problem};
use crate::state::AppState;

const DEFAULT_SECTION_SIZE: i64 = 12;
const DEFAULT_STATS_DAYS: i32 = 30;

pub fn router(enabled: bool) -> Router<AppState> {
    let base = Router::new()
        .route("/api/home/feed", get(feed))
        .route("/api/library/duplicates", get(duplicates))
        .route("/api/library/duplicates/dismiss", post(dismiss_duplicates))
        .route("/api/library/duplicates/merge", post(merge_duplicates));
    if !enabled {
        return base;
    }
    base.route("/api/home/mixes/{kind}", get(mix))
        .route("/api/recommendations/radio", post(radio))
        .route("/api/recommendations/moods", get(moods))
        .route("/api/recommendations/stats", get(stats))
        .route("/api/recommendations/rules", get(rules).post(add_rule))
        .route("/api/recommendations/rules/{id}", delete(remove_rule))
        .route("/api/recap", get(recap))
        .route("/api/library/map", get(map))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeedQuery {
    #[serde(default, deserialize_with = "optional")]
    section_size: Option<i64>,
}

async fn feed(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(query): Query<FeedQuery>,
) -> ApiResult<impl IntoResponse> {
    let size = query.section_size.unwrap_or(DEFAULT_SECTION_SIZE).clamp(1, 50);
    Ok(Json(state.recommendations.feed(&state.storage, &state.stats, user.user_id, size).await?))
}

async fn mix(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    RoutePath(kind): RoutePath<String>,
) -> ApiResult<Response> {
    let Some(kind) = MixKind::parse(&kind) else {
        return Ok(validation_problem("kind", format!("The value '{kind}' is not valid.")));
    };
    Ok(Json(state.recommendations.mix(user.user_id, kind).await?).into_response())
}

async fn radio(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(request): Json<RadioRequestDto>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(state.recommendations.radio(user.user_id, request).await?))
}

async fn rules(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> ApiResult<impl IntoResponse> {
    Ok(Json(state.recommendations.rules(user.user_id).await?))
}

async fn add_rule(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(request): Json<CreateRuleRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok((StatusCode::CREATED, Json(state.recommendations.add_rule(user.user_id, request).await?)))
}

async fn remove_rule(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    RoutePath(id): RoutePath<Uuid>,
) -> ApiResult<StatusCode> {
    state.recommendations.remove_rule(user.user_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn moods(State(state): State<AppState>, CurrentUser(_): CurrentUser) -> ApiResult<impl IntoResponse> {
    Ok(Json(state.recommendations.moods().await?))
}

#[derive(Deserialize)]
struct StatsQuery {
    #[serde(default, deserialize_with = "optional")]
    days: Option<i32>,
}

async fn stats(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(query): Query<StatsQuery>,
) -> ApiResult<impl IntoResponse> {
    let days = query.days.unwrap_or(DEFAULT_STATS_DAYS);
    Ok(Json(state.recommendations.stats(user.user_id, days).await?))
}

async fn recap(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> ApiResult<Response> {
    Ok(match state.recommendations.recap(user.user_id).await? {
        Some(recap) => Json(recap).into_response(),
        None => StatusCode::NO_CONTENT.into_response(),
    })
}

async fn map(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> ApiResult<impl IntoResponse> {
    Ok(Json(state.recommendations.map(user.user_id).await?))
}

async fn duplicates(State(state): State<AppState>, Admin(user): Admin) -> ApiResult<impl IntoResponse> {
    Ok(Json(state.recommendations.duplicates(user.user_id).await?))
}

async fn dismiss_duplicates(
    State(state): State<AppState>,
    Admin(_): Admin,
    Json(request): Json<DismissDuplicatesRequest>,
) -> ApiResult<StatusCode> {
    state.recommendations.dismiss_duplicates(&request.track_ids.unwrap_or_default()).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn merge_duplicates(
    State(state): State<AppState>,
    Admin(_): Admin,
    Json(request): Json<MergeDuplicatesRequest>,
) -> ApiResult<StatusCode> {
    let remove = request.remove_ids.unwrap_or_default();
    state.recommendations.merge_duplicates(&state.storage, request.keep_id, &remove).await?;
    Ok(StatusCode::NO_CONTENT)
}
