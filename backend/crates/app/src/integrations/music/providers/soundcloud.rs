// SPDX-License-Identifier: AGPL-3.0-only

use futures_util::{FutureExt, future::BoxFuture};
use std::sync::Arc;
use uuid::Uuid;

use super::{Capabilities, MusicProvider, ProviderContext};
use crate::integrations::music::audio::Audio;
use crate::integrations::music::transport::{Hit, Transport};
use crate::integrations::music::{Candidate, SearchResults};
use crate::{AppError, AppResult};

use crate::integrations::music::Recording;
use crate::integrations::music::transport::{Delivery, duration_ms, hosts, json, network, page, text};
use futures_util::{StreamExt, stream};
use moka::sync::Cache;
use regex::Regex;
use reqwest::header;
use serde_json::Value;
use std::{sync::LazyLock, time::Duration};

const SOUNDCLOUD_SEARCH: &str = "https://api-v2.soundcloud.com/search/tracks";
static SCRIPT: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(r#"<script[^>]+src="([^"]+)""#).ok());
static CLIENT_ID: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r#"client_id\s*[:=]\s*["']([A-Za-z0-9]{32})["']"#).ok());

pub(super) fn register(context: &ProviderContext) -> Arc<dyn MusicProvider> {
    Arc::new(SoundCloud::new(context.transport.clone()))
}

struct SoundCloud {
    transport: Transport,
    soundcloud_id: Cache<(), String>,
}

impl SoundCloud {
    fn new(transport: Transport) -> Self {
        Self {
            transport,
            soundcloud_id: Cache::builder().max_capacity(1).time_to_live(Duration::from_secs(3600)).build(),
        }
    }
}

impl MusicProvider for SoundCloud {
    fn id(&self) -> &'static str {
        "soundcloud"
    }
    fn name(&self) -> &'static str {
        "SoundCloud"
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

impl SoundCloud {
    async fn lookup(&self, query: &str) -> AppResult<Vec<Hit>> {
        for _ in 0..2 {
            let key = match self.soundcloud_id.get(&()) {
                Some(key) => key,
                None => {
                    let key = self.soundcloud_token().await?;
                    self.soundcloud_id.insert((), key.clone());
                    key
                }
            };
            let response = self
                .transport
                .http
                .get(SOUNDCLOUD_SEARCH)
                .query(&[("q", query), ("client_id", &key), ("limit", "40")])
                .send()
                .await
                .map_err(network)?;
            if matches!(response.status().as_u16(), 401 | 403) {
                self.soundcloud_id.invalidate(&());
                continue;
            }
            let body: Value = json(response).await?;
            return Ok(body["collection"].as_array().into_iter().flatten().filter_map(soundcloud_hit).collect());
        }
        Err(AppError::validation("SoundCloud did not accept the public search session."))
    }

    async fn soundcloud_token(&self) -> AppResult<String> {
        let html = page(self.transport.http.get("https://soundcloud.com/").send().await.map_err(network)?).await?;
        let scripts = SCRIPT
            .as_ref()
            .into_iter()
            .flat_map(|regex| regex.captures_iter(&html))
            .filter_map(|capture| hosts(capture.get(1)?.as_str(), &["sndcdn.com"]))
            .collect::<Vec<_>>();
        let mut sessions = stream::iter(scripts.into_iter().rev().take(12))
            .map(|url| async move {
                let response = self
                    .transport
                    .http
                    .get(url)
                    .header(header::REFERER, "https://soundcloud.com/")
                    .send()
                    .await
                    .ok()?;
                let script = page(response).await.ok()?;
                let key = CLIENT_ID.as_ref()?.captures(&script)?.get(1)?;
                Some(key.as_str().to_owned())
            })
            .buffer_unordered(4);
        while let Some(session) = sessions.next().await {
            if let Some(session) = session {
                return Ok(session);
            }
        }
        Err(AppError::validation("SoundCloud did not provide a public search session."))
    }
}

fn soundcloud_hit(row: &Value) -> Option<Hit> {
    let playable = row["media"]["transcodings"].as_array()?.iter().any(|rendition| {
        let protocol = text(&rendition["format"]["protocol"]);
        !protocol.is_empty() && !protocol.contains("encrypted") && rendition["snipped"].as_bool() != Some(true)
    });
    if !playable {
        return None;
    }
    let url = hosts(text(&row["permalink_url"]), &["soundcloud.com"])?;
    let id = row["id"].as_u64().map(|id| id.to_string()).unwrap_or_else(|| url.as_str().to_owned());
    let publisher = &row["publisher_metadata"];
    let artist = publisher["artist"]
        .as_str()
        .filter(|artist| !artist.is_empty())
        .unwrap_or_else(|| text(&row["user"]["username"]));
    let isrc = publisher["isrc"].as_str().filter(|value| !value.is_empty()).map(str::to_owned);
    Some(Hit::new(
        "soundcloud",
        &id,
        Recording {
            title: text(&row["title"]).into(),
            artist: artist.into(),
            duration: duration_ms(&row["duration"]),
            isrc,
        },
        Delivery::Extract(url),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn search_stays_ready_when_audio_extractor_is_missing() -> AppResult<()> {
        let source = SoundCloud::new(Transport::new(crate::config::MusicSourcesConfig {
            extractor: "test-missing-yt-dlp".into(),
            ..Default::default()
        })?);
        let user = Uuid::nil();
        assert!(source.status(user) == super::super::SourceStatus::Ready);
        assert!(source.audio_status(user) == super::super::SourceStatus::MissingExtractor);
        Ok(())
    }

    #[test]
    fn soundcloud_limits_results_to_complete_clear_audio() {
        let mut item = json!({
            "id": 12, "title": "Window", "user": {"username": "Artist"},
            "permalink_url": "https://soundcloud.com/artist/window", "duration": 185100,
            "media": {"transcodings": [{"format": {"protocol": "hls"}, "snipped": false}]}
        });
        assert_eq!(soundcloud_hit(&item).unwrap().candidate.track.duration, 185);
        item["media"]["transcodings"][0]["snipped"] = Value::Bool(true);
        assert!(soundcloud_hit(&item).is_none());
    }
}
