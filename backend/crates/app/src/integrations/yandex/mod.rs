// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

pub mod client;
pub mod importer;
pub mod imports;

use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use sqlx::PgPool;
use uuid::Uuid;

use self::client::{YandexClient, thumbnail_url};
use self::imports::{ImportDto, ImportKind, ImportQueue};
use crate::i18n::Lang;
use crate::upload::{self, ProbeVerdict};
use crate::{AppError, AppResult};

const TOKEN_MAX_LENGTH: usize = 512;

#[derive(Debug, Serialize)]
pub struct SearchDto {
    pub tracks: Vec<TrackDto>,
    pub albums: Vec<AlbumDto>,
}

#[skip_serializing_none]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackDto {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub cover_url: Option<String>,
    pub duration_seconds: i32,
    pub available: bool,
    pub in_library: bool,
}

#[skip_serializing_none]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumDto {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub year: Option<i32>,
    pub track_count: Option<i32>,
    pub cover_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct StartImportRequest {
    pub kind: ImportKind,
    pub id: Option<String>,
}

#[derive(Clone)]
pub struct YandexMusic {
    pub db: PgPool,
    pub client: YandexClient,
    pub queue: ImportQueue,
}

impl YandexMusic {
    pub async fn search(&self, token: Option<&str>, text: Option<&str>) -> AppResult<SearchDto> {
        let token = require_token(token)?;
        let Some(text) = text.map(str::trim).filter(|t| !t.is_empty()) else {
            return Ok(SearchDto { tracks: vec![], albums: vec![] });
        };
        let (tracks, albums) = self.client.search(token, text).await?;

        let verdicts = if tracks.is_empty() {
            vec![]
        } else {
            upload::probe(&self.db, Uuid::nil(), tracks.iter().map(importer::probe_file).collect()).await?.files
        };

        let tracks = tracks
            .into_iter()
            .enumerate()
            .map(|(index, track)| TrackDto {
                artist: importer::artist(&track),
                album: track.album.as_ref().map(|a| a.title.clone()),
                cover_url: thumbnail_url(
                    track.album.as_ref().and_then(|a| a.cover_uri.as_deref()).or(track.cover_uri.as_deref()),
                ),
                in_library: verdicts.get(index).is_some_and(|v| v.verdict == ProbeVerdict::Duplicate),
                duration_seconds: track.duration_seconds,
                available: track.available,
                id: track.id,
                title: track.title,
            })
            .collect();
        let albums = albums
            .into_iter()
            .map(|album| AlbumDto {
                artist: if album.artists.is_empty() { "Unknown Artist".to_owned() } else { album.artists.join(", ") },
                cover_url: thumbnail_url(album.cover_uri.as_deref()),
                year: album.year,
                track_count: album.track_count,
                id: album.id,
                title: album.title,
            })
            .collect();
        Ok(SearchDto { tracks, albums })
    }

    pub fn start(&self, token: Option<&str>, request: StartImportRequest, lang: Lang) -> AppResult<ImportDto> {
        let token = require_token(token)?;
        let source = match request.kind {
            ImportKind::Likes => None,
            ImportKind::Album | ImportKind::Track => {
                let id = request.id.as_deref().map(str::trim).filter(|id| !id.is_empty());
                match id {
                    Some(id) if id.chars().all(|c| c.is_ascii_digit()) => Some(id.to_owned()),
                    _ => return Err(AppError::validation("Unknown import source.")),
                }
            }
        };
        self.queue.enqueue(request.kind, source, token.to_owned(), lang)
    }

    pub fn list(&self) -> Vec<ImportDto> {
        self.queue.list()
    }

    pub fn remove(&self, id: Uuid) -> AppResult<()> {
        if self.queue.remove(id) { Ok(()) } else { Err(AppError::not_found("Import not found.")) }
    }
}

fn require_token(token: Option<&str>) -> AppResult<&str> {
    match token.map(str::trim).filter(|t| !t.is_empty()) {
        None => Err(AppError::validation("Add a Yandex Music token in the settings first.")),
        Some(token) if token.chars().count() > TOKEN_MAX_LENGTH => {
            Err(AppError::validation("The Yandex Music token is too long."))
        }
        Some(token) => Ok(token),
    }
}
