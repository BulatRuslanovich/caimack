// SPDX-License-Identifier: AGPL-3.0-only

pub(crate) mod audio;
mod browser;
mod jobs;
mod model;
mod providers;
mod transport;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use uuid::Uuid;

use crate::AppResult;
use crate::config::MusicSourcesConfig;
use crate::upload::Uploads;

pub use browser::Ticket;
pub use model::{
    Candidate, ImportItem, ImportRequest, ImportSummary, PlaylistSnapshot, Recording, SearchAlbum, SearchGroups,
    SearchKind, SearchResults, TrackSelection,
};

pub use providers::Source;

struct Preview {
    id: Uuid,
    read_at: Instant,
    url: String,
    snapshot: PlaylistSnapshot,
}

#[derive(Clone)]
pub struct Music {
    uploads: Uploads,
    #[cfg(all(test, feature = "integration-tests"))]
    transport: transport::Transport,
    providers: Arc<[Arc<dyn providers::MusicProvider>]>,
    browser: Arc<browser::Browser>,
    previews: Arc<Mutex<HashMap<Uuid, Preview>>>,
}

impl Music {
    pub fn new(uploads: Uploads, config: MusicSourcesConfig, yandex: super::yandex::YandexMusic) -> AppResult<Self> {
        let transport = transport::Transport::new(config)?;
        let browser = Arc::new(browser::Browser::default());
        let context = providers::ProviderContext { transport, browser: Arc::clone(&browser), yandex };
        let providers = providers::registry(&context)?;
        Ok(Self {
            uploads,
            providers,
            browser,
            previews: Arc::default(),
            #[cfg(all(test, feature = "integration-tests"))]
            transport: context.transport,
        })
    }

    pub fn browser_next(&self, user: Uuid) -> Option<Ticket> {
        self.browser.next(user)
    }

    pub fn browser_complete(&self, user: Uuid, id: Uuid, value: Result<serde_json::Value, String>) -> AppResult<()> {
        self.browser.complete(user, id, value)
    }

    pub fn register_token(&self, user: Uuid, token: Option<&str>) {
        if let Some(provider) = self.provider("yandex") {
            provider.set_token(user, token);
        }
    }
}
