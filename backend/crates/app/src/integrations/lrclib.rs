// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use chrono::{DateTime, Utc};
use reqwest::header::{HeaderMap, RETRY_AFTER};
use serde::Deserialize;
use tokio::sync::Mutex;
use tokio::time::{Instant, sleep_until};

use super::http_client;
use crate::text::{normalize_key, to_latin};

const TIMEOUT: Duration = Duration::from_secs(15);
const REQUEST_PAUSE: Duration = Duration::from_secs(1);
const INITIAL_BACKOFF: Duration = Duration::from_secs(30);
const MAX_BACKOFF: Duration = Duration::from_secs(15 * 60);
const DURATION_TOLERANCE_SECONDS: f64 = 2.0;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LyricsQuery {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_seconds: i32,
}

#[derive(Debug, PartialEq, Eq)]
pub enum LyricsLookup {
    Found(String),
    NotFound,
    Instrumental,
}

#[derive(Clone)]
pub struct Lrclib {
    base_url: String,
    http: reqwest::Client,
    requests: Arc<Mutex<RequestSchedule>>,
}

struct RequestSchedule {
    next_request_at: Instant,
    failures: u32,
}

impl RequestSchedule {
    fn new() -> Self {
        Self { next_request_at: Instant::now(), failures: 0 }
    }

    fn succeeded(&mut self) {
        self.failures = 0;
        self.next_request_at = Instant::now() + REQUEST_PAUSE;
    }

    fn failed(&mut self, retry_after: Option<Duration>) -> Duration {
        let backoff = (INITIAL_BACKOFF * 2_u32.pow(self.failures.min(5))).min(MAX_BACKOFF);
        self.failures = self.failures.saturating_add(1);
        let delay =
            backoff.max(retry_after.unwrap_or_default()) + Duration::from_millis(u64::from(rand::random::<u8>()));
        let now = Instant::now();
        self.next_request_at = now.checked_add(delay).unwrap_or(now + MAX_BACKOFF);
        delay
    }
}

fn retry_after(headers: &HeaderMap, now: DateTime<Utc>) -> Option<Duration> {
    let value = headers.get(RETRY_AFTER)?.to_str().ok()?.trim();
    if let Ok(seconds) = value.parse::<u64>() {
        return Some(Duration::from_secs(seconds));
    }
    let date = DateTime::parse_from_rfc2822(value).ok()?;
    Some(date.signed_duration_since(now).to_std().unwrap_or_default())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    track_name: Option<String>,
    artist_name: Option<String>,
    duration: Option<f64>,
    #[serde(default)]
    instrumental: bool,
    plain_lyrics: Option<String>,
    synced_lyrics: Option<String>,
}

fn has_text(value: Option<&str>) -> bool {
    value.is_some_and(|text| !text.trim().is_empty())
}

fn key(value: &str) -> String {
    normalize_key(value).replace(['\'', '\u{2019}'], "")
}

fn variants(query: &LyricsQuery) -> Vec<LyricsQuery> {
    let artist = to_latin(&query.artist);
    let title = to_latin(&query.title);
    let album = if title == query.title { query.album.clone() } else { query.album.as_deref().map(to_latin) };
    let all = [
        query.clone(),
        LyricsQuery { artist: artist.clone(), ..query.clone() },
        LyricsQuery { artist, title, album, duration_seconds: query.duration_seconds },
    ];

    let mut distinct: Vec<LyricsQuery> = Vec::new();
    for variant in all {
        if !distinct.iter().any(|seen| seen.artist == variant.artist && seen.title == variant.title) {
            distinct.push(variant);
        }
    }
    distinct
}

impl Lrclib {
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_owned(),
            http: http_client(TIMEOUT),
            requests: Arc::new(Mutex::new(RequestSchedule::new())),
        }
    }

    pub(super) async fn wait_ready(&self) {
        let schedule = self.requests.lock().await;
        sleep_until(schedule.next_request_at).await;
    }

    async fn request(&self, path: &str, parameters: &[(&str, &str)]) -> anyhow::Result<reqwest::Response> {
        // Serialize requests across tracks, endpoints and clones so no caller bypasses a provider cooldown.
        let mut schedule = self.requests.lock().await;
        sleep_until(schedule.next_request_at).await;
        let response = match self.http.get(format!("{}{path}", self.base_url)).query(parameters).send().await {
            Ok(response) => response,
            Err(error) => {
                let delay = schedule.failed(None);
                return Err(error).with_context(|| format!("LRCLIB requests paused for {:.1}s", delay.as_secs_f64()));
            }
        };
        if response.status().is_server_error() || response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let delay = schedule.failed(retry_after(response.headers(), Utc::now()));
            return response
                .error_for_status()
                .with_context(|| format!("LRCLIB requests paused for {:.1}s", delay.as_secs_f64()));
        }
        schedule.succeeded();
        Ok(response)
    }

    pub async fn lookup(&self, query: &LyricsQuery) -> anyhow::Result<LyricsLookup> {
        for variant in variants(query) {
            let candidate = match self.exact(&variant).await? {
                Some(record) => Some(record),
                None => self.search(&variant).await?,
            };
            let result = match candidate {
                Some(record) if record.instrumental => LyricsLookup::Instrumental,
                Some(Record { synced_lyrics: Some(text), .. }) if has_text(Some(&text)) => LyricsLookup::Found(text),
                Some(Record { plain_lyrics: Some(text), .. }) if has_text(Some(&text)) => LyricsLookup::Found(text),
                _ => LyricsLookup::NotFound,
            };
            if result != LyricsLookup::NotFound {
                return Ok(result);
            }
        }
        Ok(LyricsLookup::NotFound)
    }

    async fn exact(&self, variant: &LyricsQuery) -> anyhow::Result<Option<Record>> {
        let duration = variant.duration_seconds.to_string();
        let mut parameters = vec![
            ("artist_name", variant.artist.as_str()),
            ("track_name", variant.title.as_str()),
            ("duration", duration.as_str()),
        ];
        if let Some(album) = variant.album.as_deref().filter(|a| !a.trim().is_empty()) {
            parameters.push(("album_name", album));
        }
        let response = self.request("/api/get", &parameters).await?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        Ok(Some(response.error_for_status()?.json().await?))
    }

    async fn search(&self, variant: &LyricsQuery) -> anyhow::Result<Option<Record>> {
        let found: Vec<Record> = self
            .request("/api/search", &[("artist_name", variant.artist.as_str()), ("track_name", variant.title.as_str())])
            .await?
            .error_for_status()?
            .json()
            .await?;

        let (title, artist) = (key(&variant.title), key(&variant.artist));
        let wanted = f64::from(variant.duration_seconds);
        let best = found
            .into_iter()
            .filter(|r| r.track_name.as_deref().is_some_and(|t| key(t) == title))
            .filter(|r| r.artist_name.as_deref().is_some_and(|a| key(a) == artist))
            .filter_map(|record| {
                // Unknown durations cannot safely distinguish album, live and remix versions.
                let difference = (record.duration? - wanted).abs();
                (difference <= DURATION_TOLERANCE_SECONDS).then_some((record, difference))
            })
            .filter(|(r, _)| {
                r.instrumental || has_text(r.synced_lyrics.as_deref()) || has_text(r.plain_lyrics.as_deref())
            })
            .min_by(|(a, a_difference), (b, b_difference)| {
                has_text(b.synced_lyrics.as_deref())
                    .cmp(&has_text(a.synced_lyrics.as_deref()))
                    .then(a_difference.total_cmp(b_difference))
            });
        Ok(best.map(|(record, _)| record))
    }
}

#[cfg(test)]
mod tests {
    use std::future::{Future, poll_fn};
    use std::task::Poll;

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::*;

    fn query() -> LyricsQuery {
        LyricsQuery { title: "Song".into(), artist: "Band".into(), album: None, duration_seconds: 200 }
    }

    async fn server(responses: Vec<String>) -> (Lrclib, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let client = Lrclib::new(&format!("http://{}", listener.local_addr().unwrap()));
        let handle = tokio::spawn(async move {
            for response in responses {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                let mut buffer = [0; 1024];
                while !request.ends_with(b"\r\n\r\n") {
                    let read = socket.read(&mut buffer).await.unwrap();
                    assert_ne!(read, 0, "client disconnected before sending headers");
                    request.extend_from_slice(&buffer[..read]);
                }
                socket.write_all(response.as_bytes()).await.unwrap();
            }
        });
        (client, handle)
    }

    fn response(status: &str, headers: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}",
            body.len()
        )
    }

    #[tokio::test]
    async fn search_ignores_unknown_durations_without_losing_valid_lyrics() {
        let body = r#"[
            {"trackName":"Song","artistName":"Band","duration":null,"syncedLyrics":"wrong null"},
            {"trackName":"Song","artistName":"Band","syncedLyrics":"wrong missing"},
            {"trackName":"Song","artistName":"Band","duration":210,"syncedLyrics":"wrong version"},
            {"trackName":"Song","artistName":"Band","duration":200,"plainLyrics":"plain"},
            {"trackName":"Song","artistName":"Band","duration":201,"syncedLyrics":"[00:01.00] synced"}
        ]"#;
        let (client, server) = server(vec![response("404 Not Found", "", "{}"), response("200 OK", "", body)]).await;
        assert_eq!(client.lookup(&query()).await.unwrap(), LyricsLookup::Found("[00:01.00] synced".into()));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn exact_match_accepts_null_duration() {
        let (client, server) =
            server(vec![response("200 OK", "", r#"{"duration":null,"plainLyrics":"lyrics"}"#)]).await;
        assert_eq!(client.lookup(&query()).await.unwrap(), LyricsLookup::Found("lyrics".into()));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn successful_requests_are_spaced_across_endpoints() {
        let (client, server) = server(vec![response("404 Not Found", "", "{}"), response("200 OK", "", "[]")]).await;
        assert!(client.exact(&query()).await.unwrap().is_none());
        let query = query();
        tokio::time::pause();
        let mut next = std::pin::pin!(client.search(&query));
        assert!(poll_fn(|cx| Poll::Ready(next.as_mut().poll(cx).is_pending())).await);
        tokio::time::advance(Duration::from_millis(900)).await;
        assert!(poll_fn(|cx| Poll::Ready(next.as_mut().poll(cx).is_pending())).await);
        tokio::time::advance(Duration::from_millis(200)).await;
        tokio::time::resume();
        assert!(next.await.unwrap().is_none());
        server.await.unwrap();
    }

    async fn assert_shared_cooldown(status: &str, headers: &str, delay: Duration) {
        let (client, server) = server(vec![response(status, headers, "{}"), response("200 OK", "", "[]")]).await;
        assert!(client.exact(&query()).await.is_err());
        let cloned = client.clone();
        let query = query();
        tokio::time::pause();
        {
            let mut waiting = std::pin::pin!(client.wait_ready());
            assert!(poll_fn(|cx| Poll::Ready(waiting.as_mut().poll(cx).is_pending())).await);
        }
        let mut next = std::pin::pin!(cloned.search(&query));
        assert!(poll_fn(|cx| Poll::Ready(next.as_mut().poll(cx).is_pending())).await);
        tokio::time::advance(delay - Duration::from_secs(1)).await;
        assert!(poll_fn(|cx| Poll::Ready(next.as_mut().poll(cx).is_pending())).await);
        tokio::time::advance(Duration::from_secs(2)).await;
        tokio::time::resume();
        assert!(next.await.unwrap().is_none());
        server.await.unwrap();
    }

    #[tokio::test]
    async fn service_unavailable_pauses_other_tracks_and_endpoints() {
        assert_shared_cooldown("503 Service Unavailable", "", Duration::from_secs(30)).await;
    }

    #[tokio::test]
    async fn rate_limit_honors_retry_after_across_clones() {
        assert_shared_cooldown("429 Too Many Requests", "Retry-After: 120\r\n", Duration::from_secs(120)).await;
    }

    #[tokio::test]
    async fn service_unavailable_honors_longer_retry_after() {
        assert_shared_cooldown("503 Service Unavailable", "Retry-After: 1200\r\n", Duration::from_secs(1200)).await;
    }

    #[tokio::test]
    async fn malformed_retry_after_still_backs_off() {
        assert_shared_cooldown("503 Service Unavailable", "Retry-After: invalid\r\n", Duration::from_secs(30)).await;
    }

    #[test]
    fn repeated_provider_failures_back_off_until_recovery() {
        let mut schedule = RequestSchedule::new();
        for seconds in [30, 60, 120, 240, 480, 900, 900] {
            let delay = schedule.failed(None);
            assert!(delay >= Duration::from_secs(seconds) && delay < Duration::from_secs(seconds + 1), "{delay:?}");
        }
        schedule.succeeded();
        assert!(schedule.failed(None) < Duration::from_secs(31));
    }

    #[test]
    fn retry_after_accepts_http_dates() {
        let now = DateTime::parse_from_rfc2822("Sun, 06 Nov 1994 08:49:37 GMT").unwrap().with_timezone(&Utc);
        let mut headers = HeaderMap::new();
        headers.insert(RETRY_AFTER, "Sun, 06 Nov 1994 08:51:37 GMT".parse().unwrap());
        assert_eq!(retry_after(&headers, now), Some(Duration::from_secs(120)));
    }

    #[test]
    fn past_retry_after_dates_do_not_underflow() {
        let now = DateTime::parse_from_rfc2822("Sun, 06 Nov 1994 08:51:37 GMT").unwrap().with_timezone(&Utc);
        let mut headers = HeaderMap::new();
        headers.insert(RETRY_AFTER, "Sun, 06 Nov 1994 08:49:37 GMT".parse().unwrap());
        assert_eq!(retry_after(&headers, now), Some(Duration::ZERO));
    }

    #[test]
    fn cyrillic_queries_also_try_transliteration() {
        let query =
            LyricsQuery {
                title: "Кино".to_owned(), artist: "Цой".to_owned(), album: None, duration_seconds: 200
            };
        let tried: Vec<(String, String)> = variants(&query).into_iter().map(|v| (v.artist, v.title)).collect();
        assert_eq!(
            tried,
            [("Цой".into(), "Кино".into()), ("Tsoy".into(), "Кино".into()), ("Tsoy".into(), "Kino".into())]
        );
    }

    #[tokio::test]
    #[ignore = "talks to the real LRCLIB"]
    async fn finds_synced_lyrics_for_a_cyrillic_song() -> anyhow::Result<()> {
        let query = LyricsQuery {
            title: "Группа крови".to_owned(),
            artist: "Кино".to_owned(),
            album: None,
            duration_seconds: 286,
        };
        let found = Lrclib::new("https://lrclib.net").lookup(&query).await?;
        assert!(matches!(found, LyricsLookup::Found(ref text) if text.contains('[')), "{found:?}");
        Ok(())
    }

    #[test]
    fn latin_queries_are_tried_once() {
        let query =
            LyricsQuery { title: "Song".to_owned(), artist: "Band".to_owned(), album: None, duration_seconds: 200 };
        assert_eq!(variants(&query).len(), 1);
    }
}
