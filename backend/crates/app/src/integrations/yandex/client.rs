// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD_NO_PAD;
use hmac::{Hmac, KeyInit, Mac};
use serde_json::Value;
use sha2::Sha256;
use tokio::io::AsyncWriteExt;

use crate::config::YandexMusicConfig;
use crate::integrations::{http_client, read_limited};
use crate::{AppError, AppResult};

const API_TIMEOUT: Duration = Duration::from_secs(20);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(300);
const TRACKS_PER_REQUEST: usize = 100;
const COVER_SIZE: &str = "1000x1000";
const THUMBNAIL_SIZE: &str = "200x200";
const MAX_COVER_BYTES: usize = 8 * 1024 * 1024;
const MAX_LYRICS_BYTES: usize = 256 * 1024;
const LYRICS_TIMEOUT: Duration = Duration::from_secs(15);
// The signing key and client header must be a matching pair. Lyrics use the desktop
// signature independently of the configured web audio download signature.
const LYRICS_SIGN_KEY: &str = "kzqU4XhfCaY6B6JTHODeq5";
const LYRICS_CLIENT: &str = "YandexMusicDesktopAppWindows/5.95.0";

const TRANSPORT: &str = "raw";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct YandexAlbum {
    pub id: String,
    pub title: String,
    pub artists: Vec<String>,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub cover_uri: Option<String>,
    pub track_count: Option<i32>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct YandexTrack {
    pub id: String,
    pub title: String,
    pub artists: Vec<String>,
    pub album: Option<YandexAlbum>,
    pub cover_uri: Option<String>,
    pub duration_seconds: i32,

    pub available: bool,
}

pub struct FileInfo {
    pub url: String,
    pub codec: String,
}

#[derive(Clone)]
pub struct YandexClient {
    config: YandexMusicConfig,
    api: reqwest::Client,
    downloads: reqwest::Client,
    images: reqwest::Client,
}

impl YandexClient {
    pub fn new(config: YandexMusicConfig) -> Self {
        Self {
            config,
            api: http_client(API_TIMEOUT),
            downloads: http_client(DOWNLOAD_TIMEOUT),
            images: http_client(Duration::from_secs(12)),
        }
    }

    pub async fn search(&self, token: &str, text: &str) -> AppResult<(Vec<YandexTrack>, Vec<YandexAlbum>)> {
        let result = self
            .get(token, "/search", &[("text", text), ("type", "all"), ("page", "0"), ("nocorrect", "false")])
            .await?;
        let section = |name: &str| -> Vec<Value> {
            result
                .get(name)
                .and_then(|block| block.get("results"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
        };
        Ok((section("tracks").iter().map(read_track).collect(), section("albums").iter().map(read_album).collect()))
    }

    pub async fn liked_track_ids(&self, token: &str) -> AppResult<Vec<String>> {
        let status = self.get(token, "/account/status", &[]).await?;
        let uid = text(status.get("account").unwrap_or(&Value::Null), "uid")
            .ok_or_else(|| AppError::validation("Yandex Music rejected the token."))?;
        let likes = self.get(token, &format!("/users/{uid}/likes/tracks"), &[]).await?;
        let tracks = likes.get("library").and_then(|l| l.get("tracks")).and_then(Value::as_array);
        Ok(tracks.map(|tracks| tracks.iter().filter_map(|t| text(t, "id")).collect()).unwrap_or_default())
    }

    pub async fn tracks(&self, token: &str, ids: &[String]) -> AppResult<Vec<YandexTrack>> {
        let mut tracks = Vec::with_capacity(ids.len());
        for chunk in ids.chunks(TRACKS_PER_REQUEST) {
            let form = [("track-ids", chunk.join(",")), ("with-positions", "true".to_owned())];
            let request = self.api.post(self.url("/tracks")).form(&form);
            let result = self.send(token, request).await?;
            if let Some(items) = result.as_array() {
                tracks.extend(items.iter().map(read_track));
            }
        }
        Ok(tracks)
    }

    pub async fn album(&self, token: &str, album_id: &str) -> AppResult<(YandexAlbum, Vec<YandexTrack>)> {
        let result = self.get(token, &format!("/albums/{album_id}/with-tracks"), &[]).await?;

        let tracks = result
            .get("volumes")
            .and_then(Value::as_array)
            .map(|volumes| volumes.iter().filter_map(Value::as_array).flatten().map(read_track).collect())
            .unwrap_or_default();
        Ok((read_album(&result), tracks))
    }

    pub async fn file_info(
        &self,
        token: &str,
        track_id: &str,
        quality: &str,
        codecs: &[&str],
    ) -> AppResult<Option<FileInfo>> {
        let timestamp = chrono::Utc::now().timestamp().to_string();
        let sign =
            sign(&self.config.sign_key, &format!("{timestamp}{track_id}{quality}{}{TRANSPORT}", codecs.concat()));
        let codecs = codecs.join(",");
        let parameters = [
            ("ts", timestamp.as_str()),
            ("trackId", track_id),
            ("quality", quality),
            ("codecs", codecs.as_str()),
            ("transports", TRANSPORT),
            ("sign", sign.as_str()),
        ];

        let result = match self.get(token, "/get-file-info", &parameters).await {
            Ok(result) => result,

            Err(AppError::Validation(_)) if quality != "hq" => return Ok(None),
            Err(error) => return Err(error),
        };

        let info = result.get("downloadInfo").unwrap_or(&Value::Null);
        let url = text(info, "url").or_else(|| {
            info.get("urls")
                .and_then(Value::as_array)
                .and_then(|urls| urls.iter().filter_map(Value::as_str).find(|u| !u.is_empty()).map(str::to_owned))
        });
        let codec = text(info, "codec");
        let transport = text(info, "transport").unwrap_or_else(|| TRANSPORT.to_owned());
        Ok(match (url, codec) {
            (Some(url), Some(codec)) if transport == TRANSPORT => Some(FileInfo { url, codec }),
            _ => None,
        })
    }

    pub async fn download(&self, url: &str, target: &Path) -> AppResult<()> {
        let mut response = self.downloads.get(url).send().await.map_err(AppError::internal)?;
        if !response.status().is_success() {
            return Err(AppError::validation("Yandex Music did not answer ({0}).").arg(response.status().as_u16()));
        }
        let mut file = tokio::fs::File::create(target).await.map_err(AppError::internal)?;
        while let Some(chunk) = response.chunk().await.map_err(AppError::internal)? {
            file.write_all(&chunk).await.map_err(AppError::internal)?;
        }
        file.flush().await.map_err(AppError::internal)?;
        Ok(())
    }

    pub async fn cover(&self, cover_uri: Option<&str>) -> Option<Vec<u8>> {
        let url = cover_url(cover_uri, COVER_SIZE)?;
        let result = async {
            let response = self.images.get(url).send().await?.error_for_status()?;
            read_limited(response, MAX_COVER_BYTES).await
        }
        .await;
        match result {
            Ok(bytes) => Some(bytes),
            Err(error) => {
                tracing::warn!("Yandex cover download failed; background enrichment will retry: {error:#}");
                None
            }
        }
    }

    pub async fn lyrics(&self, token: &str, track_id: &str) -> Option<String> {
        let track_id = track_id.split_once(':').map_or(track_id, |(id, _)| id);
        let lookup = async {
            for format in ["LRC", "TEXT"] {
                match self.lyrics_format(token, track_id, format).await {
                    Ok(Some(text)) => return Some(text),
                    Ok(None) => {}
                    Err(error) => tracing::warn!(track_id, format, "Yandex lyrics unavailable: {error}"),
                }
            }
            None
        };
        match tokio::time::timeout(LYRICS_TIMEOUT, lookup).await {
            Ok(lyrics) => lyrics,
            Err(_) => {
                tracing::warn!(track_id, "Yandex lyrics timed out; importing the audio without them");
                None
            }
        }
    }

    async fn lyrics_format(&self, token: &str, track_id: &str, format: &str) -> AppResult<Option<String>> {
        let timestamp = chrono::Utc::now().timestamp().to_string();
        // SHA-256 always needs one '=' in padded Base64, unlike the file-info endpoint.
        let signature = format!("{}=", sign(LYRICS_SIGN_KEY, &format!("{track_id}{timestamp}")));
        let request = self.api.get(self.url(&format!("/tracks/{track_id}/lyrics"))).query(&[
            ("format", format),
            ("timeStamp", timestamp.as_str()),
            ("sign", signature.as_str()),
        ]);
        let response = Self::authorized(token, request, LYRICS_CLIENT)
            .send()
            .await
            .map_err(|e| AppError::internal(e.without_url()))?;
        if matches!(response.status(), reqwest::StatusCode::NOT_FOUND | reqwest::StatusCode::NO_CONTENT) {
            return Ok(None);
        }
        let root: Value = response
            .error_for_status()
            .map_err(|e| AppError::internal(e.without_url()))?
            .json()
            .await
            .map_err(AppError::internal)?;
        let result = root.get("result").unwrap_or(&root);
        let Some(url) = text(result, "downloadUrl") else { return Ok(None) };
        // The OAuth header belongs only to the API, never to the signed lyrics download URL.
        let response = self
            .images
            .get(url)
            .send()
            .await
            .map_err(|e| AppError::internal(e.without_url()))?
            .error_for_status()
            .map_err(|e| AppError::internal(e.without_url()))?;
        let body = read_limited(response, MAX_LYRICS_BYTES).await.map_err(AppError::internal)?;
        let body = String::from_utf8(body).map_err(AppError::internal)?;
        let body = body.trim_start_matches('\u{feff}').trim();
        Ok((!crate::catalog::lyrics::parse(Some(body)).is_empty()).then(|| body.to_owned()))
    }

    pub async fn genre_titles(&self, token: &str) -> AppResult<HashMap<String, String>> {
        fn collect(genres: &[Value], titles: &mut HashMap<String, String>) {
            for genre in genres {
                if let (Some(id), Some(title)) = (text(genre, "id"), text(genre, "title")) {
                    titles.entry(id).or_insert(title);
                }
                if let Some(sub) = genre.get("subGenres").and_then(Value::as_array) {
                    collect(sub, titles);
                }
            }
        }
        let mut titles = HashMap::new();
        if let Some(genres) = self.get(token, "/genres", &[]).await?.as_array() {
            collect(genres, &mut titles);
        }
        Ok(titles)
    }

    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.config.base_url.trim_end_matches('/'))
    }

    async fn get(&self, token: &str, path: &str, query: &[(&str, &str)]) -> AppResult<Value> {
        self.send(token, self.api.get(self.url(path)).query(query)).await
    }

    async fn send(&self, token: &str, request: reqwest::RequestBuilder) -> AppResult<Value> {
        let response =
            Self::authorized(token, request, &self.config.client).send().await.map_err(AppError::internal)?;

        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(AppError::validation("Yandex Music rejected the token."));
        }
        if !status.is_success() {
            return Err(AppError::validation("Yandex Music did not answer ({0}).").arg(status.as_u16()));
        }

        let mut root: Value = response.json().await.map_err(AppError::internal)?;
        Ok(match root.get_mut("result") {
            Some(result) => result.take(),
            None => root,
        })
    }

    fn authorized(token: &str, request: reqwest::RequestBuilder, client: &str) -> reqwest::RequestBuilder {
        request
            .header("Authorization", format!("OAuth {token}"))
            .header("X-Yandex-Music-Client", client)
            .header("X-Yandex-Music-Without-Invocation-Info", "1")
    }
}

pub fn sign(key: &str, payload: &str) -> String {
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(key.as_bytes()) else { return String::new() };
    mac.update(payload.as_bytes());
    STANDARD_NO_PAD.encode(mac.finalize().into_bytes())
}

fn cover_url(cover_uri: Option<&str>, size: &str) -> Option<String> {
    let uri = cover_uri?.trim();
    let url = reqwest::Url::parse(&format!("https://{}", uri.replace("%%", size))).ok()?;
    (matches!(url.host_str(), Some("avatars.yandex.net" | "avatars.mds.yandex.net"))
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none())
    .then(|| url.to_string())
}

pub fn thumbnail_url(cover_uri: Option<&str>) -> Option<String> {
    cover_url(cover_uri, THUMBNAIL_SIZE)
}

fn text(element: &Value, name: &str) -> Option<String> {
    let value = element.get(name)?;
    let text = match value {
        Value::String(text) => text.trim().to_owned(),
        Value::Number(number) => number.to_string(),
        _ => return None,
    };
    (!text.is_empty()).then_some(text)
}

fn number(element: &Value, name: &str) -> Option<i32> {
    text(element, name)?.parse().ok().filter(|&value| value > 0)
}

fn names(owner: &Value) -> Vec<String> {
    owner
        .get("artists")
        .and_then(Value::as_array)
        .map(|artists| artists.iter().filter_map(|a| text(a, "name")).collect())
        .unwrap_or_default()
}

fn with_version(title: String, version: Option<String>) -> String {
    match version {
        Some(version) if !title.to_lowercase().contains(&version.to_lowercase()) => {
            format!("{title} ({})", version.trim())
        }
        _ => title,
    }
}

fn read_album(album: &Value) -> YandexAlbum {
    let position = album.get("trackPosition").unwrap_or(&Value::Null);
    YandexAlbum {
        id: text(album, "id").unwrap_or_default(),
        title: with_version(text(album, "title").unwrap_or_default(), text(album, "version")),
        artists: names(album),
        year: number(album, "year"),
        genre: text(album, "genre"),
        cover_uri: text(album, "coverUri"),
        track_count: number(album, "trackCount"),
        track_number: number(position, "index"),
        disc_number: number(position, "volume"),
    }
}

fn read_track(track: &Value) -> YandexTrack {
    let album = track.get("albums").and_then(Value::as_array).and_then(|albums| albums.first()).map(read_album);
    let duration_ms = track.get("durationMs").and_then(Value::as_i64);
    YandexTrack {
        id: text(track, "id").unwrap_or_default(),
        title: with_version(text(track, "title").unwrap_or_default(), text(track, "version")),
        artists: names(track),
        cover_uri: text(track, "coverUri").or_else(|| album.as_ref().and_then(|a| a.cover_uri.clone())),
        album,
        #[expect(clippy::cast_possible_truncation, reason = "track lengths fit in i32 seconds")]
        duration_seconds: duration_ms.map_or(0, |ms| (ms as f64 / 1000.0).round_ties_even() as i32),
        available: track.get("available") != Some(&Value::Bool(false)),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use tokio::io::AsyncReadExt;
    use tokio::net::TcpListener;

    use super::*;

    async fn lyrics_server(
        replies: Vec<(&'static str, &'static str, &'static str)>,
    ) -> (YandexClient, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let client = YandexClient::new(YandexMusicConfig {
            base_url: base_url.clone(),
            client: "Caimack-Test".into(),
            sign_key: "audio-key".into(),
        });
        let server = tokio::spawn(async move {
            for (expected, status, body) in replies {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                let mut buffer = [0; 1024];
                while !request.ends_with(b"\r\n\r\n") {
                    let length = socket.read(&mut buffer).await.unwrap();
                    assert_ne!(length, 0);
                    request.extend_from_slice(&buffer[..length]);
                }
                let request = String::from_utf8(request).unwrap();
                let path = request.lines().next().unwrap().split_whitespace().nth(1).unwrap();
                assert!(path.starts_with(expected), "expected {expected}, got {path}");
                if path.starts_with("/tracks/") {
                    assert!(request.to_ascii_lowercase().contains("authorization: oauth test-token\r\n"));
                    assert_eq!(request.to_ascii_lowercase().matches("x-yandex-music-client:").count(), 1);
                    assert!(
                        request
                            .to_ascii_lowercase()
                            .contains("x-yandex-music-client: yandexmusicdesktopappwindows/5.95.0\r\n")
                    );
                    let url = reqwest::Url::parse(&format!("{base_url}{path}")).unwrap();
                    let parameters: HashMap<_, _> = url.query_pairs().collect();
                    let timestamp = parameters.get("timeStamp").unwrap();
                    let signature = format!("{}=", sign("kzqU4XhfCaY6B6JTHODeq5", &format!("42{timestamp}")));
                    assert_eq!(parameters.get("sign").unwrap().as_ref(), signature);
                } else {
                    assert!(
                        !request.to_ascii_lowercase().contains("authorization:"),
                        "OAuth must not reach the lyrics CDN"
                    );
                }
                let body = body.replace("{url}", &base_url);
                let response =
                    format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                socket.write_all(response.as_bytes()).await.unwrap();
            }
        });
        (client, server)
    }

    #[tokio::test]
    async fn synced_lyrics_keep_their_timestamps_and_do_not_request_plain_text() {
        let (client, server) = lyrics_server(vec![
            ("/tracks/42/lyrics?format=LRC", "200 OK", r#"{"result":{"downloadUrl":"{url}/synced"}}"#),
            ("/synced", "200 OK", "\u{feff}[00:01.250]First\n[00:11.000]Second"),
        ])
        .await;
        let text = client.lyrics("test-token", "42:7").await.unwrap();
        let parsed = crate::catalog::lyrics::parse(Some(&text));
        assert_eq!(parsed.lines.iter().map(|line| line.at).collect::<Vec<_>>(), [1250, 11000]);
        server.await.unwrap();
    }

    #[tokio::test]
    async fn missing_lrc_falls_back_to_plain_text() {
        let (client, server) = lyrics_server(vec![
            ("/tracks/42/lyrics?format=LRC", "404 Not Found", "{}"),
            ("/tracks/42/lyrics?format=TEXT", "200 OK", r#"{"result":{"downloadUrl":"{url}/plain"}}"#),
            ("/plain", "200 OK", "First line\nSecond line"),
        ])
        .await;
        assert_eq!(client.lyrics("test-token", "42").await.as_deref(), Some("First line\nSecond line"));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn empty_synced_text_does_not_hide_available_plain_lyrics() {
        let (client, server) = lyrics_server(vec![
            ("/tracks/42/lyrics?format=LRC", "200 OK", r#"{"result":{"downloadUrl":"{url}/synced"}}"#),
            ("/synced", "200 OK", "[ar:Artist]\n[ti:Title]\n"),
            ("/tracks/42/lyrics?format=TEXT", "200 OK", r#"{"result":{"downloadUrl":"{url}/plain"}}"#),
            ("/plain", "200 OK", "Lyrics"),
        ])
        .await;
        assert_eq!(client.lyrics("test-token", "42").await.as_deref(), Some("Lyrics"));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn tracks_without_lyrics_can_still_be_imported() {
        let (client, server) = lyrics_server(vec![
            ("/tracks/42/lyrics?format=LRC", "404 Not Found", "{}"),
            ("/tracks/42/lyrics?format=TEXT", "200 OK", r#"{"result":null}"#),
        ])
        .await;
        assert!(client.lyrics("test-token", "42").await.is_none());
        server.await.unwrap();
    }

    #[tokio::test]
    async fn a_failed_lyrics_download_is_optional() {
        let (client, server) = lyrics_server(vec![
            ("/tracks/42/lyrics?format=LRC", "200 OK", r#"{"result":{"downloadUrl":"{url}/synced"}}"#),
            ("/synced", "503 Service Unavailable", "unavailable"),
            ("/tracks/42/lyrics?format=TEXT", "404 Not Found", "{}"),
        ])
        .await;
        assert!(client.lyrics("test-token", "42").await.is_none());
        server.await.unwrap();
    }

    #[test]
    fn artwork_uses_only_the_csp_allowed_yandex_hosts() {
        assert_eq!(
            thumbnail_url(Some("avatars.yandex.net/music/%%")),
            Some("https://avatars.yandex.net/music/200x200".into())
        );
        assert!(thumbnail_url(Some("avatars.mds.yandex.net/music/%%")).is_some());
        for uri in [
            "example.com/%%",
            "avatars.yandex.net.evil.test/x",
            "evil@avatars.yandex.net/x",
            "avatars.yandex.net:8443/x",
            "",
        ] {
            assert_eq!(thumbnail_url(Some(uri)), None);
        }
    }

    #[test]
    fn the_file_link_is_signed_like_the_web_client() {
        assert_eq!(
            sign("7tvSmFbyf5hJnIHhCimDDD", "176150000012345losslessflac-mp4mp3raw"),
            "ogHUl0+hxgeA/1o8u1Bsyqs8CAI+LGy7yBgBXUD1po0"
        );
    }

    #[test]
    fn tracks_read_ids_as_text_and_version_into_the_title() {
        let track = read_track(&json!({
            "id": 12345, "title": "Song", "version": "Live", "durationMs": 201_500, "available": false,
            "artists": [{ "name": "Band" }], "albums": [{ "id": 7, "title": "Album", "year": 2020, "genre": "rock",
            "coverUri": "avatars/%%", "trackPosition": { "index": 3, "volume": 1 } }]
        }));
        assert_eq!(
            (track.id.as_str(), track.title.as_str(), track.duration_seconds, track.available),
            ("12345", "Song (Live)", 202, false)
        );
        assert_eq!(track.album.map(|a| (a.track_number, a.disc_number)), Some((Some(3), Some(1))));
        assert_eq!(track.cover_uri.as_deref(), Some("avatars/%%"));
    }
}
