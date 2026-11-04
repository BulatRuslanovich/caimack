// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use app::auth::invitations::{self, CreateInvitationRequest};
use axum::Router;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use serde::Serialize;
use uuid::Uuid;

use crate::auth::{Admin, CurrentUser};
use crate::extract::{Json, RoutePath};
use crate::problem::ApiResult;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/me/sessions", get(sessions))
        .route("/api/me/sessions/{id}", delete(end_session))
        .route("/api/me/sessions/end-others", post(end_other_sessions))
        .route("/api/me/sign-ins", get(sign_ins))
        .route("/api/admin/invitations", get(list_invitations).post(create_invitation))
        .route("/api/admin/invitations/{id}", delete(revoke_invitation))
}

async fn sessions(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> ApiResult<impl IntoResponse> {
    Ok(Json(state.auth.sessions(user.user_id, user.session_id).await?))
}

async fn end_session(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    RoutePath(id): RoutePath<Uuid>,
) -> ApiResult<StatusCode> {
    state.auth.end_session(user.user_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize)]
struct Ended {
    ended: u64,
}

async fn end_other_sessions(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(Ended { ended: state.auth.end_other_sessions(user.user_id, user.session_id).await? }))
}

async fn sign_ins(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> ApiResult<impl IntoResponse> {
    Ok(Json(state.auth.sign_ins(user.user_id, &user.username).await?))
}

async fn list_invitations(State(state): State<AppState>, Admin(_): Admin) -> ApiResult<impl IntoResponse> {
    Ok(Json(invitations::list(&state.db).await?))
}

async fn create_invitation(
    State(state): State<AppState>,
    Admin(admin): Admin,
    Json(request): Json<CreateInvitationRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok((StatusCode::CREATED, Json(invitations::create(&state.db, admin.user_id, request).await?)))
}

async fn revoke_invitation(
    State(state): State<AppState>,
    Admin(_): Admin,
    RoutePath(id): RoutePath<Uuid>,
) -> ApiResult<StatusCode> {
    invitations::revoke(&state.db, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
