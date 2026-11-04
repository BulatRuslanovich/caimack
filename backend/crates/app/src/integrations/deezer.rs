// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::time::Duration;

use serde::Deserialize;

use super::{http_client, read_limited};
use crate::covers::MAX_IMAGE_BYTES;
use crate::text::normalize_key;

const SEARCH_TIMEOUT: Duration = Duration::from_secs(15);
const IMAGE_TIMEOUT: Duration = Duration::from_secs(20);

const MISSING_PICTURE_MARKER: &str = "/images/artist//";

#[derive(Clone)]
pub struct Deezer {
    base_url: String,
    search: reqwest::Client,
    images: reqwest::Client,
}

#[derive(Deserialize)]
struct SearchResponse<T> {
    data: Option<Vec<T>>,
    error: Option<SearchError>,
}

#[derive(Deserialize)]
struct SearchError {
    message: Option<String>,
}

#[derive(Deserialize)]
struct ArtistResult {
    name: Option<String>,
    picture_xl: Option<String>,
}

#[derive(Deserialize)]
struct TrackResult {
    title: String,
    artist: ArtistResult,
    album: AlbumResult,
}

#[derive(Deserialize)]
struct AlbumResult {
    title: String,
    cover_xl: Option<String>,
}

pub struct TrackCover {
    pub album_title: String,
    pub bytes: Vec<u8>,
}

fn matching_album(tracks: Vec<TrackResult>, title: &str, artist: &str, album: Option<&str>) -> Option<AlbumResult> {
    let title = normalize_key(title);
    let artist = normalize_key(artist);
    let album = album.map(normalize_key);
    tracks.into_iter().find_map(|track| {
        (normalize_key(&track.title) == title
            && track.artist.name.as_deref().is_some_and(|name| normalize_key(name) == artist)
            && album.as_ref().is_none_or(|album| normalize_key(&track.album.title) == *album)
            && !track.album.title.trim().is_empty()
            && track.album.cover_xl.as_deref().is_some_and(|url| !url.is_empty() && !url.contains("/images/cover//")))
        .then_some(track.album)
    })
}

impl Deezer {
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_owned(),
            search: http_client(SEARCH_TIMEOUT),
            images: http_client(IMAGE_TIMEOUT),
        }
    }

    pub async fn artist_image(&self, artist_name: &str) -> anyhow::Result<Option<Vec<u8>>> {
        let response: SearchResponse<ArtistResult> = self
            .search
            .get(format!("{}/search/artist", self.base_url))
            .query(&[("q", artist_name)])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        if let Some(error) = response.error {
            anyhow::bail!("Deezer refused the search: {}", error.message.unwrap_or_default());
        }

        let key = normalize_key(artist_name);
        let url = response
            .data
            .unwrap_or_default()
            .into_iter()
            .find(|artist| artist.name.as_deref().is_some_and(|name| normalize_key(name) == key))
            .and_then(|artist| artist.picture_xl)
            .filter(|url| !url.contains(MISSING_PICTURE_MARKER));
        let Some(url) = url else { return Ok(None) };

        let image = self.images.get(url).send().await?.error_for_status()?;
        let max = usize::try_from(MAX_IMAGE_BYTES).unwrap_or(usize::MAX);
        Ok(Some(read_limited(image, max).await?))
    }

    pub async fn track_cover(
        &self,
        title: &str,
        artist: &str,
        album: Option<&str>,
    ) -> anyhow::Result<Option<TrackCover>> {
        let response: SearchResponse<TrackResult> = self
            .search
            .get(format!("{}/search/track", self.base_url))
            .query(&[("q", format!("{artist} {title}"))])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        if let Some(error) = response.error {
            anyhow::bail!("Deezer refused the search: {}", error.message.unwrap_or_default());
        }
        let Some(album) = matching_album(response.data.unwrap_or_default(), title, artist, album) else {
            return Ok(None);
        };
        let Some(url) = album.cover_xl else { return Ok(None) };
        let image = self.images.get(url).send().await?.error_for_status()?;
        let max = usize::try_from(MAX_IMAGE_BYTES).unwrap_or(usize::MAX);
        Ok(Some(TrackCover { album_title: album.title, bytes: read_limited(image, max).await? }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(title: &str, artist: &str, album: &str, url: Option<&str>) -> TrackResult {
        TrackResult {
            title: title.into(),
            artist: ArtistResult { name: Some(artist.into()), picture_xl: None },
            album: AlbumResult { title: album.into(), cover_xl: url.map(str::to_owned) },
        }
    }

    #[test]
    fn cover_search_skips_wrong_artists_versions_and_albums() {
        let found = matching_album(
            vec![
                candidate("Song", "Other", "Album", Some("wrong-artist")),
                candidate("Song (Live)", "Band", "Album", Some("wrong-version")),
                candidate("Song", "Band", "Compilation", Some("wrong-album")),
                candidate("Song", "Band", "Album", Some("correct")),
            ],
            " song ",
            "BAND",
            Some("Album"),
        );
        assert_eq!(found.and_then(|album| album.cover_xl).as_deref(), Some("correct"));
    }

    #[test]
    fn cover_search_can_discover_an_album() {
        let found = matching_album(vec![candidate("Song", "Band", "Album", Some("cover"))], "Song", "Band", None);
        assert_eq!(found.map(|album| album.title).as_deref(), Some("Album"));
    }

    #[test]
    fn cover_search_rejects_missing_and_placeholder_images() {
        let found = matching_album(
            vec![
                candidate("Song", "Band", "Album", None),
                candidate("Song", "Band", "Album", Some("")),
                candidate("Song", "Band", "Album", Some("https://cdn/images/cover//1000.jpg")),
            ],
            "Song",
            "Band",
            None,
        );
        assert!(found.is_none());
    }

    #[tokio::test]
    #[ignore = "talks to the real Deezer"]
    async fn finds_a_well_known_artist() -> anyhow::Result<()> {
        let image = Deezer::new("https://api.deezer.com").artist_image("Daft Punk").await?;
        assert!(image.is_some_and(|bytes| bytes.len() > 10_000));
        Ok(())
    }
}
