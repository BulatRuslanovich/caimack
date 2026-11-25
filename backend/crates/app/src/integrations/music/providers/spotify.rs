// SPDX-License-Identifier: AGPL-3.0-only

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use futures_util::{FutureExt, SinkExt, StreamExt, future::BoxFuture};
use regex::Regex;
use reqwest::Url;
use serde::Deserialize;
use serde_json::{Value, json as object};
use tokio::net::TcpStream;
use tokio::sync::Semaphore;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async, tungstenite::Message};
use uuid::Uuid;

use super::{Capabilities, MusicProvider, ProviderContext};
use crate::integrations::music::audio::Scratch;
use crate::integrations::music::transport::{Transport, duration_ms, json, network, number, page, resolve_executable};
use crate::integrations::music::{Candidate, PlaylistSnapshot, Recording};
use crate::{AppError, AppResult};

const EMBED_LIMIT: usize = 95;
static EMBED_STATE: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r#"(?s)<script[^>]+id="__NEXT_DATA__"[^>]*>(.*?)</script>"#).ok());

const VISIBLE_TRACKS: &str = r#"(() => {
  const rows = [...document.querySelectorAll(
    '[data-testid="tracklist-row"], [data-testid="playlist-tracklist"] [role="row"]'
  )];
  const tracks = [];
  for (const row of rows) {
    const lines = (row.innerText || '').split('\n').map((line) => line.trim()).filter(Boolean);
    if (!/^[0-9]+$/.test(lines[0] || '')) continue;
    const position = Number(lines.shift());
    if (lines[0] === 'E') lines.shift();
    const title = lines.shift() || '';
    if (lines[0] === 'E') lines.shift();
    const artistLinks = [...row.querySelectorAll('a[href*="/artist/"]')].map((link) => link.textContent.trim());
    const artist = artistLinks.join(', ') || lines[0] || '';
    if (!title || !artist || artist.toLowerCase() === 'music video') continue;
    const time = lines.findLast((line) => /^\d+:\d\d$/.test(line));
    const duration = time ? time.split(':').reduce((seconds, value) => seconds * 60 + Number(value), 0) : 0;
    tracks.push({position, title, artist, duration});
  }
  const grid = document.querySelector('[data-testid="playlist-tracklist"] [aria-rowcount], [aria-rowcount][role="grid"]');
  const ariaCount = Number(grid?.getAttribute('aria-rowcount')) || 0;
  const header = document.querySelector('[data-testid="playlist-page"]') || document.querySelector('main');
  const summary = header?.innerText?.slice(0, 2000) || '';
  const counts = [...summary.matchAll(/(\d[\d,.\u00a0\u202f ]*)\s+(?:songs?|tracks?|items?)\b/gi)];
  const displayed = Math.max(0, ...counts.map((match) => Number(match[1].replace(/\D/g, ''))));
  const hasHeader = Boolean(grid?.querySelector('[role="columnheader"]'));
  const expected = displayed || Math.max(0, ariaCount - Number(hasHeader));
  const title = document.querySelector('main h1')?.innerText || document.title.replace(/\s*\|\s*Spotify.*$/, '');
  rows.at(-1)?.scrollIntoView({block: 'start'});
  return {title, expected, tracks};
})()"#;

type BrowserSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[derive(Deserialize)]
struct BrowserRows {
    title: String,
    expected: i32,
    tracks: Vec<BrowserTrack>,
}

#[derive(Deserialize)]
struct BrowserTrack {
    position: usize,
    title: String,
    artist: String,
    duration: i32,
}

pub(super) fn register(context: &ProviderContext) -> Arc<dyn MusicProvider> {
    Arc::new(Spotify::new(context.transport.clone()))
}

struct Spotify {
    transport: Transport,
    browser: Semaphore,
}

impl MusicProvider for Spotify {
    fn id(&self) -> &'static str {
        "spotify"
    }

    fn name(&self) -> &'static str {
        "Spotify"
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities { playlist: true, ..Default::default() }
    }

    fn parse_link(&self, url: &Url) -> Option<String> {
        if url.host_str() != Some("open.spotify.com") {
            return None;
        }
        let path = url.path().trim_matches('/');
        let path = if path.starts_with("intl-") { path.split_once('/')?.1 } else { path };
        let id = path.strip_prefix("playlist/")?;
        (id.len() == 22 && id.bytes().all(|byte| byte.is_ascii_alphanumeric())).then(|| id.to_owned())
    }

    fn playlist<'a>(&'a self, _user: Uuid, id: &'a str) -> BoxFuture<'a, AppResult<PlaylistSnapshot>> {
        self.read_spotify(id).boxed()
    }
}

impl Spotify {
    fn new(transport: Transport) -> Self {
        Self { transport, browser: Semaphore::new(1) }
    }

    async fn read_spotify(&self, id: &str) -> AppResult<PlaylistSnapshot> {
        #[cfg(test)]
        if let Some(endpoint) = self.transport.test_endpoint.get() {
            let url = endpoint.join("spotify").map_err(AppError::internal)?;
            return json(self.transport.http.post(url).json(&object!({ "id": id })).send().await.map_err(network)?)
                .await;
        }
        self.spotify(id).await
    }

    pub(super) async fn spotify(&self, id: &str) -> AppResult<PlaylistSnapshot> {
        let embed = async {
            let response = self
                .transport
                .http
                .get(format!("https://open.spotify.com/embed/playlist/{id}"))
                .send()
                .await
                .map_err(network)?;
            parse_embed(&page(response).await?)
        }
        .await;
        if let Ok((snapshot, expected)) = &embed
            && !snapshot.tracks.is_empty()
            && expected.map_or(snapshot.tracks.len() < EMBED_LIMIT, |count| snapshot.tracks.len() >= count)
        {
            return Ok(snapshot.clone());
        }

        let browser = self.spotify_browser(&format!("https://open.spotify.com/playlist/{id}")).await;
        match (embed, browser) {
            (Ok((embedded, expected)), Ok(rendered)) => Ok(merge(embedded, expected, rendered)),
            (Ok((mut embedded, expected)), Err(_)) if !embedded.tracks.is_empty() => {
                embedded.partial = true;
                embedded.omitted = expected.unwrap_or_default().saturating_sub(embedded.tracks.len());
                Ok(embedded)
            }
            (_, Ok(rendered)) if !rendered.tracks.is_empty() => Ok(rendered),
            (embed, browser) => {
                tracing::debug!(embed = ?embed.err(), browser = ?browser.err(), "Spotify playlist could not be read");
                Err(AppError::validation("Spotify did not return a readable public playlist."))
            }
        }
    }

    async fn spotify_browser(&self, address: &str) -> AppResult<PlaylistSnapshot> {
        let _permit = self.browser.try_acquire().map_err(|_| AppError::validation("The Spotify reader is busy."))?;
        let profile = Scratch::new().await?;
        let chromium = browser_binary(&self.transport.config.chromium)
            .ok_or_else(|| AppError::validation("The Spotify browser is unavailable."))?;
        let mut command = tokio::process::Command::new(chromium);
        command
            .args([
                "--headless",
                "--no-first-run",
                "--disable-extensions",
                "--disable-dev-shm-usage",
                "--disable-background-networking",
                "--lang=en-US",
                "--window-size=1280,800",
                "--remote-debugging-address=127.0.0.1",
                "--remote-debugging-port=0",
            ])
            .arg(format!("--user-data-dir={}", profile.file("").display()))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        if self.transport.config.chromium_no_sandbox {
            command.arg("--no-sandbox");
        }
        let mut child = command.arg("about:blank").spawn().map_err(AppError::internal)?;
        let socket = self.spotify_socket(&profile).await;
        let result = match socket {
            Ok(mut socket) => scan(&mut socket, address).await,
            Err(error) => Err(error),
        };
        let _ = child.kill().await;
        result
    }

    async fn spotify_socket(&self, profile: &Scratch) -> AppResult<BrowserSocket> {
        let file = profile.file("DevToolsActivePort");
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                if let Ok(port) = tokio::fs::read_to_string(&file).await
                    && let Some(port) = port.lines().next().and_then(|line| line.parse::<u16>().ok())
                {
                    let response = self
                        .transport
                        .http
                        .get(format!("http://127.0.0.1:{port}/json/list"))
                        .send()
                        .await
                        .map_err(network)?;
                    let tabs: Vec<Value> = json(response).await?;
                    let target = tabs
                        .iter()
                        .find(|tab| tab["type"] == "page")
                        .and_then(|tab| tab["webSocketDebuggerUrl"].as_str())
                        .ok_or_else(|| AppError::validation("The Spotify browser did not expose a page."))?;
                    let url = UrlCheck::parse(target, port)?;
                    let (socket, _) = connect_async(url.as_str()).await.map_err(AppError::internal)?;
                    return Ok(socket);
                }
                tokio::time::sleep(Duration::from_millis(150)).await;
            }
        })
        .await
        .map_err(|_| AppError::validation("The Spotify browser did not start."))?
    }
}

fn browser_binary(configured: &Path) -> Option<PathBuf> {
    resolve_executable(configured).or_else(|| {
        if configured != Path::new("chromium-headless-shell") {
            return None;
        }
        ["chromium", "google-chrome", "chrome", "msedge"]
            .into_iter()
            .find_map(|name| resolve_executable(Path::new(name)))
            .or_else(installed_browser)
    })
}

fn installed_browser() -> Option<PathBuf> {
    if !cfg!(windows) {
        return None;
    }
    ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"]
        .into_iter()
        .filter_map(std::env::var_os)
        .map(PathBuf::from)
        .flat_map(|root| {
            ["Google/Chrome/Application/chrome.exe", "Microsoft/Edge/Application/msedge.exe"]
                .map(|relative| root.join(relative))
        })
        .find_map(|path| resolve_executable(&path))
}

struct UrlCheck;

impl UrlCheck {
    fn parse(value: &str, port: u16) -> AppResult<reqwest::Url> {
        let url = reqwest::Url::parse(value).map_err(AppError::internal)?;
        if url.scheme() != "ws"
            || url.host_str() != Some("127.0.0.1")
            || url.port() != Some(port)
            || !url.username().is_empty()
            || url.password().is_some()
            || !url.path().starts_with("/devtools/page/")
        {
            return Err(AppError::validation("The Spotify browser returned an invalid debugger address."));
        }
        Ok(url)
    }
}

async fn browser_call(socket: &mut BrowserSocket, id: u32, method: &str, params: Value) -> AppResult<Value> {
    let request = object!({ "id": id, "method": method, "params": params });
    socket.send(Message::Text(request.to_string().into())).await.map_err(AppError::internal)?;
    tokio::time::timeout(Duration::from_secs(8), async {
        while let Some(message) = socket.next().await {
            let message = message.map_err(AppError::internal)?;
            if let Message::Text(text) = message {
                let value: Value = serde_json::from_str(&text).map_err(AppError::internal)?;
                if value["id"].as_u64() == Some(u64::from(id)) {
                    if value.get("error").is_some() {
                        break;
                    }
                    return Ok(value["result"].clone());
                }
            }
        }
        Err(AppError::validation("The Spotify browser did not answer."))
    })
    .await
    .map_err(|_| AppError::validation("The Spotify browser did not answer."))?
}

async fn scan(socket: &mut BrowserSocket, address: &str) -> AppResult<PlaylistSnapshot> {
    let navigation = browser_call(socket, 1, "Page.navigate", object!({ "url": address })).await?;
    if navigation["errorText"].is_string() {
        return Err(AppError::validation("The Spotify browser could not load the public playlist."));
    }
    let start = tokio::time::Instant::now();
    let mut seen = BTreeMap::new();
    let mut settled = 0;
    let mut expected = 0;
    let mut name = String::new();
    for sequence in 2..400 {
        if start.elapsed() >= Duration::from_secs(80) || seen.len() >= super::super::jobs::MAX_PLAYLIST_ITEMS {
            break;
        }
        let result = browser_call(
            socket,
            sequence,
            "Runtime.evaluate",
            object!({
                "expression": VISIBLE_TRACKS, "returnByValue": true,
            }),
        )
        .await;
        if let Ok(result) = result
            && let Ok(visible) = serde_json::from_value::<BrowserRows>(result["result"]["value"].clone())
        {
            let initial = seen.len();
            expected = expected.max(visible.expected);
            if !visible.title.is_empty() {
                name = visible.title;
            }
            for track in visible.tracks {
                seen.entry(track.position).or_insert(track);
            }
            if !seen.is_empty() {
                settled = if initial == seen.len() { settled + 1 } else { 0 };
            }
            let reported = usize::try_from(expected).unwrap_or_default();
            if (reported >= EMBED_LIMIT && seen.len() >= reported) || settled > 30 {
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    let expected = usize::try_from(expected).unwrap_or_default();
    let largest_position = seen.last_key_value().map_or(0, |(&position, _)| position);
    let total = expected.max(largest_position);
    let count = seen.len();
    let partial = count < total || (expected == 0 && settled <= 30);
    let tracks = seen
        .into_values()
        .map(|track| {
            spotify_track(format!("position:{}", track.position), track.title, track.artist, track.duration, None)
        })
        .collect();
    Ok(PlaylistSnapshot { name, tracks, omitted: total.saturating_sub(count), partial })
}

fn parse_embed(html: &str) -> AppResult<(PlaylistSnapshot, Option<usize>)> {
    let state = EMBED_STATE
        .as_ref()
        .and_then(|regex| regex.captures(html))
        .and_then(|capture| capture.get(1))
        .ok_or_else(|| AppError::validation("Spotify did not return embedded tracks."))?;
    let body: Value = serde_json::from_str(state.as_str()).map_err(AppError::internal)?;
    let entity = &body["props"]["pageProps"]["state"]["data"]["entity"];
    let name = entity["title"].as_str().or_else(|| entity["name"].as_str()).unwrap_or("Spotify").to_owned();
    let entries = entity["trackList"]
        .as_array()
        .ok_or_else(|| AppError::validation("Spotify did not return embedded tracks."))?;
    let tracks = entries
        .iter()
        .enumerate()
        .filter_map(|(index, row)| {
            if row["entityType"].as_str().is_some_and(|kind| kind != "track") {
                return None;
            }
            let title = row["title"].as_str()?.to_owned();
            let artist = row["subtitle"].as_str()?.replace('\u{a0}', " ");
            let duration = row.get("duration").or_else(|| row.get("durationMs")).unwrap_or(&Value::Null);
            let id = row["uri"].as_str().map_or_else(|| format!("position:{index}"), str::to_owned);
            let isrc = row["isrc"].as_str().map(str::to_owned);
            Some(spotify_track(id, title, artist, duration_ms(duration), isrc))
        })
        .collect::<Vec<_>>();
    let omitted = entries.len() - tracks.len();
    let total = number(&entity["totalCount"])
        .or_else(|| number(&entity["trackCount"]))
        .and_then(|count| usize::try_from(count).ok());
    Ok((PlaylistSnapshot { name, tracks, omitted, partial: false }, total))
}

fn spotify_track(id: String, title: String, artist: String, duration: i32, isrc: Option<String>) -> Candidate {
    Candidate {
        track: Recording { title, artist, duration, isrc },
        source: "spotify".into(),
        id,
        format: None,
        bitrate: None,
        album: None,
        cover_url: None,
        restricted: false,
    }
}

fn merge(mut embed: PlaylistSnapshot, expected: Option<usize>, mut rendered: PlaylistSnapshot) -> PlaylistSnapshot {
    if rendered.tracks.len() <= embed.tracks.len() {
        embed.partial = expected.is_none_or(|total| embed.tracks.len() < total);
        embed.omitted = embed.omitted.max(expected.unwrap_or_default().saturating_sub(embed.tracks.len()));
        return embed;
    }
    let mut embedded = embed.tracks.into_iter().peekable();
    for track in &mut rendered.tracks {
        if let Some(first) = embedded.peek()
            && first.track.title.eq_ignore_ascii_case(&track.track.title)
            && first.track.artist.eq_ignore_ascii_case(&track.track.artist)
            && let Some(first) = embedded.next()
        {
            *track = first;
        }
    }
    rendered.partial |= expected.is_some_and(|total| rendered.tracks.len() < total);
    if !embed.name.is_empty() {
        rendered.name = embed.name;
    }
    rendered
}

#[cfg(test)]
mod tests {
    use base64::Engine;

    use super::*;

    #[tokio::test]
    #[ignore = "fetches a public playlist from Spotify"]
    async fn live_public_playlist_uses_the_native_reader() -> AppResult<()> {
        let source = browser_source()?;
        let snapshot = source.read_spotify("37i9dQZEVXbMwmF30ppw50").await?;
        assert!(!snapshot.tracks.is_empty());
        assert!(!snapshot.partial);
        assert!(snapshot.tracks.iter().all(|track| track.track.duration > 0));
        Ok(())
    }

    #[tokio::test]
    #[ignore = "fetches a public 200-track playlist from Spotify"]
    async fn live_public_playlist_reads_past_the_embed_limit() -> AppResult<()> {
        let source = browser_source()?;
        let snapshot = source.read_spotify("6kkhpnVsU2eegDyOG24rHW").await?;
        assert_eq!(snapshot.tracks.len(), 200);
        assert!(!snapshot.partial);
        Ok(())
    }

    #[tokio::test]
    #[ignore = "requires the Chromium executable configured with MUSIC_CHROMIUM"]
    async fn browser_collects_virtual_rows_in_playlist_order() -> AppResult<()> {
        let source = browser_source()?;
        let fixture = r#"<!doctype html>
            <main><h1>Playlist fixture</h1><p>123 songs</p>
            <div data-testid="playlist-tracklist"></div></main>
            <script>
            const list = document.querySelector('[data-testid=playlist-tracklist]');
            function append(start) {
              list.innerHTML = '';
              for (let number = start; number <= Math.min(start + 19, 123); number++) {
                const row = document.createElement('div');
                row.dataset.testid = 'tracklist-row';
                row.innerHTML = '<div>' + number + '</div><div>Song ' + number
                  + '</div><div><a href="/artist/demo">Artist</a></div><div>3:07</div>';
                list.appendChild(row);
              }
              const next = start + 20;
              if (next < 124) Object.defineProperty(list.lastChild, 'scrollIntoView', {
                value: () => setTimeout(() => append(next), 50)
              });
            }
            append(1);
            </script>"#;
        let address = format!("data:text/html;base64,{}", base64::engine::general_purpose::STANDARD.encode(fixture));
        let snapshot = source.spotify_browser(&address).await?;
        assert_eq!(snapshot.name, "Playlist fixture");
        assert_eq!(snapshot.tracks.len(), 123);
        assert_eq!(snapshot.tracks[0].track.title, "Song 1");
        assert_eq!(snapshot.tracks[122].track.title, "Song 123");
        assert_eq!(snapshot.tracks[122].track.duration, 187);
        assert!(!snapshot.partial);
        Ok(())
    }

    fn browser_source() -> AppResult<Spotify> {
        Transport::new(crate::config::MusicSourcesConfig {
            chromium: std::env::var_os("MUSIC_CHROMIUM").unwrap_or_else(|| "chromium-headless-shell".into()).into(),
            chromium_no_sandbox: std::env::var("MUSIC_CHROMIUM_NO_SANDBOX").is_ok_and(|value| value == "true"),
            ..Default::default()
        })
        .map(Spotify::new)
    }

    #[test]
    fn reads_spotify_duration_and_retains_credits_in_a_long_playlist() -> AppResult<()> {
        let embed = r#"<script type="application/json" id="__NEXT_DATA__">{"props":{"pageProps":{"state":{"data":{"entity":{"title":"Mix","trackList":[{"title":"First","subtitle":"Artist","duration":185000,"uri":"spotify:track:first"}]}}}}}}</script>"#;
        let (snapshot, _) = parse_embed(embed)?;
        let full = PlaylistSnapshot {
            name: "Music".into(),
            tracks: (0..123)
                .map(|i| {
                    spotify_track(
                        format!("position:{i}"),
                        if i == 0 { "First".into() } else { i.to_string() },
                        "Artist".into(),
                        0,
                        None,
                    )
                })
                .collect(),
            partial: false,
            omitted: 0,
        };
        let actual = merge(snapshot, Some(123), full);
        assert_eq!(actual.tracks.len(), 123);
        assert_eq!(actual.tracks[0].track.duration, 185);
        assert_eq!(actual.tracks[122].track.title, "122");
        assert!(!actual.partial);
        Ok(())
    }
}
