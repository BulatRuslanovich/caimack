// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use super::matching::{candidate, key};
use super::{BODY_LIMIT, Candidate, LookupResult, LyricsProviders, LyricsQuery, SourceSchedule};
use crate::catalog::lyrics::pattern;
use anyhow::{Context, ensure};
use base64::Engine;
use serde_json::{Value, json};
use std::time::Duration;
use tokio::time::{Instant, sleep_until};

#[derive(Debug, Clone, Copy)]
pub(super) enum Provider {
    Lrclib,
    Unison,
    Better,
    Netease,
    Qq,
    Genius,
    Megalobiz,
    BetterQq,
    Kugou,
    Ovh,
}
impl Provider {
    pub(super) const ALL: [Self; 10] = [
        Self::Lrclib,
        Self::Unison,
        Self::Better,
        Self::Netease,
        Self::Qq,
        Self::Genius,
        Self::Megalobiz,
        Self::BetterQq,
        Self::Kugou,
        Self::Ovh,
    ];
}

pub(super) struct Endpoints {
    pub unison: String,
    pub better: String,
    pub simp: String,
    pub netease: String,
    pub qq: String,
    pub genius: String,
    pub megalobiz: String,
    pub kugou: String,
    pub ovh: String,
}
impl Default for Endpoints {
    fn default() -> Self {
        Self {
            unison: "https://unison.betterlyrics.org".into(),
            better: "https://api.betterlyrics.org".into(),
            simp: "https://api-lyrics.simpmusic.org".into(),
            netease: "https://music.163.com".into(),
            qq: "https://c.y.qq.com".into(),
            genius: "https://genius.com".into(),
            megalobiz: "https://www.megalobiz.com".into(),
            kugou: "https://lyrics.kugou.com".into(),
            ovh: "https://api.lyrics.ovh".into(),
        }
    }
}

fn result(best: Option<Candidate>) -> LookupResult {
    LookupResult { best, instrumental: false }
}
fn string<'a>(body: &'a Value, keys: &[&str]) -> &'a str {
    keys.iter().find_map(|k| body.get(k).and_then(Value::as_str)).unwrap_or("")
}
fn number(body: &Value, key: &str) -> f64 {
    body.get(key)
        .and_then(|v| v.as_f64().or_else(|| v.as_str()?.parse().ok()))
        .filter(|v| v.is_finite() && *v > 0.0)
        .unwrap_or(0.0)
}
fn people(body: &Value) -> String {
    if let Some(s) = body.as_str() {
        return s.to_owned();
    }
    body.as_array()
        .map(|items| {
            items.iter().filter_map(|p| p.as_str().or_else(|| p.get("name")?.as_str())).collect::<Vec<_>>().join(", ")
        })
        .unwrap_or_default()
}
fn best(current: &mut Option<Candidate>, found: Option<Candidate>) {
    if let Some(found) = found
        && current.as_ref().is_none_or(|old| found.rank() > old.rank())
    {
        *current = Some(found);
    }
}

impl LyricsProviders {
    async fn read(
        &self,
        url: &str,
        params: &[(&str, String)],
        referer: Option<&str>,
    ) -> anyhow::Result<Option<String>> {
        let host = reqwest::Url::parse(url)?.host_str().context("Missing provider host")?.to_owned();
        let slot = {
            let mut hosts = self.cooldowns.lock().await;
            let now = Instant::now();
            if hosts.get(url).is_some_and(|schedule| schedule.retired) {
                return Ok(None);
            }
            let schedule = hosts.entry(host.clone()).or_insert(SourceSchedule { next: now, retired: false });
            ensure!(schedule.next <= now + Duration::from_secs(2), "Lyrics provider cooling down");
            let slot = schedule.next.max(now);
            schedule.next = slot + Duration::from_millis(300);
            slot
        };
        sleep_until(slot).await;
        let mut request = self.http.get(url).query(params);
        if let Some(referer) = referer {
            request = request.header(reqwest::header::REFERER, referer);
        }
        if url.starts_with(&self.endpoints.better)
            && let Some(key) = &self.better_key
        {
            request = request.header("X-API-Key", key);
        }
        let response = request.send().await?;
        let status = response.status();
        if status == reqwest::StatusCode::GONE {
            self.cooldowns.lock().await.insert(url.to_owned(), SourceSchedule { next: Instant::now(), retired: true });
            return Ok(None);
        }
        if status == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if status.is_server_error() || matches!(status.as_u16(), 401 | 403 | 429) {
            let delay = response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| {
                    v.parse::<u64>().ok().map(Duration::from_secs).or_else(|| {
                        chrono::DateTime::parse_from_rfc2822(v)
                            .ok()?
                            .signed_duration_since(chrono::Utc::now())
                            .to_std()
                            .ok()
                    })
                })
                .unwrap_or(Duration::from_secs(if status.as_u16() == 429 { 60 } else { 300 }))
                .min(Duration::from_secs(3600));
            self.cooldowns.lock().await.insert(host, SourceSchedule { next: Instant::now() + delay, retired: false });
        }
        let bytes = crate::integrations::read_limited(response.error_for_status()?, BODY_LIMIT).await?;
        Ok(Some(String::from_utf8(bytes).context("Non UTF-8 lyrics response")?))
    }

    async fn json(&self, url: &str, params: &[(&str, String)], referer: Option<&str>) -> anyhow::Result<Value> {
        let Some(text) = self.read(url, params, referer).await? else {
            return Ok(Value::Null);
        };
        let trimmed = text.trim();
        let jsonp = !trimmed.starts_with(['{', '[']);
        let text = if jsonp {
            trimmed.find('(').zip(trimmed.rfind(')')).and_then(|(a, b)| trimmed.get(a + 1..b)).unwrap_or(trimmed)
        } else {
            trimmed
        };
        serde_json::from_str(text).context("Invalid provider JSON")
    }

    pub(super) async fn fetch(&self, provider: Provider, query: &LyricsQuery) -> anyhow::Result<LookupResult> {
        let found = match provider {
            Provider::Lrclib => return self.lrclib(query).await,
            Provider::Unison => self.unison(query).await?,
            Provider::Better => self.better(query, false).await?,
            Provider::Netease => self.netease(query).await?,
            Provider::Qq => self.qq(query).await?,
            Provider::Genius => self.genius(query).await?,
            Provider::Megalobiz => self.megalobiz(query).await?,
            Provider::BetterQq => self.better(query, true).await?,
            Provider::Kugou => self.kugou(query).await?,
            Provider::Ovh => self.ovh(query).await?,
        };
        Ok(result(found))
    }

    async fn unison(&self, q: &LyricsQuery) -> anyhow::Result<Option<Candidate>> {
        let mut params =
            vec![("song", q.title.clone()), ("artist", q.artist.clone()), ("duration", q.duration_seconds.to_string())];
        if let Some(album) = &q.album {
            params.push(("album", album.clone()));
        }
        let body = self.json(&format!("{}/lyrics", self.endpoints.unison), &params, None).await?;
        if body["success"] != true {
            return Ok(None);
        }
        let d = &body["data"];
        let confidence = d["confidence"].as_str().is_some_and(|s| s.eq_ignore_ascii_case("high"))
            || d["confidence"].as_f64().is_some_and(|n| (0.8..=1.0).contains(&n));
        if !confidence
            || q.album
                .as_ref()
                .is_some_and(|a| !string(d, &["album"]).is_empty() && key(a) != key(string(d, &["album"])))
        {
            return Ok(None);
        }
        let mut found = candidate(
            q,
            string(d, &["song"]),
            string(d, &["artist"]),
            number(d, "duration"),
            string(d, &["lyrics"]),
            string(d, &["format"]),
            "Unison",
        );
        let video = string(d, &["videoId"]);
        if !valid_video(video) || found.is_none() {
            return Ok(found);
        }
        if let Some(c) = &mut found {
            let submitter = &d["submitter"];
            let curator = string(submitter, &["keyId"]);
            c.attribution = json!({"url":format!("https://unison.betterlyrics.org/song/{video}"),
                "submitter":string(submitter,&["displayName"]),
                "submitterUrl": if curator.chars().all(|c| c.is_ascii_alphanumeric() || c=='-' || c=='_') && !curator.is_empty() { Some(format!("https://unison.betterlyrics.org/curator/{curator}")) } else { None }});
        }
        // A verified catalogue match supplies a real ID for the ID-only SimpMusic source.
        match self.simpmusic(q, video).await {
            Ok(simp) => best(&mut found, simp),
            Err(error) => tracing::debug!("SimpMusic unavailable: {error:#}"),
        }
        Ok(found)
    }

    pub(super) async fn simpmusic(&self, q: &LyricsQuery, video: &str) -> anyhow::Result<Option<Candidate>> {
        if !valid_video(video) {
            return Ok(None);
        }
        let body = self.json(&format!("{}/v1/{video}", self.endpoints.simp), &[], None).await?;
        if body["success"] != true {
            return Ok(None);
        }
        let mut found = None;
        for item in body["data"].as_array().into_iter().flatten().take(10) {
            if string(item, &["videoId"]) != video {
                continue;
            }
            let raw = string(item, &["richSync", "syncedLyrics", "plainLyric", "lyrics"]);
            let format = match string(item, &["format"]) {
                "" if raw.contains('<') => "richsync",
                "" if raw.contains('[') => "lrc",
                "" => "plain",
                f => f,
            };
            let duration = number(item, "duration").max(number(item, "durationSeconds"));
            best(
                &mut found,
                candidate(
                    q,
                    string(item, &["songTitle", "song", "title"]),
                    string(item, &["artistName", "artist"]),
                    if duration == 0.0 { f64::from(q.duration_seconds) } else { duration },
                    raw,
                    format,
                    "SimpMusic",
                ),
            );
        }
        Ok(found)
    }

    async fn better(&self, q: &LyricsQuery, qq: bool) -> anyhow::Result<Option<Candidate>> {
        let album = q.album.as_deref().unwrap_or("");
        if !qq && (album.is_empty() || q.duration_seconds <= 0) {
            return Ok(None);
        }
        let body = self
            .json(
                &format!("{}/{}getLyrics", self.endpoints.better, if qq { "qq/" } else { "" }),
                &[
                    ("s", q.title.clone()),
                    ("a", q.artist.clone()),
                    ("al", album.to_owned()),
                    ("d", q.duration_seconds.to_string()),
                ],
                None,
            )
            .await?;
        if qq {
            if body["provider"] != "qq" {
                return Ok(None);
            }
            let raw = string(&body, &["lyrics"]);
            let tag = |name| {
                pattern(&format!(r"(?i)\[{name}:([^\]]+)\]")).captures(raw).and_then(|c| c.get(1).map(|m| m.as_str()))
            };
            let length = tag("length")
                .and_then(|s| s.split_once(':'))
                .and_then(|(m, s)| Some(m.parse::<f64>().ok()? * 60.0 + s.parse::<f64>().ok()?))
                .unwrap_or(0.0);
            let duration = number(&body, "duration")
                .max(tag("total").and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0) / 1000.0)
                .max(length);
            return Ok(candidate(
                q,
                tag("ti").unwrap_or(""),
                tag("ar").unwrap_or(""),
                duration,
                raw,
                "qrc",
                "Better Lyrics QQ",
            ));
        }
        let raw = string(&body, &["ttml"]);
        if raw.is_empty() || raw.len() > BODY_LIMIT {
            return Ok(None);
        }
        let Ok(doc) = roxmltree::Document::parse(raw) else {
            return Ok(None);
        };
        let meta = |aliases: &[&str]| {
            doc.descendants().find_map(|n| {
                if !n.ancestors().any(|p| p.has_tag_name("metadata")) {
                    return None;
                }
                let key = n.attribute("key").or_else(|| n.attribute("name")).unwrap_or_else(|| n.tag_name().name());
                aliases
                    .iter()
                    .any(|a| key.eq_ignore_ascii_case(a))
                    .then(|| n.attribute("value").or_else(|| n.text()).unwrap_or(""))
                    .filter(|s| !s.is_empty())
            })
        };
        let Some(title) = meta(&["musicName", "songName", "title"]) else {
            return Ok(None);
        };
        let Some(artist) = meta(&["artists", "artist", "artistName", "creator"]) else {
            return Ok(None);
        };
        if meta(&["album", "albumName"]).is_some_and(|a| key(a) != key(album)) {
            return Ok(None);
        }
        let duration = meta(&["duration"]).and_then(|s| s.parse::<f64>().ok()).unwrap_or(f64::from(q.duration_seconds));
        Ok(candidate(q, title, artist, duration, raw, "ttml", "Better Lyrics"))
    }

    async fn netease(&self, q: &LyricsQuery) -> anyhow::Result<Option<Candidate>> {
        let mut found = None;
        for artist in spellings(&q.artist) {
            let body = self
                .json(
                    &format!("{}/api/cloudsearch/pc", self.endpoints.netease),
                    &[("type", "1".into()), ("limit", "12".into()), ("s", format!("{artist} {}", q.title))],
                    Some("https://music.163.com/"),
                )
                .await?;
            let mut attempts = 0;
            for song in body["result"]["songs"].as_array().into_iter().flatten().take(12) {
                let title = string(song, &["name"]);
                let artists = people(song.get("ar").or_else(|| song.get("artists")).unwrap_or(&Value::Null));
                let duration = number(song, "dt").max(number(song, "duration")) / 1000.0;
                if candidate(q, title, &artists, duration, "candidate", "plain", "Netease").is_none() {
                    continue;
                }
                let Some(id) = song["id"].as_u64() else {
                    continue;
                };
                let lyric = self
                    .json(
                        &format!("{}/api/song/lyric", self.endpoints.netease),
                        &[
                            ("id", id.to_string()),
                            ("lv", "1".into()),
                            ("kv", "1".into()),
                            ("yv", "1".into()),
                            ("tv", "-1".into()),
                        ],
                        Some("https://music.163.com/"),
                    )
                    .await?;
                for (field, format) in [("yrc", "yrc"), ("lrc", "lrc")] {
                    if let Some(raw) = lyric[field]["lyric"].as_str() {
                        best(&mut found, candidate(q, title, &artists, duration, raw, format, "Netease"));
                    }
                }
                attempts += 1;
                if found.as_ref().is_some_and(|c| c.parsed.quality() >= 200) || attempts >= 3 {
                    break;
                }
            }
            if found.is_some() {
                break;
            }
        }
        Ok(found)
    }

    async fn qq(&self, q: &LyricsQuery) -> anyhow::Result<Option<Candidate>> {
        let body = self
            .json(
                &format!("{}/soso/fcgi-bin/client_search_cp", self.endpoints.qq),
                &[
                    ("w", format!("{} {}", q.artist, q.title)),
                    ("format", "json".into()),
                    ("p", "1".into()),
                    ("n", "12".into()),
                ],
                Some("https://y.qq.com/"),
            )
            .await?;
        let mut found = None;
        let mut attempts = 0;
        for song in body["data"]["song"]["list"].as_array().into_iter().flatten().take(12) {
            let title = string(song, &["songname"]);
            let artist = people(&song["singer"]);
            let duration = number(song, "interval");
            if candidate(q, title, &artist, duration, "candidate", "plain", "QQ Music").is_none() {
                continue;
            }
            let mid = string(song, &["songmid"]);
            if mid.is_empty() {
                continue;
            }
            let lyric = self
                .json(
                    &format!("{}/lyric/fcgi-bin/fcg_query_lyric_new.fcg", self.endpoints.qq),
                    &[("songmid", mid.into()), ("format", "json".into()), ("nobase64", "1".into())],
                    Some("https://y.qq.com/"),
                )
                .await?;
            let raw = html_escape::decode_html_entities(string(&lyric, &["lyric"]));
            best(
                &mut found,
                candidate(
                    q,
                    title,
                    &artist,
                    duration,
                    &raw,
                    if raw.trim_start().starts_with('<') { "qrc" } else { "lrc" },
                    "QQ Music",
                ),
            );
            attempts += 1;
            if attempts >= 3 || found.as_ref().is_some_and(|c| c.parsed.quality() >= 200) {
                break;
            }
        }
        Ok(found)
    }

    async fn genius(&self, q: &LyricsQuery) -> anyhow::Result<Option<Candidate>> {
        let body = self
            .json(
                &format!("{}/api/search/multi", self.endpoints.genius),
                &[("per_page", "5".into()), ("q", format!("{} {}", q.artist, q.title))],
                None,
            )
            .await?;
        let mut attempts = 0;
        for section in body["response"]["sections"].as_array().into_iter().flatten() {
            for hit in section["hits"].as_array().into_iter().flatten().take(5) {
                let song = &hit["result"];
                let title = string(song, &["title"]);
                let artist = string(&song["primary_artist"], &["name"]);
                if candidate(q, title, artist, 0.0, "candidate", "plain", "Genius").is_none() {
                    continue;
                }
                let url = string(song, &["url"]);
                let Ok(url) = reqwest::Url::parse(url) else {
                    continue;
                };
                if !matches!(url.host_str(), Some("genius.com" | "www.genius.com")) || url.scheme() != "https" {
                    continue;
                }
                let Some(page) = self.read(&format!("{}{}", self.endpoints.genius, url.path()), &[], None).await?
                else {
                    continue;
                };
                let containers = pattern(r#"(?s)<div[^>]*data-lyrics-container="true"[^>]*>(.*?)</div>"#);
                let raw = containers
                    .captures_iter(&page)
                    .filter_map(|c| c.get(1).map(|m| html(m.as_str())))
                    .collect::<Vec<_>>()
                    .join("\n");
                if let Some(found) = candidate(q, title, artist, 0.0, &raw, "plain", "Genius") {
                    return Ok(Some(found));
                }
                attempts += 1;
                if attempts >= 2 {
                    return Ok(None);
                }
            }
        }
        Ok(None)
    }

    async fn megalobiz(&self, q: &LyricsQuery) -> anyhow::Result<Option<Candidate>> {
        let Some(page) = self
            .read(
                &format!("{}/search/all", self.endpoints.megalobiz),
                &[("qry", format!("{} {}", q.artist, q.title))],
                None,
            )
            .await?
        else {
            return Ok(None);
        };
        let links = pattern(r#"href=["'](/lrc/maker/[^"'#?]+)["']"#);
        for link in links.captures_iter(&page).take(3) {
            let Some(page) = self.read(&format!("{}{}", self.endpoints.megalobiz, &link[1]), &[], None).await? else {
                continue;
            };
            let lyrics = pattern(r#"(?s)<span[^>]*id=["']lrc_[^"']*_lyrics["'][^>]*>(.*?)</span>"#);
            for raw in lyrics.captures_iter(&page) {
                let raw = html(&raw[1]);
                let tag = |name| {
                    pattern(&format!(r"(?i)\[{name}:([^\]]+)\]"))
                        .captures(&raw)
                        .and_then(|c| c.get(1).map(|m| m.as_str()))
                };
                let duration = tag("length")
                    .and_then(|s| s.split_once(':'))
                    .and_then(|(m, s)| Some(m.parse::<f64>().ok()? * 60.0 + s.parse::<f64>().ok()?))
                    .unwrap_or(0.0);
                if let Some(c) =
                    candidate(q, tag("ti").unwrap_or(""), tag("ar").unwrap_or(""), duration, &raw, "lrc", "Megalobiz")
                {
                    return Ok(Some(c));
                }
            }
        }
        Ok(None)
    }

    async fn kugou(&self, q: &LyricsQuery) -> anyhow::Result<Option<Candidate>> {
        let body = self
            .json(
                &format!("{}/search", self.endpoints.kugou),
                &[
                    ("keyword", format!("{} {}", q.artist, q.title)),
                    ("duration", q.duration_seconds.saturating_mul(1000).to_string()),
                    ("client", "pc".into()),
                    ("ver", "1".into()),
                    ("man", "yes".into()),
                ],
                None,
            )
            .await?;
        let mut found = None;
        let mut attempts = 0;
        for song in body["candidates"].as_array().into_iter().flatten().take(20) {
            let title = string(song, &["song"]);
            let artist = string(song, &["singer"]);
            let duration = number(song, "duration") / 1000.0;
            if candidate(q, title, artist, duration, "candidate", "plain", "Kugou").is_none() {
                continue;
            }
            let id = song["id"]
                .as_str()
                .map(str::to_owned)
                .or_else(|| song["id"].as_u64().map(|id| id.to_string()))
                .unwrap_or_default();
            let access = string(song, &["accesskey"]);
            if id.is_empty() || !id.bytes().all(|c| c.is_ascii_digit()) || access.is_empty() || access.len() > 256 {
                continue;
            }
            let lyric = self
                .json(
                    &format!("{}/download", self.endpoints.kugou),
                    &[
                        ("id", id),
                        ("accesskey", access.into()),
                        ("fmt", "lrc".into()),
                        ("charset", "utf8".into()),
                        ("client", "pc".into()),
                        ("ver", "1".into()),
                    ],
                    None,
                )
                .await?;
            if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(string(&lyric, &["content"]))
                && let Ok(raw) = String::from_utf8(bytes)
            {
                best(
                    &mut found,
                    candidate(q, title, artist, duration, raw.trim_start_matches('\u{feff}'), "lrc", "Kugou"),
                );
            }
            attempts += 1;
            if attempts >= 3 || found.as_ref().is_some_and(|c| c.parsed.quality() >= 200) {
                break;
            }
        }
        Ok(found)
    }

    async fn ovh(&self, q: &LyricsQuery) -> anyhow::Result<Option<Candidate>> {
        let mut url = reqwest::Url::parse(&self.endpoints.ovh)?;
        url.path_segments_mut()
            .map_err(|()| anyhow::anyhow!("Invalid lyrics.ovh base URL"))?
            .push("v1")
            .push(&q.artist)
            .push(&q.title);
        let body = self.json(url.as_str(), &[], None).await?;
        Ok(candidate(q, &q.title, &q.artist, 0.0, string(&body, &["lyrics"]), "plain", "lyrics.ovh"))
    }
}

fn valid_video(value: &str) -> bool {
    value.len() == 11 && value.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}
fn spellings(value: &str) -> Vec<String> {
    let latin = crate::text::to_latin(value);
    if latin == value { vec![value.into()] } else { vec![value.into(), latin] }
}
fn html(raw: &str) -> String {
    let breaks = pattern(r"(?i)<br\s*/?>").replace_all(raw, "\n");
    html_escape::decode_html_entities(&pattern(r"<[^>]+>").replace_all(&breaks, "")).trim().to_owned()
}
