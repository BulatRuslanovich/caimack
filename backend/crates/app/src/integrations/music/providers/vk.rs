// SPDX-License-Identifier: AGPL-3.0-only

use std::sync::{Arc, LazyLock};
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use futures_util::{FutureExt, future::BoxFuture};
use media::formats::{FLAC, MP3};
use regex::Regex;
use reqwest::Url;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use super::{Capabilities, MusicProvider, ProviderContext, SourceStatus};
use crate::integrations::music::audio::{Audio, Scratch};
use crate::integrations::music::browser::{Browser, Command};
use crate::integrations::music::{Candidate, PlaylistSnapshot, Recording, SearchResults};
use crate::{AppError, AppResult};

const BROWSER_SEARCH: Duration = Duration::from_secs(24);
const BROWSER_AUDIO: Duration = Duration::from_secs(72);

static PLAYLIST_ID: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"^-?\d{1,20}_\d{1,20}(?:_[A-Za-z0-9-]{1,128})?$").ok());

pub(super) fn register(context: &ProviderContext) -> Arc<dyn MusicProvider> {
    Arc::new(Vk(Arc::clone(&context.browser)))
}

struct Vk(pub Arc<Browser>);

impl MusicProvider for Vk {
    fn id(&self) -> &'static str {
        "vk"
    }

    fn name(&self) -> &'static str {
        "VK Music"
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities { tracks: true, playlist: true, audio: true, ..Default::default() }
    }

    fn status(&self, user: Uuid) -> SourceStatus {
        if self.0.ready(user) { SourceStatus::Ready } else { SourceStatus::NeedsBrowser }
    }

    fn parse_link(&self, url: &Url) -> Option<String> {
        if !matches!(url.host_str(), Some("vk.ru" | "vk.com")) {
            return None;
        }
        let id = url.path().trim_end_matches('/').strip_prefix("/music/playlist/")?;
        PLAYLIST_ID.as_ref()?.is_match(id).then(|| id.to_owned())
    }

    fn search<'a>(&'a self, user: Uuid, query: &'a str, _albums: bool) -> BoxFuture<'a, AppResult<SearchResults>> {
        async move {
            let value = self.0.request(user, Command::Search { query: query.to_owned() }, BROWSER_SEARCH).await?;
            Ok(SearchResults { tracks: browser_tracks(value)?, albums: Vec::new() })
        }
        .boxed()
    }

    fn playlist<'a>(&'a self, user: Uuid, id: &'a str) -> BoxFuture<'a, AppResult<PlaylistSnapshot>> {
        async move {
            let value = self.0.request(user, Command::Playlist { source: id.to_owned() }, BROWSER_SEARCH).await?;
            let playlist: BrowserPlaylist = serde_json::from_value(value).map_err(AppError::internal)?;
            Ok(PlaylistSnapshot {
                name: playlist.name,
                tracks: playlist.tracks.into_iter().map(vk_track).collect(),
                omitted: playlist.omitted,
                partial: false,
            })
        }
        .boxed()
    }

    fn stage<'a>(
        &'a self,
        user: Uuid,
        candidate: &'a Candidate,
        query: &'a str,
        playlist_id: Option<&'a str>,
    ) -> BoxFuture<'a, AppResult<Audio>> {
        self.stage_vk(user, candidate, query, playlist_id).boxed()
    }
}

impl Vk {
    async fn stage_vk(
        &self,
        user: Uuid,
        candidate: &Candidate,
        query: &str,
        playlist_id: Option<&str>,
    ) -> AppResult<Audio> {
        let command = match playlist_id {
            Some(source) => Command::PlaylistTrack { source: source.to_owned(), track_id: candidate.id.clone() },
            _ => Command::Download { query: query.to_owned(), track_id: candidate.id.clone() },
        };
        let value = self.0.request(user, command, BROWSER_AUDIO).await?;
        let reply: BrowserAudio = serde_json::from_value(value).map_err(AppError::internal)?;
        if reply.audio.len() > 24 * 1024 * 1024 / 3 * 4 + 4 {
            return Err(AppError::payload_too_large("The VK Music file exceeds the 24 MB upload limit."));
        }
        let bytes = STANDARD.decode(reply.audio).map_err(AppError::internal)?;
        if bytes.is_empty() || bytes.len() > 24 * 1024 * 1024 {
            return Err(AppError::validation("Could not read the audio from VK Music."));
        }
        let album = reply.album.filter(|album| !album.trim().is_empty() && album.chars().count() <= 200);
        let cover = reply
            .cover
            .filter(|cover| cover.len() <= 2 * 1024 * 1024 / 3 * 4 + 4)
            .and_then(|cover| STANDARD.decode(cover).ok());
        let format = match reply.format.as_str() {
            "flac" => FLAC,
            "mp3" | "stream" => MP3,
            _ => return Err(AppError::validation("Unsupported VK audio format.")),
        };
        let scratch = Scratch::new().await?;
        let path = scratch.file(&format!("audio{}", format.extension));
        let original_bitrate = if reply.format == "stream" {
            let input = scratch.file("source");
            tokio::fs::write(&input, bytes).await.map_err(AppError::internal)?;
            if !media::ffmpeg::convert_uploaded_audio_to_mp3(&input, &path).await? {
                return Err(AppError::validation("Could not read the audio from VK Music."));
            }
            Some(0)
        } else {
            tokio::fs::write(&path, bytes).await.map_err(AppError::internal)?;
            None
        };
        Ok(Audio { path, format, original_bitrate, album, cover, _scratch: scratch })
    }
}

#[derive(Deserialize)]
struct BrowserTrack {
    id: String,
    title: String,
    artist: String,
    duration: i32,
    #[serde(rename = "coverUrl")]
    cover_url: Option<String>,
    restricted: bool,
}

#[derive(Deserialize)]
struct BrowserPlaylist {
    name: String,
    tracks: Vec<BrowserTrack>,
    omitted: usize,
}

#[derive(Deserialize)]
struct BrowserAudio {
    audio: String,
    format: String,
    album: Option<String>,
    cover: Option<String>,
}

fn vk_track(track: BrowserTrack) -> Candidate {
    Candidate {
        track: Recording { title: track.title, artist: track.artist, duration: track.duration, isrc: None },
        source: "vk".into(),
        id: track.id,
        format: None,
        bitrate: None,
        album: None,
        cover_url: track.cover_url,
        restricted: track.restricted,
    }
}

fn browser_tracks(value: Value) -> AppResult<Vec<Candidate>> {
    let tracks: Vec<BrowserTrack> = serde_json::from_value(value).map_err(AppError::internal)?;
    Ok(tracks.into_iter().map(vk_track).collect())
}
