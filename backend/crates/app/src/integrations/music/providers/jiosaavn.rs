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
use crate::integrations::music::transport::{Delivery, hosts, html::clean, json, network, number, text};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use des::Des;
use des::cipher::{Block, BlockCipherDecrypt, KeyInit};
use serde_json::Value;

pub(super) fn register(context: &ProviderContext) -> Arc<dyn MusicProvider> {
    Arc::new(JioSaavn::new(context.transport.clone()))
}

struct JioSaavn {
    transport: Transport,
}

impl JioSaavn {
    fn new(transport: Transport) -> Self {
        Self { transport }
    }
}

impl MusicProvider for JioSaavn {
    fn id(&self) -> &'static str {
        "jiosaavn"
    }
    fn name(&self) -> &'static str {
        "JioSaavn"
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

impl JioSaavn {
    async fn lookup(&self, query: &str) -> AppResult<Vec<Hit>> {
        let body: Value = json(
            self.transport
                .http
                .get("https://www.jiosaavn.com/api.php")
                .query(&[
                    ("__call", "search.getResults"),
                    ("_format", "json"),
                    ("_marker", "0"),
                    ("api_version", "4"),
                    ("ctx", "web6dot0"),
                    ("q", query),
                    ("p", "1"),
                    ("n", "30"),
                ])
                .send()
                .await
                .map_err(network)?,
        )
        .await?;
        Ok(body["results"].as_array().into_iter().flatten().filter_map(jiosaavn_hit).collect())
    }
}

fn jiosaavn_url(value: &str) -> Option<String> {
    let bytes = STANDARD.decode(value).ok()?;
    let cipher = Des::new_from_slice(b"38346591").ok()?;
    if bytes.is_empty() || bytes.len() % 8 != 0 || bytes.len() > 2048 {
        return None;
    }
    let mut plain = Vec::with_capacity(bytes.len());
    for chunk in bytes.as_chunks::<8>().0 {
        let mut block = Block::<Des>::default();
        block.copy_from_slice(chunk);
        cipher.decrypt_block(&mut block);
        plain.extend_from_slice(&block);
    }
    let pad = usize::from(*plain.last()?);
    if pad == 0 || pad > 8 || !plain[plain.len() - pad..].iter().all(|byte| usize::from(*byte) == pad) {
        return None;
    }
    plain.truncate(plain.len() - pad);
    let url = String::from_utf8(plain).ok()?;
    Some(url.replacen("http://", "https://", 1))
}

fn jiosaavn_hit(song: &Value) -> Option<Hit> {
    let details = &song["more_info"];
    let id = text(&song["id"]);
    if id.is_empty() {
        return None;
    }
    let duration = number(&details["duration"]).unwrap_or_default();
    let (url, bitrate) = if let Some(url) = hosts(text(&details["media_url"]), &["saavncdn.com"]) {
        (url, None)
    } else {
        let href = jiosaavn_url(text(&details["encrypted_media_url"]))?;
        let high_quality =
            details["320kbps"].as_bool() == Some(true) || text(&details["320kbps"]).eq_ignore_ascii_case("true");
        let bitrate = if high_quality { 320 } else { 160 };
        let href = href.replace("_96.", &format!("_{bitrate}."));
        (hosts(&href, &["saavncdn.com"])?, Some(bitrate))
    };
    let mut artist = details["artistMap"]["primary_artists"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|entry| clean(text(&entry["name"])))
        .filter(|entry| !entry.is_empty())
        .collect::<Vec<_>>()
        .join(", ");
    if artist.is_empty() {
        artist = clean(text(&song["subtitle"]).split(" - ").next().unwrap_or_default());
    }
    Some(
        Hit::new(
            "jiosaavn",
            id,
            Recording { title: clean(text(&song["title"])), artist, duration, isrc: None },
            Delivery::Http { url, hosts: &["saavncdn.com"] },
        )
        .quality("aac", bitrate)
        .album(&clean(text(&details["album"]))),
    )
}
