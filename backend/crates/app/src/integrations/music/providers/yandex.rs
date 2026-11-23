// SPDX-License-Identifier: AGPL-3.0-only

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::{FutureExt, future::BoxFuture};
use reqwest::Url;
use uuid::Uuid;

use super::{Capabilities, MusicProvider, ProviderContext, SourceStatus};
use crate::integrations::music::audio::Audio;
use crate::integrations::music::{Candidate, PlaylistSnapshot, Recording, SearchAlbum, SearchResults};
use crate::integrations::yandex::{
    YandexMusic,
    client::{YandexTrack, thumbnail_url},
    importer, playlist, require_token,
};
use crate::{AppError, AppResult};

pub(super) fn register(context: &ProviderContext) -> Arc<dyn MusicProvider> {
    Arc::new(Yandex::new(context.yandex.clone()))
}

struct Yandex {
    client: YandexMusic,
    tokens: Mutex<HashMap<Uuid, (Instant, String)>>,
}

impl Yandex {
    fn new(client: YandexMusic) -> Self {
        Self { client, tokens: Mutex::default() }
    }

    fn token(&self, user: Uuid) -> Option<String> {
        self.tokens
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&user)
            .filter(|(seen, _)| seen.elapsed() < Duration::from_secs(7200))
            .map(|(_, token)| token.clone())
    }
}

impl MusicProvider for Yandex {
    fn id(&self) -> &'static str {
        "yandex"
    }

    fn name(&self) -> &'static str {
        "Yandex Music"
    }

    fn set_token(&self, user: Uuid, token: Option<&str>) {
        if let Some(token) = token.filter(|token| token.len() <= 512) {
            let mut tokens = self.tokens.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            tokens.retain(|_, (seen, _)| seen.elapsed() < Duration::from_secs(7200));
            if token.is_empty() {
                tokens.remove(&user);
            } else {
                tokens.insert(user, (Instant::now(), token.to_owned()));
            }
        }
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities { tracks: true, albums: true, playlist: true, audio: true }
    }

    fn status(&self, user: Uuid) -> SourceStatus {
        if self.token(user).is_some() { SourceStatus::Ready } else { SourceStatus::NeedsToken }
    }

    fn parse_link(&self, url: &Url) -> Option<String> {
        if url.host_str() != Some("music.yandex.ru") {
            return None;
        }
        if let Some(id) = url.path().trim_end_matches('/').strip_prefix("/album/") {
            return valid_id(id).then(|| format!("/album/{id}"));
        }
        playlist::api_path(url.as_str())
    }

    fn is_album_link(&self, id: &str) -> bool {
        id.starts_with("/album/")
    }

    fn search<'a>(&'a self, user: Uuid, query: &'a str, albums: bool) -> BoxFuture<'a, AppResult<SearchResults>> {
        async move {
            let token = self.token(user);
            let token = require_token(token.as_deref())?;
            let (tracks, found_albums) = self.client.client().search(token, query).await?;
            let albums = if albums {
                found_albums
                    .into_iter()
                    .filter(|album| valid_id(&album.id))
                    .map(|album| SearchAlbum {
                        url: format!("https://music.yandex.ru/album/{}", album.id),
                        title: album.title,
                        artist: album.artists.join(", "),
                        track_count: album.track_count,
                        cover_url: thumbnail_url(album.cover_uri.as_deref()),
                    })
                    .collect()
            } else {
                Vec::new()
            };
            Ok(SearchResults { tracks: tracks.into_iter().map(track).collect(), albums })
        }
        .boxed()
    }

    fn playlist<'a>(&'a self, user: Uuid, id: &'a str) -> BoxFuture<'a, AppResult<PlaylistSnapshot>> {
        async move {
            let token = self.token(user);
            let token = require_token(token.as_deref())?;
            let client = self.client.client();
            let (name, tracks) = if let Some(id) = id.strip_prefix("/album/") {
                let (album, tracks) = client.album(token, id).await?;
                (album.title, tracks)
            } else {
                client.playlist(token, id).await?
            };
            Ok(PlaylistSnapshot { name, tracks: tracks.into_iter().map(track).collect(), omitted: 0, partial: false })
        }
        .boxed()
    }

    fn stage<'a>(
        &'a self,
        user: Uuid,
        candidate: &'a Candidate,
        _query: &'a str,
        _playlist_id: Option<&'a str>,
    ) -> BoxFuture<'a, AppResult<Audio>> {
        async move {
            let token = self.token(user);
            let token = require_token(token.as_deref())?;
            if !valid_id(&candidate.id) {
                return Err(AppError::validation("Invalid Yandex Music track."));
            }
            let client = self.client.client();
            let tracks = client.tracks(token, std::slice::from_ref(&candidate.id)).await?;
            let track = tracks
                .into_iter()
                .find(|track| track.id == candidate.id && track.available)
                .ok_or_else(|| AppError::validation("The Yandex Music track is unavailable."))?;
            importer::prepare(client, token, &track, &HashMap::new()).await
        }
        .boxed()
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 20 && id.bytes().all(|byte| byte.is_ascii_digit())
}

fn track(track: YandexTrack) -> Candidate {
    let artist = importer::artist(&track);
    Candidate {
        track: Recording { title: track.title, artist, duration: track.duration_seconds, isrc: None },
        source: "yandex".into(),
        id: track.id,
        format: None,
        bitrate: None,
        cover_url: thumbnail_url(track.cover_uri.as_deref()),
        album: track.album.map(|album| album.title),
        restricted: !track.available,
    }
}
