// SPDX-License-Identifier: AGPL-3.0-only

use crate::{auth::CurrentUser, extract::Json, problem::ApiResult, state::AppState};
use app::library::listening::{self, ListeningOverview};
use axum::{Router, extract::State, routing::get};

pub fn router() -> Router<AppState> {
    Router::new().route("/api/me/listening-stats", get(overview))
}

async fn overview(State(state): State<AppState>, CurrentUser(user): CurrentUser) -> ApiResult<Json<ListeningOverview>> {
    Ok(Json(listening::overview(&state.db, user.user_id).await?))
}
