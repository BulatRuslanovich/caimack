// SPDX-License-Identifier: AGPL-3.0-only

mod music;
mod vk;
mod yandex;

use axum::Router;

use crate::state::AppState;

type IntegrationRoute = (&'static str, fn() -> Router<AppState>);

const INTEGRATIONS: &[IntegrationRoute] = &[("yandex", yandex::router), ("vk", vk::router)];

pub fn supported() -> Vec<&'static str> {
    INTEGRATIONS.iter().map(|(id, _)| *id).collect()
}

pub fn router() -> Router<AppState> {
    INTEGRATIONS.iter().fold(music::router(), |router, (_, module)| router.merge(module()))
}
