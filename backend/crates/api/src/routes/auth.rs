// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use app::AppError;
use app::auth::UserDto;
use app::auth::invitations::{self, RegisterRequest};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Extension, Router};
use serde::Deserialize;

use crate::auth::{self, CurrentUser};
use crate::client::ClientInfo;
use crate::extract::{Json, RoutePath};
use crate::problem::{ApiError, ApiResult};
use crate::state::AppState;

pub fn public() -> Router<AppState> {
    Router::new()
        .route("/api/auth/login", post(login))
        .route("/api/auth/refresh", post(refresh))
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/register", post(register))
        .route("/api/auth/invitations/{token}", get(invitation))
}

pub fn protected() -> Router<AppState> {
    Router::new().route("/api/auth/me", get(me))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginRequest {
    username: String,
    password: String,
    device_name: Option<String>,
    #[serde(default)]
    long_lived: bool,
}

async fn login(
    State(state): State<AppState>,
    info: Option<Extension<ClientInfo>>,
    headers: HeaderMap,
    Json(request): Json<LoginRequest>,
) -> ApiResult<impl IntoResponse> {
    let client = auth::client(info.as_deref(), &headers, request.device_name, request.long_lived);
    let result = state.auth.login(&request.username, &request.password, &client).await?;
    let secure = auth::require_secure(&state, info.as_deref());
    Ok((auth::write_session(&result, secure), Json(result.user)))
}

async fn refresh(State(state): State<AppState>, info: Option<Extension<ClientInfo>>, headers: HeaderMap) -> Response {
    let secure = auth::require_secure(&state, info.as_deref());
    let client = auth::client(info.as_deref(), &headers, None, false);

    match state.auth.refresh(auth::refresh_token(&headers).as_deref(), &client).await {
        Ok(result) => (auth::write_session(&result, secure), Json(result.user)).into_response(),

        Err(error @ AppError::Authentication(_)) => {
            (auth::clear_session(secure), ApiError::http(error)).into_response()
        }
        Err(error) => ApiError::from(error).into_response(),
    }
}

async fn logout(
    State(state): State<AppState>,
    info: Option<Extension<ClientInfo>>,
    headers: HeaderMap,
) -> ApiResult<impl IntoResponse> {
    state.auth.logout(auth::refresh_token(&headers).as_deref()).await?;
    let secure = auth::require_secure(&state, info.as_deref());
    Ok((auth::clear_session(secure), StatusCode::NO_CONTENT))
}

async fn me(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> ApiResult<Json<UserDto>> {
    Ok(Json(state.auth.user(user.user_id).await?))
}

async fn register(
    State(state): State<AppState>,
    info: Option<Extension<ClientInfo>>,
    headers: HeaderMap,
    Json(request): Json<RegisterRequest>,
) -> ApiResult<impl IntoResponse> {
    let client = auth::client(info.as_deref(), &headers, None, false);
    let result = state.auth.register(request, &client).await?;
    let secure = auth::require_secure(&state, info.as_deref());
    Ok((StatusCode::CREATED, auth::write_session(&result, secure), Json(result.user)))
}

async fn invitation(
    State(state): State<AppState>,
    RoutePath(token): RoutePath<String>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(invitations::check(&state.db, &token).await?))
}
