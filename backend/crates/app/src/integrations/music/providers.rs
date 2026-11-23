// SPDX-License-Identifier: AGPL-3.0-only

use std::sync::Arc;
use std::time::Duration;

use futures_util::future::BoxFuture;
use reqwest::Url;
use serde::Serialize;
use uuid::Uuid;

use super::audio::Audio;
use super::browser::Browser;
use super::transport::Transport;
use super::{Candidate, Music, PlaylistSnapshot, SearchKind, SearchResults};
use crate::integrations::yandex::YandexMusic;
use crate::{AppError, AppResult};

#[derive(Clone, Copy, Default, Serialize)]
pub(super) struct Capabilities {
    pub tracks: bool,
    pub albums: bool,
    pub playlist: bool,
    pub audio: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceStatus {
    Ready,
    NeedsToken,
    NeedsBrowser,
    MissingExtractor,
}

impl SourceStatus {
    pub(super) fn needs_connection(self) -> bool {
        !matches!(self, Self::Ready | Self::MissingExtractor)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    id: &'static str,
    name: &'static str,
    capabilities: Capabilities,
    status: SourceStatus,
    audio_status: SourceStatus,
}

pub(super) trait MusicProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    fn capabilities(&self) -> Capabilities;
    fn status(&self, _user: Uuid) -> SourceStatus {
        SourceStatus::Ready
    }

    fn audio_status(&self, user: Uuid) -> SourceStatus {
        self.status(user)
    }

    fn set_token(&self, _user: Uuid, _token: Option<&str>) {}

    fn parse_link(&self, _url: &Url) -> Option<String> {
        None
    }
    fn is_album_link(&self, _id: &str) -> bool {
        false
    }

    fn search<'a>(&'a self, _user: Uuid, _query: &'a str, _albums: bool) -> BoxFuture<'a, AppResult<SearchResults>> {
        Box::pin(async { Err(unsupported()) })
    }

    fn playlist<'a>(&'a self, _user: Uuid, _id: &'a str) -> BoxFuture<'a, AppResult<PlaylistSnapshot>> {
        Box::pin(async { Err(unsupported()) })
    }

    fn stage<'a>(
        &'a self,
        _user: Uuid,
        _candidate: &'a Candidate,
        _query: &'a str,
        _playlist_id: Option<&'a str>,
    ) -> BoxFuture<'a, AppResult<Audio>> {
        Box::pin(async { Err(unsupported()) })
    }
}

fn unsupported() -> AppError {
    AppError::validation("This operation is unavailable for the music source.")
}

pub(super) struct PlaylistLink<'a> {
    pub provider: &'a dyn MusicProvider,
    pub id: String,
}

pub(super) struct ProviderContext {
    pub transport: Transport,
    pub browser: Arc<Browser>,
    pub yandex: YandexMusic,
}

include!(concat!(env!("OUT_DIR"), "/music_providers.rs"));

pub(super) fn registry(context: &ProviderContext) -> AppResult<Arc<[Arc<dyn MusicProvider>]>> {
    let mut providers = discover(context);
    providers.sort_unstable_by_key(|provider| provider.id());
    if let Some(duplicate) = providers.windows(2).find(|pair| pair[0].id() == pair[1].id()) {
        return Err(AppError::internal(anyhow::anyhow!("Duplicate music provider ID: {}", duplicate[0].id())));
    }
    Ok(providers.into())
}

fn describe(provider: &dyn MusicProvider, user: Uuid) -> Source {
    Source {
        id: provider.id(),
        name: provider.name(),
        capabilities: provider.capabilities(),
        status: provider.status(user),
        audio_status: provider.audio_status(user),
    }
}

impl Music {
    pub(super) fn provider(&self, source: &str) -> Option<&dyn MusicProvider> {
        self.providers.iter().find(|provider| provider.id() == source).map(Arc::as_ref)
    }

    pub fn source_catalog(&self, user: Uuid) -> Vec<Source> {
        self.providers.iter().map(|provider| describe(provider.as_ref(), user)).collect()
    }

    pub(super) fn sources(&self) -> Vec<&'static str> {
        self.providers.iter().filter(|provider| provider.capabilities().audio).map(|provider| provider.id()).collect()
    }

    pub fn search_sources(&self, user: Uuid, requested: &[String], kind: SearchKind) -> Vec<&'static str> {
        self.providers
            .iter()
            .filter(|provider| {
                let capabilities = provider.capabilities();
                match kind {
                    SearchKind::All => capabilities.tracks || capabilities.albums,
                    SearchKind::Tracks => capabilities.tracks,
                    SearchKind::Albums => capabilities.albums,
                }
            })
            .filter(|provider| provider.status(user) == SourceStatus::Ready)
            .filter(|provider| requested.iter().any(|id| id == provider.id()))
            .map(|provider| provider.id())
            .collect()
    }

    pub async fn search(&self, user: Uuid, source: &str, query: &str, albums: bool) -> AppResult<SearchResults> {
        let provider = self.provider(source).ok_or_else(unsupported)?;
        if !(2..=200).contains(&query.chars().count()) {
            return Err(AppError::validation("Enter a search between 2 and 200 characters."));
        }
        let lookup = super::model::provider_query(query);
        let mut found = provider.search(user, &lookup, albums).await?;
        found.tracks.retain(|candidate| {
            candidate.source == source
                && !candidate.id.is_empty()
                && candidate.id.len() <= 500
                && !candidate.track.artist.trim().is_empty()
                && !candidate.track.title.trim().is_empty()
        });
        found.tracks.truncate(50);
        found.albums.truncate(30);
        Ok(found)
    }

    pub(super) fn playlist_link(&self, input: &str) -> AppResult<PlaylistLink<'_>> {
        let invalid = || AppError::validation("Enter a playlist link from a supported music source.");
        let url = Url::parse(input.trim()).map_err(|_| invalid())?;
        if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() || url.port().is_some() {
            return Err(invalid());
        }
        self.providers
            .iter()
            .find_map(|provider| provider.parse_link(&url).map(|id| PlaylistLink { provider: provider.as_ref(), id }))
            .ok_or_else(invalid)
    }

    pub fn playlist_source(&self, user: Uuid, url: &str) -> AppResult<Source> {
        let link = self.playlist_link(url)?;
        Ok(describe(link.provider, user))
    }

    pub async fn preview_playlist(&self, user: Uuid, url: &str) -> AppResult<(Uuid, PlaylistSnapshot)> {
        let link = self.playlist_link(url)?;
        let snapshot = link.provider.playlist(user, &link.id).await?;
        if snapshot.tracks.len() > super::jobs::MAX_PLAYLIST_ITEMS {
            return Err(AppError::validation("The playlist exceeds the import size limit."));
        }
        let id = Uuid::now_v7();
        let mut previews = self.previews.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        previews.retain(|_, preview| preview.read_at.elapsed() < Duration::from_secs(900));
        previews.insert(
            user,
            super::Preview { id, read_at: std::time::Instant::now(), url: url.into(), snapshot: snapshot.clone() },
        );
        Ok((id, snapshot))
    }

    pub(super) fn read_preview(&self, user: Uuid, id: Uuid, url: &str) -> AppResult<PlaylistSnapshot> {
        let previews = self.previews.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        previews
            .get(&user)
            .filter(|preview| {
                preview.id == id && preview.url == url && preview.read_at.elapsed() < Duration::from_secs(900)
            })
            .map(|preview| preview.snapshot.clone())
            .ok_or_else(|| AppError::validation("Read the playlist again before starting the import."))
    }

    pub(super) async fn stage(
        &self,
        user: Uuid,
        candidate: &Candidate,
        query: &str,
        playlist_url: Option<&str>,
    ) -> AppResult<Audio> {
        let provider = self
            .provider(&candidate.source)
            .filter(|provider| provider.capabilities().audio)
            .ok_or_else(unsupported)?;
        let native = playlist_url
            .and_then(|url| self.playlist_link(url).ok())
            .filter(|link| link.provider.id() == provider.id());
        let lookup = super::model::provider_query(query);
        provider.stage(user, candidate, &lookup, native.as_ref().map(|link| link.id.as_str())).await
    }
}
