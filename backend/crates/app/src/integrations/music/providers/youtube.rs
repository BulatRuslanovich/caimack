// SPDX-License-Identifier: AGPL-3.0-only

use futures_util::{FutureExt, future::BoxFuture};
use std::sync::Arc;
use uuid::Uuid;

use super::{Capabilities, MusicProvider, ProviderContext};
use crate::AppResult;
use crate::integrations::music::audio::Audio;
use crate::integrations::music::transport::{Hit, Transport};
use crate::integrations::music::{Candidate, SearchResults};

use crate::integrations::music::Recording;
use crate::integrations::music::transport::{Delivery, extractor::run, number, text};
use reqwest::Url;
use serde_json::Value;
use std::time::Duration;

pub(super) fn register(context: &ProviderContext) -> Arc<dyn MusicProvider> {
    Arc::new(YouTube::new(context.transport.clone()))
}

struct YouTube {
    transport: Transport,
}

impl YouTube {
    fn new(transport: Transport) -> Self {
        Self { transport }
    }
}

impl MusicProvider for YouTube {
    fn id(&self) -> &'static str {
        "youtube"
    }
    fn name(&self) -> &'static str {
        "YouTube"
    }
    fn capabilities(&self) -> Capabilities {
        Capabilities { tracks: true, audio: true, ..Default::default() }
    }
    fn audio_status(&self, _user: Uuid) -> super::SourceStatus {
        if self.transport.extractor_available() {
            super::SourceStatus::Ready
        } else {
            super::SourceStatus::MissingExtractor
        }
    }

    fn status(&self, user: Uuid) -> super::SourceStatus {
        self.audio_status(user)
    }

    fn search<'a>(&'a self, _user: Uuid, query: &'a str, _albums: bool) -> BoxFuture<'a, AppResult<SearchResults>> {
        self.transport.search(self.id(), query, self.lookup(query)).boxed()
    }

    fn stage<'a>(
        &'a self,
        user: Uuid,
        candidate: &'a Candidate,
        query: &'a str,
        _playlist_id: Option<&'a str>,
    ) -> BoxFuture<'a, AppResult<Audio>> {
        self.transport.stage(candidate, query, self.search(user, query, false)).boxed()
    }
}

impl YouTube {
    async fn lookup(&self, query: &str) -> AppResult<Vec<Hit>> {
        let mut command = self.transport.extractor()?;
        command.args(["--flat-playlist", "--dump-json", "--", &format!("ytsearch25:{query}")]);
        let bytes = run(command, Duration::from_secs(38)).await?;
        Ok(String::from_utf8_lossy(&bytes)
            .lines()
            .filter_map(|line| serde_json::from_str(line).ok())
            .filter_map(|row| youtube_hit(&row))
            .collect())
    }
}

fn youtube_hit(row: &Value) -> Option<Hit> {
    let id = text(&row["id"]);
    if id.len() != 11 || !id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_') {
        return None;
    }
    let url = Url::parse(&format!("https://www.youtube.com/watch?v={id}")).ok()?;
    let artist =
        [&row["artist"], &row["channel"], &row["uploader"]].into_iter().map(text).find(|value| !value.is_empty())?;
    Some(Hit::new(
        "youtube",
        id,
        Recording {
            title: text(&row["title"]).into(),
            artist: artist.into(),
            duration: number(&row["duration"]).unwrap_or_default(),
            isrc: None,
        },
        Delivery::Extract(url),
    ))
}
