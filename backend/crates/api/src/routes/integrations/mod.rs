// SPDX-License-Identifier: AGPL-3.0-only

#[cfg(feature = "integration-vk")]
mod vk;
#[cfg(feature = "integration-yandex")]
mod yandex;

use axum::Router;

use crate::state::AppState;

type IntegrationRoute = (&'static str, fn() -> Router<AppState>);

const INTEGRATIONS: &[IntegrationRoute] = &[
    #[cfg(feature = "integration-yandex")]
    ("yandex", yandex::router),
    #[cfg(feature = "integration-vk")]
    ("vk", vk::router),
];

pub fn supported() -> Vec<&'static str> {
    INTEGRATIONS.iter().map(|(id, _)| *id).collect()
}

pub fn router() -> Router<AppState> {
    INTEGRATIONS.iter().fold(Router::new(), |router, (_, module)| router.merge(module()))
}
