// SPDX-License-Identifier: AGPL-3.0-only

pub(super) mod extractor;
pub(super) mod html;

use std::path::{Path, PathBuf};
#[cfg(test)]
use std::sync::Arc;
use std::time::Duration;

use std::future::Future;

use media::formats::{FLAC, MP3};
use moka::sync::Cache;
use reqwest::{Client, Response, Url};
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::audio::{Audio, Scratch, stream_to};
use super::{Candidate, Recording, SearchResults};
use crate::config::MusicSourcesConfig;
use crate::integrations::read_limited;
use crate::{AppError, AppResult};

pub(super) const MAX_RESULTS: usize = 40;
pub(super) const MAX_TEXT: usize = 8 * 1024 * 1024;

#[derive(Clone)]
pub(super) enum Delivery {
    Http { url: Url, hosts: &'static [&'static str] },
    Extract(Url),
}

pub(super) struct Hit {
    pub(super) candidate: Candidate,
    delivery: Delivery,
}

impl Hit {
    pub(super) fn new(source: &str, key: &str, track: Recording, delivery: Delivery) -> Self {
        let digest = Sha256::digest(key.as_bytes());
        let id = crate::text::hex_lower(&digest[..16]);
        Self {
            candidate: Candidate {
                track,
                source: source.to_owned(),
                id,
                format: None,
                bitrate: None,
                album: None,
                cover_url: None,
                restricted: false,
            },
            delivery,
        }
    }

    pub(super) fn quality(mut self, format: &str, bitrate: Option<i32>) -> Self {
        self.candidate.format = Some(format.into());
        self.candidate.bitrate = bitrate;
        self
    }

    pub(super) fn album(mut self, album: &str) -> Self {
        self.candidate.album = (!album.trim().is_empty()).then(|| album.to_owned());
        self
    }
}

#[derive(Clone)]
pub(super) struct Transport {
    pub(super) config: MusicSourcesConfig,
    pub(super) http: Client,
    downloads: Client,
    deliveries: Cache<(String, String), Delivery>,
    #[cfg(test)]
    pub(super) test_endpoint: Arc<std::sync::OnceLock<Url>>,
}

impl Transport {
    pub fn new(config: MusicSourcesConfig) -> AppResult<Self> {
        let client = |timeout| {
            Client::builder()
                .timeout(Duration::from_secs(timeout))
                .user_agent("Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/145.0")
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(AppError::internal)
        };
        Ok(Self {
            config,
            http: client(18)?,
            downloads: client(100)?,
            deliveries: Cache::builder().max_capacity(8000).time_to_live(Duration::from_secs(180)).build(),
            #[cfg(test)]
            test_endpoint: Arc::default(),
        })
    }

    pub(super) fn extractor_available(&self) -> bool {
        #[cfg(test)]
        if self.test_endpoint.get().is_some() {
            return true;
        }
        self.extractor_path().is_some()
    }

    fn extractor_path(&self) -> Option<PathBuf> {
        resolve_executable(&self.config.extractor)
    }

    pub(super) async fn search(
        &self,
        source: &str,
        _query: &str,
        fetch: impl Future<Output = AppResult<Vec<Hit>>>,
    ) -> AppResult<SearchResults> {
        #[cfg(test)]
        if let Some(endpoint) = self.test_endpoint.get() {
            let url = endpoint.join("search").map_err(AppError::internal)?;
            let tracks = json(
                self.http
                    .post(url)
                    .json(&serde_json::json!({ "source": source, "query": _query }))
                    .send()
                    .await
                    .map_err(network)?,
            )
            .await?;
            return Ok(SearchResults { tracks, albums: Vec::new() });
        }
        let hits = fetch.await?;
        let mut seen = std::collections::HashSet::new();
        let tracks = hits
            .into_iter()
            .filter(|hit| seen.insert(hit.candidate.id.clone()))
            .take(MAX_RESULTS)
            .map(|hit| {
                self.deliveries.insert((source.to_owned(), hit.candidate.id.clone()), hit.delivery);
                hit.candidate
            })
            .collect();
        Ok(SearchResults { tracks, albums: Vec::new() })
    }

    pub(super) async fn stage(
        &self,
        candidate: &Candidate,
        _query: &str,
        refresh: impl Future<Output = AppResult<SearchResults>>,
    ) -> AppResult<Audio> {
        #[cfg(test)]
        if let Some(endpoint) = self.test_endpoint.get() {
            let url = endpoint.join("download").map_err(AppError::internal)?;
            let response = self
                .http
                .post(url)
                .json(&serde_json::json!({
                    "source": candidate.source, "id": candidate.id, "query": _query,
                }))
                .send()
                .await
                .map_err(network)?;
            let hint = response
                .headers()
                .get("x-audio-format")
                .and_then(|value| value.to_str().ok())
                .filter(|format| matches!(*format, "flac" | "mp3"))
                .unwrap_or("mp3")
                .to_owned();
            return self.stage_response(response, &hint, candidate.bitrate).await;
        }

        let key = (candidate.source.clone(), candidate.id.clone());
        if self.deliveries.get(&key).is_none() {
            refresh.await?;
        }
        let delivery = self
            .deliveries
            .get(&key)
            .ok_or_else(|| AppError::validation("This search result expired. Search again to refresh it."))?;
        match delivery {
            Delivery::Http { url, hosts } => {
                let hint = candidate.format.as_deref().unwrap_or("mp3");
                self.stage_http(
                    url,
                    hosts,
                    hint,
                    (hint != "mp3" && hint != "flac").then_some(candidate.bitrate).flatten(),
                )
                .await
            }
            Delivery::Extract(url) => self.extract_audio(url).await,
        }
    }

    async fn stage_http(&self, url: Url, allowed: &[&str], format: &str, bitrate: Option<i32>) -> AppResult<Audio> {
        if hosts(url.as_str(), allowed).is_none() {
            return Err(AppError::validation("The audio source returned an unsupported host."));
        }
        let mut response = self.downloads.get(url.clone()).send().await.map_err(network)?;
        for _ in 0..3 {
            if !response.status().is_redirection() {
                return self.stage_response(response, format, bitrate).await;
            }
            let target = redirect(&response, allowed)?;
            response = self.downloads.get(target).send().await.map_err(network)?;
        }
        Err(AppError::validation("The audio source returned too many redirects."))
    }

    async fn stage_response(&self, response: Response, format: &str, bitrate: Option<i32>) -> AppResult<Audio> {
        let response = response.error_for_status().map_err(network)?;
        let scratch = Scratch::new().await?;
        let extension = match format {
            "flac" => "flac",
            "mp3" => "mp3",
            "aac" => "m4a",
            _ => "input",
        };
        let path = scratch.file(&format!("source.{extension}"));
        stream_to(response, &path).await?;
        finish_audio(scratch, path, format, bitrate).await
    }

    #[cfg(all(test, feature = "integration-tests"))]
    pub fn use_test_endpoint(&self, endpoint: Url) {
        assert!(self.test_endpoint.set(endpoint).is_ok());
    }
}

pub(super) fn resolve_executable(path: &Path) -> Option<PathBuf> {
    let candidate = |path: &Path| {
        let path =
            if cfg!(windows) && path.extension().is_none() { path.with_extension("exe") } else { path.to_path_buf() };
        let metadata = path.metadata().ok()?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o111 == 0 {
                return None;
            }
        }
        metadata.is_file().then_some(path)
    };
    if path.components().count() > 1 {
        return candidate(path);
    }
    std::env::var_os("PATH")
        .and_then(|dirs| std::env::split_paths(&dirs).find_map(|dir| candidate(&dir.join(path))))
        .or_else(|| candidate(&std::env::current_exe().ok()?.parent()?.join(path)))
}

async fn finish_audio(scratch: Scratch, input: PathBuf, hint: &str, bitrate: Option<i32>) -> AppResult<Audio> {
    let actual = if hint == "flac" {
        FLAC
    } else if hint == "mp3" {
        MP3
    } else {
        if hint == "auto" {
            let path = input.clone();
            if let Some(format) =
                tokio::task::spawn_blocking(move || media::tags::read(&path).and_then(|tags| tags.codec))
                    .await
                    .map_err(AppError::internal)?
                    .and_then(|codec| match codec {
                        "flac" => Some(FLAC),
                        "mp3" => Some(MP3),
                        _ => None,
                    })
            {
                return checked_audio(scratch, input, format, bitrate).await;
            }
        }
        let path = scratch.file("normalized.mp3");
        if !media::ffmpeg::convert_uploaded_audio_to_mp3(&input, &path).await? {
            return Err(AppError::validation("The source returned invalid audio."));
        }
        return make_audio(scratch, path, MP3, bitrate.or(Some(0)));
    };
    checked_audio(scratch, input, actual, bitrate).await
}

async fn checked_audio(
    scratch: Scratch,
    path: PathBuf,
    format: media::formats::AudioFormat,
    bitrate: Option<i32>,
) -> AppResult<Audio> {
    if !media::ffmpeg::verify_import_audio(&path).await? {
        return Err(AppError::validation("The source returned invalid audio."));
    }
    make_audio(scratch, path, format, bitrate)
}

fn make_audio(
    scratch: Scratch,
    path: PathBuf,
    format: media::formats::AudioFormat,
    bitrate: Option<i32>,
) -> AppResult<Audio> {
    Ok(Audio { path, format, original_bitrate: bitrate, album: None, cover: None, _scratch: scratch })
}

pub(super) async fn json<T: serde::de::DeserializeOwned>(response: Response) -> AppResult<T> {
    let bytes = read_limited(response.error_for_status().map_err(network)?, MAX_TEXT).await?;
    serde_json::from_slice(&bytes).map_err(AppError::internal)
}

pub(super) async fn page(response: Response) -> AppResult<String> {
    let bytes = read_limited(response.error_for_status().map_err(network)?, MAX_TEXT).await?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

pub(super) fn text(value: &Value) -> &str {
    value.as_str().unwrap_or_default()
}

pub(super) fn number(value: &Value) -> Option<i32> {
    value
        .as_i64()
        .and_then(|value| i32::try_from(value).ok())
        .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
}

pub(super) fn hosts(href: &str, domains: &[&str]) -> Option<Url> {
    let url = Url::parse(href).ok()?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() || url.port().is_some() {
        return None;
    }
    let host = url.host_str()?;
    domains
        .iter()
        .any(|domain| host == *domain || host.strip_suffix(domain).is_some_and(|prefix| prefix.ends_with('.')))
        .then_some(url)
}

pub(super) fn duration_ms(value: &Value) -> i32 {
    number(value).unwrap_or_default().max(0).saturating_add(500) / 1000
}

pub(super) fn network(error: reqwest::Error) -> AppError {
    if let Some(status) = error.status() {
        return AppError::validation("The music source returned HTTP {0}.").arg(status.as_u16());
    }
    tracing::debug!(timeout = error.is_timeout(), connect = error.is_connect(), "Music source network request failed");
    AppError::validation("The music source did not answer.")
}

pub(super) fn redirect(response: &Response, allowed: &[&str]) -> AppResult<Url> {
    let url = response
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|header| header.to_str().ok())
        .and_then(|location| response.url().join(location).ok())
        .and_then(|url| hosts(url.as_str(), allowed));
    url.ok_or_else(|| AppError::validation("The music source redirected to an unexpected host."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_urls_are_limited_to_expected_https_hosts() {
        assert!(hosts("https://cdn.example.com/song.mp3", &["example.com"]).is_some());
        assert!(hosts("http://cdn.example.com/song.mp3", &["example.com"]).is_none());
        assert!(hosts("https://example.com.evil.test/audio", &["example.com"]).is_none());
        assert!(hosts("https://a@example.com/audio", &["example.com"]).is_none());
    }
}
