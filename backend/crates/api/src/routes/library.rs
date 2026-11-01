// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

use app::library::admin::{self, CreateUserRequest};
use app::library::favorites;
use app::library::history::{self, RecordPlayRequest};
use app::library::playlists::{self, PlaylistRequest, TrackIdsRequest};
use app::library::settings::{self, UpdateUserSettingsRequest};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::IntoResponse;
use axum::routing::{get, post, put};
use axum::{Extension, Router};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::{self, Admin, CurrentUser};
use crate::client::ClientInfo;
use crate::extract::{Json, Paging, Query, RoutePath};
use crate::problem::ApiResult;
use crate::state::AppState;

const MAX_UPLOAD_BYTES: i64 = 200 * 1024 * 1024;
const MAX_IMAGE_UPLOAD_BYTES: i64 = 8 * 1024 * 1024;

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct EnrichmentStatus {
    kind: String,
    pending: i64,
    running: i64,
    cooling_down: i64,
    failed: i64,
    last_updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

async fn enrichment_status(State(state): State<AppState>, Admin(_): Admin) -> ApiResult<impl IntoResponse> {
    let rows: Vec<EnrichmentStatus> = sqlx::query_as(
        "SELECT kind,
         count(*) FILTER (WHERE next_attempt_at<=now() AND (locked_until IS NULL OR locked_until<now())) AS pending,
         count(*) FILTER (WHERE locked_until>=now()) AS running,
         count(*) FILTER (WHERE next_attempt_at>now() AND locked_until IS NULL) AS cooling_down,
         count(*) FILTER (WHERE last_outcome='failed') AS failed,
         max(updated_at) AS last_updated_at FROM enrichment_jobs GROUP BY kind ORDER BY kind",
    )
    .fetch_all(&state.db)
    .await
    .map_err(app::AppError::from)?;
    Ok(Json(rows))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/config", get(client_config))
        .route("/api/library/enrichment", get(enrichment_status))
        .route("/api/me/settings", get(get_settings).put(update_settings))
        .route("/api/me/password", post(change_password))
        .route("/api/favorites", get(list_favorites))
        .route("/api/tracks/{id}/favorite", post(add_favorite).delete(remove_favorite))
        .route("/api/history", get(list_history).post(record_play).delete(clear_history))
        .route("/api/history/recent", get(recently_played))
        .route("/api/playlists", get(own_playlists).post(create_playlist))
        .route("/api/playlists/public", get(public_playlists))
        .route("/api/playlists/{id}", get(playlist_detail).put(update_playlist).delete(delete_playlist))
        .route("/api/playlists/{id}/tracks", post(add_playlist_tracks))
        .route("/api/playlists/{id}/tracks/order", put(reorder_playlist))
        .route("/api/playlists/{id}/tracks/{track_id}", axum::routing::delete(remove_playlist_track))
        .route("/api/admin/users", get(list_users).post(create_user))
        .route("/api/admin/users/{id}/active", put(set_user_active))
        .route("/api/admin/users/{id}/role", put(set_user_role))
        .route("/api/admin/users/{id}/password", post(reset_user_password))
        .route("/api/admin/users/{id}/sessions/revoke", post(revoke_user_sessions))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClientConfig {
    max_upload_bytes: i64,
    max_image_upload_bytes: i64,
    access_token_minutes: i64,
}

async fn client_config(State(state): State<AppState>) -> Json<ClientConfig> {
    Json(ClientConfig {
        max_upload_bytes: MAX_UPLOAD_BYTES,
        max_image_upload_bytes: MAX_IMAGE_UPLOAD_BYTES,
        access_token_minutes: state.auth.tokens().access_token_minutes(),
    })
}

async fn get_settings(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> ApiResult<impl IntoResponse> {
    Ok(Json(settings::get(&state.db, user.user_id).await?))
}

async fn update_settings(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(request): Json<UpdateUserSettingsRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(settings::update(&state.db, user.user_id, request).await?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangePasswordRequest {
    current_password: String,
    new_password: String,
}

async fn change_password(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    client: Option<Extension<ClientInfo>>,
    Json(request): Json<ChangePasswordRequest>,
) -> ApiResult<impl IntoResponse> {
    let result = state
        .auth
        .change_password(user.user_id, user.session_id, &request.current_password, &request.new_password)
        .await?;
    let secure = auth::require_secure(&state, client.as_deref());
    Ok((auth::write_session(&result, secure), StatusCode::NO_CONTENT))
}

async fn list_favorites(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(paging): Query<Paging>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(favorites::list(&state.db, user.user_id, paging.request()).await?))
}

async fn add_favorite(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    RoutePath(id): RoutePath<Uuid>,
) -> ApiResult<StatusCode> {
    favorites::add(&state.db, user.user_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_favorite(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    RoutePath(id): RoutePath<Uuid>,
) -> ApiResult<StatusCode> {
    favorites::remove(&state.db, user.user_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_history(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(paging): Query<Paging>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(history::list(&state.db, user.user_id, paging.request()).await?))
}

async fn recently_played(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(paging): Query<Paging>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(history::recent(&state.db, user.user_id, paging.request()).await?))
}

async fn record_play(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(request): Json<RecordPlayRequest>,
) -> ApiResult<StatusCode> {
    history::record(&state.db, user.user_id, request).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn clear_history(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> ApiResult<StatusCode> {
    history::clear(&state.db, user.user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn own_playlists(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> ApiResult<impl IntoResponse> {
    Ok(Json(playlists::own(&state.db, user.user_id).await?))
}

async fn public_playlists(State(state): State<AppState>) -> ApiResult<impl IntoResponse> {
    Ok(Json(playlists::public(&state.db).await?))
}

async fn playlist_detail(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    RoutePath(id): RoutePath<Uuid>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(playlists::detail(&state.db, user.user_id, id).await?))
}

async fn create_playlist(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(request): Json<PlaylistRequest>,
) -> ApiResult<impl IntoResponse> {
    let playlist = playlists::create(&state.db, user.user_id, request).await?;
    let location = format!("/api/playlists/{}", playlist.id);
    Ok((StatusCode::CREATED, created_at(&location), Json(playlist)))
}

fn created_at(location: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    if let Ok(value) = location.parse() {
        headers.insert(header::LOCATION, value);
    }
    headers
}

async fn update_playlist(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    RoutePath(id): RoutePath<Uuid>,
    Json(request): Json<PlaylistRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(playlists::update(&state.db, user.user_id, id, request).await?))
}

async fn delete_playlist(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    RoutePath(id): RoutePath<Uuid>,
) -> ApiResult<StatusCode> {
    playlists::delete(&state.db, &state.storage, user.user_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn add_playlist_tracks(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    RoutePath(id): RoutePath<Uuid>,
    Json(request): Json<TrackIdsRequest>,
) -> ApiResult<StatusCode> {
    playlists::add_tracks(&state.db, user.user_id, id, &request.track_ids).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_playlist_track(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    RoutePath((id, track_id)): RoutePath<(Uuid, Uuid)>,
) -> ApiResult<StatusCode> {
    playlists::remove_track(&state.db, user.user_id, id, track_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn reorder_playlist(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    RoutePath(id): RoutePath<Uuid>,
    Json(request): Json<TrackIdsRequest>,
) -> ApiResult<StatusCode> {
    playlists::reorder(&state.db, user.user_id, id, &request.track_ids).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_users(
    State(state): State<AppState>,
    Admin(_): Admin,
    Query(paging): Query<Paging>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(admin::list(&state.db, paging.request()).await?))
}

async fn create_user(
    State(state): State<AppState>,
    Admin(_): Admin,
    Json(request): Json<CreateUserRequest>,
) -> ApiResult<impl IntoResponse> {
    let user = admin::create(&state.db, request).await?;
    let location = format!("/api/admin/users/{}", user.id);
    Ok((StatusCode::CREATED, created_at(&location), Json(user)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActiveRequest {
    is_active: bool,
}

async fn set_user_active(
    State(state): State<AppState>,
    Admin(_): Admin,
    RoutePath(id): RoutePath<Uuid>,
    Json(request): Json<ActiveRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(admin::set_active(&state.db, &state.auth, id, request.is_active).await?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoleRequest {
    is_admin: bool,
}

async fn set_user_role(
    State(state): State<AppState>,
    Admin(_): Admin,
    RoutePath(id): RoutePath<Uuid>,
    Json(request): Json<RoleRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(admin::set_admin(&state.db, id, request.is_admin).await?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResetPasswordRequest {
    new_password: String,
}

async fn reset_user_password(
    State(state): State<AppState>,
    Admin(_): Admin,
    RoutePath(id): RoutePath<Uuid>,
    Json(request): Json<ResetPasswordRequest>,
) -> ApiResult<StatusCode> {
    admin::reset_password(&state.db, &state.auth, id, request.new_password).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn revoke_user_sessions(
    State(state): State<AppState>,
    Admin(_): Admin,
    RoutePath(id): RoutePath<Uuid>,
) -> ApiResult<StatusCode> {
    admin::revoke_sessions(&state.db, &state.auth, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
