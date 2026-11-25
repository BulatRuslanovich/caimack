// SPDX-License-Identifier: AGPL-3.0-only

use futures_util::{FutureExt, future::BoxFuture};
use std::sync::Arc;
use uuid::Uuid;

use super::{Capabilities, MusicProvider, ProviderContext};
use crate::integrations::music::audio::Audio;
use crate::integrations::music::transport::{Hit, Transport};
use crate::integrations::music::{Candidate, SearchResults};
use crate::{AppError, AppResult};

use crate::integrations::music::transport::{
    html::{Site, parse_results},
    network, page, redirect,
};
use regex::Regex;
use reqwest::{Url, header};
use std::sync::LazyLock;

const FREE: Site = Site {
    source: "freemp3cloud",
    split: r#"<div class="play-item">"#,
    pattern: &[
        r#"(?s)class="s-artist">(.*?)</div>"#,
        r#"(?s)class="s-title">(.*?)</div>"#,
        r#"(?s)class="s-time">(.*?)</div>"#,
        r#"class="downl">\s*<a href="(https://[^"]+\.mp3[^"]*)""#,
    ],
    bitrate: |block| Some(if block.contains(r#"class="s-hq""#) { 320 } else { 128 }),
    domains: &["freemp3cloud.com", "meln.top"],
};

static TOKEN: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r#"name="__RequestVerificationToken"[^>]*value="([^"]+)""#).ok());

pub(super) fn register(context: &ProviderContext) -> Arc<dyn MusicProvider> {
    Arc::new(FreeMp3Cloud::new(context.transport.clone()))
}

struct FreeMp3Cloud {
    transport: Transport,
}

impl FreeMp3Cloud {
    fn new(transport: Transport) -> Self {
        Self { transport }
    }
}

impl MusicProvider for FreeMp3Cloud {
    fn id(&self) -> &'static str {
        "freemp3cloud"
    }
    fn name(&self) -> &'static str {
        "FreeMp3Cloud"
    }
    fn capabilities(&self) -> Capabilities {
        Capabilities { tracks: true, audio: true, ..Default::default() }
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

impl FreeMp3Cloud {
    async fn lookup(&self, query: &str) -> AppResult<Vec<Hit>> {
        for attempt in 0..2 {
            let mut url = Url::parse("https://g2.freemp3cloud.com/").map_err(AppError::internal)?;
            let mut landing = self.transport.http.get(url.clone()).send().await.map_err(network)?;
            for _ in 0..3 {
                if !landing.status().is_redirection() {
                    break;
                }
                url = redirect(&landing, &["freemp3cloud.com"])?;
                landing = self.transport.http.get(url.clone()).send().await.map_err(network)?;
            }
            let cookies = landing
                .headers()
                .get_all(header::SET_COOKIE)
                .iter()
                .filter_map(|value| value.to_str().ok()?.split(';').next())
                .collect::<Vec<_>>()
                .join("; ");
            let html = page(landing).await?;
            let token = TOKEN
                .as_ref()
                .and_then(|regex| regex.captures(&html))
                .and_then(|capture| capture.get(1))
                .map(|token| token.as_str())
                .ok_or_else(|| AppError::validation("FreeMp3Cloud did not return a search session."))?;
            let response = self
                .transport
                .http
                .post(url.clone())
                .header(header::REFERER, url.as_str())
                .header(header::COOKIE, cookies)
                .form(&[("searchSong", query), ("__RequestVerificationToken", token)])
                .send()
                .await
                .map_err(network)?;
            let results = parse_results(FREE, &page(response).await?)?;
            if attempt == 1 || !results.is_empty() {
                return Ok(results);
            }
        }
        Ok(Vec::new())
    }
}
