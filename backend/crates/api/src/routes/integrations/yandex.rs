// SPDX-License-Identifier: AGPL-3.0-only

use app::integrations::yandex::StartImportRequest;
use axum::Router;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{delete, get};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::Admin;
use crate::extract::{Json, Query, RequestLang, RoutePath};
use crate::problem::ApiResult;
use crate::state::AppState;

const TOKEN_HEADER: &str = "x-yandex-music-token";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/integrations/yandex-music/search", get(search))
        .route("/api/integrations/yandex-music/imports", get(imports).post(start))
        .route("/api/integrations/yandex-music/imports/{id}", delete(remove))
}

fn token(headers: &HeaderMap) -> Option<&str> {
    headers.get(TOKEN_HEADER).and_then(|value| value.to_str().ok())
}

#[derive(Deserialize)]
struct SearchQuery {
    q: Option<String>,
}

async fn search(
    State(state): State<AppState>,
    Admin(_): Admin,
    headers: HeaderMap,
    Query(query): Query<SearchQuery>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(state.yandex.search(token(&headers), query.q.as_deref()).await?))
}

async fn imports(State(state): State<AppState>, Admin(user): Admin) -> impl IntoResponse {
    Json(state.yandex.list(user.user_id))
}

async fn start(
    State(state): State<AppState>,
    Admin(user): Admin,
    RequestLang(lang): RequestLang,
    headers: HeaderMap,
    Json(request): Json<StartImportRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok((StatusCode::ACCEPTED, Json(state.yandex.start(user.user_id, token(&headers), request, lang)?)))
}

async fn remove(
    State(state): State<AppState>,
    Admin(user): Admin,
    RoutePath(id): RoutePath<Uuid>,
) -> ApiResult<StatusCode> {
    state.yandex.remove(user.user_id, id)?;
    Ok(StatusCode::NO_CONTENT)
}
