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
    MAX_TEXT,
    html::{Site, parse_results},
    network,
};
use reqwest::{Url, header};

const ZVU: Site = Site {
    source: "zvu4no",
    split: r#"<div class="f-table">"#,
    pattern: &[
        r#"(?s)<div class="artist-name">\s*<a [^>]*>(.*?)</a>"#,
        r#"(?s)<div class="track-name">(.*?)</div>"#,
        r#"(?s)<div class="time-text">(.*?)</div>"#,
        r#"<a class="mp3" href="(//[a-z0-9.-]+/[^"]+\.mp3)""#,
    ],
    bitrate: |_| None,
    domains: &["zvu4it.org"],
};

pub(super) fn register(context: &ProviderContext) -> Arc<dyn MusicProvider> {
    Arc::new(Zvu4no::new(context.transport.clone()))
}

struct Zvu4no {
    transport: Transport,
}

impl Zvu4no {
    fn new(transport: Transport) -> Self {
        Self { transport }
    }
}

impl MusicProvider for Zvu4no {
    fn id(&self) -> &'static str {
        "zvu4no"
    }
    fn name(&self) -> &'static str {
        "zvu4no"
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

impl Zvu4no {
    async fn lookup(&self, query: &str) -> AppResult<Vec<Hit>> {
        let mut url = Url::parse("https://zvu4it.org/tracks/").map_err(AppError::internal)?;
        url.path_segments_mut().map_err(|()| AppError::validation("Invalid source URL."))?.pop_if_empty().push(query);
        let mut response = self
            .transport
            .http
            .get(url)
            .header(header::REFERER, "https://zvu4it.org/")
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(network)?;
        let mut body = Vec::new();
        let interrupted = loop {
            match response.chunk().await {
                Ok(Some(chunk)) if body.len() + chunk.len() <= MAX_TEXT => body.extend_from_slice(&chunk),
                Ok(Some(_)) => return Err(AppError::validation("The music search response is too large.")),
                Ok(None) => break None,
                Err(error) => break Some(error),
            }
        };
        // Some search pages stop transferring after sending complete result rows.
        let hits = parse_results(ZVU, &String::from_utf8_lossy(&body))?;
        if hits.is_empty()
            && let Some(error) = interrupted
        {
            return Err(network(error));
        }
        Ok(hits)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_results_keep_duration_and_filter_download_hosts() -> AppResult<()> {
        let first = r#"<div class="f-table"><div class="artist-name"><a href="/">Artist &amp; Guest</a></div><div class="track-name">Window</div><div class="time-text">3:20</div><a class="mp3" href="//h1.zvu4it.org/song.mp3">"#;
        let bad = first.replace("h1.zvu4it.org", "zvu4it.org.evil.test");
        let actual = parse_results(ZVU, &format!("{first}{bad}"))?;
        assert_eq!(actual.len(), 1);
        assert_eq!(actual[0].candidate.track.duration, 200);
        assert_eq!(actual[0].candidate.track.artist, "Artist & Guest");
        Ok(())
    }
}
