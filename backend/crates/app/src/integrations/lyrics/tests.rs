// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use super::matching::candidate;
use super::providers::{Endpoints, Provider};
use super::*;
use anyhow::Context;
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn query() -> LyricsQuery {
    LyricsQuery { title: "Song".into(), artist: "Artist".into(), album: Some("Album".into()), duration_seconds: 180 }
}

#[test]
fn exact_recordings_outrank_base_versions_and_unknown_durations_lose_timing() {
    let q = query();
    assert!(candidate(&q, "Song (Live)", "Artist", 180.0, "[00:01]Hi", "lrc", "Test").is_none());
    assert!(candidate(&q, "Song", "Other", 180.0, "[00:01]Hi", "lrc", "Test").is_none());
    let unknown = candidate(&q, "Song", "Artist", 0.0, "[00:01]Hi", "lrc", "Test").unwrap();
    assert!(unknown.parsed.lines.is_empty());
    let sped = LyricsQuery { title: "Song (Sped Up)".into(), ..q };
    let base = candidate(&sped, "Song", "Artist", 180.0, "[00:01]Hi", "lrc", "Test").unwrap();
    assert!(!base.exact);
    assert!(base.parsed.lines.is_empty());
}

#[test]
fn fully_timed_text_outranks_partial_word_coverage() {
    let q = query();
    let rich =
        candidate(&q, "Song", "Artist", 180.0, "[00:01]<00:01>One<00:02>\n[00:03]<00:03>Two<00:04>", "lrc", "Test")
            .unwrap();
    let partial =
        candidate(&q, "Song", "Artist", 180.0, "[00:01]<00:01>One<00:02>\n[00:03]Two", "lrc", "Test").unwrap();
    assert!(rich.rank() > partial.rank());
}

#[test]
fn a_truncated_rich_response_cannot_hide_a_complete_song() {
    let q = query();
    let full =
        candidate(&q, "Song", "Artist", 180.0, "A complete verse and chorus of the song", "plain", "Complete").unwrap();
    let truncated = candidate(&q, "Song", "Artist", 180.0, "[00:01]<00:01>Hi<00:02>", "lrc", "Truncated").unwrap();
    for candidates in [vec![full.clone(), truncated.clone()], vec![truncated, full]] {
        assert_eq!(choose_best(candidates).unwrap().provider, "Complete");
    }
}

async fn server(responses: Vec<(u16, Value)>) -> (LyricsProviders, tokio::task::JoinHandle<Vec<String>>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let client = LyricsProviders {
        endpoints: Arc::new(Endpoints {
            unison: base.clone(),
            better: base.clone(),
            simp: base.clone(),
            netease: base.clone(),
            qq: base.clone(),
            genius: base.clone(),
            megalobiz: base.clone(),
            kugou: base.clone(),
            ovh: base.clone(),
        }),
        ..LyricsProviders::new(Lrclib::new(&base), None)
    };
    let handle = tokio::spawn(async move {
        let mut requests = Vec::new();
        for (status, body) in responses {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut req = Vec::new();
            let mut buf = [0; 2048];
            while !req.ends_with(b"\r\n\r\n") {
                let n = socket.read(&mut buf).await.unwrap();
                assert!(n > 0);
                req.extend_from_slice(&buf[..n]);
            }
            requests.push(String::from_utf8(req).unwrap());
            let body = body.as_str().map(str::to_owned).unwrap_or_else(|| body.to_string());
            let response = format!(
                "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            socket.write_all(response.as_bytes()).await.unwrap();
        }
        requests
    });
    (client, handle)
}

#[tokio::test]
async fn netease_prefers_real_yrc_to_lrc() {
    let (client,server) = server(vec![(200,json!({"result":{"songs":[{"id":1,"name":"Song","ar":[{"name":"Artist"}],"dt":180000}]}})),
        (200,json!({"yrc":{"lyric":"[1000,2000](1000,500,0)Hello (1700,800,0)world"},"lrc":{"lyric":"[00:01]Hello world"}}))]).await;
    let found = client.fetch(Provider::Netease, &query()).await.unwrap().best.unwrap();
    assert_eq!(found.parsed.lines[0].words[1].at, 1700);
    assert!(server.await.unwrap()[1].contains("yv=1"));
}

#[tokio::test]
async fn unison_recovers_confirmed_video_id_and_preserves_attribution_when_simp_fails() {
    let (client,server) = server(vec![(200,json!({"success":true,"data":{"song":"Song","artist":"Artist","album":"Album","duration":180,"confidence":"high","format":"lrc","lyrics":"[00:01]<00:01>Hello <00:02>world<00:03>","videoId":"abcdefghijk","submitter":{"displayName":"Curator","keyId":"abc"}}})),(503,json!({"error":"offline"}))]).await;
    let found = client.fetch(Provider::Unison, &query()).await.unwrap().best.unwrap();
    assert_eq!(found.provider, "Unison");
    assert_eq!(found.attribution["submitter"], "Curator");
    assert!(server.await.unwrap()[1].contains("/v1/abcdefghijk"));
}

#[tokio::test]
async fn provider_rate_limit_blocks_cloned_clients_without_repeating_requests() {
    let (client, server) = server(vec![(429, json!({"error":"rate limit"}))]).await;
    assert!(client.fetch(Provider::Ovh, &query()).await.is_err());
    assert!(client.clone().fetch(Provider::Ovh, &query()).await.is_err());
    assert_eq!(server.await.unwrap().len(), 1);
}

#[tokio::test]
async fn a_retired_provider_is_a_miss_and_is_not_requested_again() {
    let (client, server) = server(vec![(410, json!({"error":"Gone"}))]).await;
    assert!(client.fetch(Provider::Ovh, &query()).await.unwrap().best.is_none());
    assert!(client.clone().fetch(Provider::Ovh, &query()).await.unwrap().best.is_none());
    assert_eq!(server.await.unwrap().len(), 1);
}

#[tokio::test]
async fn better_lyrics_requires_identity_from_ttml() {
    let (client, server) =
        server(vec![(200, json!({"ttml":"<tt><body><p begin='1s' end='2s'>Wrong</p></body></tt>"}))]).await;
    assert!(client.fetch(Provider::Better, &query()).await.unwrap().best.is_none());
    server.await.unwrap();
}

#[tokio::test]
async fn better_ttml_and_qq_qrc_are_decoded_without_losing_fragments() {
    let ttml = "<tt><head><metadata><title>Song</title><artist>Artist</artist><album>Album</album></metadata></head><body><p begin='1s' end='3s'><span begin='0s' end='0.5s'>Hello </span><span begin='0.7s' end='1.5s'>world</span></p></body></tt>";
    let (client,server) = server(vec![(200,json!({"ttml":ttml})),(200,json!({"provider":"qq","duration":180,"lyrics":"[ti:Song]\n[ar:Artist]\n[1000,2000]Hello (1000,500)world(1700,800)"}))]).await;
    for provider in [Provider::Better, Provider::BetterQq] {
        let found = client.fetch(provider, &query()).await.unwrap().best.unwrap();
        assert_eq!(found.parsed.lines[0].words[1].at, 1700);
        assert_eq!(found.parsed.quality(), 200);
    }
    server.await.unwrap();
}

#[tokio::test]
async fn qq_music_and_kugou_validate_catalogue_identity_before_download() {
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode("[00:01]<00:01>Hello <00:02>world<00:03>");
    let (client,server) = server(vec![
        (200,json!({"data":{"song":{"list":[{"songname":"Wrong","songmid":"bad","interval":180,"singer":[{"name":"Artist"}]},{"songname":"Song","songmid":"mid","interval":180,"singer":[{"name":"Artist"}]}]}}})),
        (200,json!({"lyric":"<Qrc><Lyric_1 LyricContent=\"[1000,2000]Hello (1000,500)world(1700,800)\"/></Qrc>"})),
        (200,json!({"candidates":[{"song":"Song","singer":"Artist","duration":180000,"id":"123","accesskey":"key"}]})),
        (200,json!({"content":encoded})),
    ]).await;
    for provider in [Provider::Qq, Provider::Kugou] {
        assert_eq!(client.fetch(provider, &query()).await.unwrap().best.unwrap().parsed.quality(), 200);
    }
    let requests = server.await.unwrap();
    assert!(requests[1].contains("songmid=mid"));
    assert!(requests[3].contains("id=123"));
}

#[tokio::test]
async fn simp_richsync_preserves_newline_boundaries_and_rejects_other_videos() {
    let (client,server) = server(vec![(200,json!({"success":true,"data":[
        {"videoId":"wrongwrong1","songTitle":"Song","artistName":"Artist","plainLyric":"Wrong"},
        {"videoId":"abcdefghijk","songTitle":"Song","artistName":"Artist","richSync":"<00:01>Hello <00:02>world\n<00:03>Again<00:04>","duration":180}
    ]}))]).await;
    let found = client.simpmusic(&query(), "abcdefghijk").await.unwrap().unwrap();
    assert_eq!(found.parsed.lines.len(), 2);
    assert_eq!(found.parsed.lines[0].words[1].at, 2000);
    server.await.unwrap();
}

#[tokio::test]
async fn ovh_uses_encoded_path_segments_and_plain_text_only() {
    let (client, server) = server(vec![(200, json!({"lyrics":"Hello world"}))]).await;
    let q = LyricsQuery { artist: "Artist/Other".into(), ..query() };
    let found = client.fetch(Provider::Ovh, &q).await.unwrap().best.unwrap();
    assert!(found.parsed.lines.is_empty());
    assert!(server.await.unwrap()[0].contains("Artist%2FOther"));
}

#[tokio::test]
async fn html_sources_extract_text_after_verifying_metadata() {
    let (client,server) = server(vec![
        (200,json!({"response":{"sections":[{"hits":[{"result":{"title":"Song","primary_artist":{"name":"Artist"},"url":"https://genius.com/artist-song-lyrics"}}]}]}})),
        (200,json!("<div data-lyrics-container=\"true\">Hello &amp; world<br/>Again</div>")),
        (200,json!("<a href='/lrc/maker/Song.123'>Song</a>")),
        (200,json!("<span id='lrc_1_lyrics'>[ti:Song]<br>[ar:Artist]<br>[length:03:00]<br>[00:01]Hello world</span>")),
    ]).await;
    let genius = client.fetch(Provider::Genius, &query()).await.unwrap().best.unwrap();
    assert_eq!(genius.parsed.plain, "Hello & world\nAgain");
    let megalo = client.fetch(Provider::Megalobiz, &query()).await.unwrap().best.unwrap();
    assert_eq!(megalo.parsed.quality(), 100);
    assert_eq!(server.await.unwrap().len(), 4);
}

#[tokio::test]
#[ignore = "queries real external lyrics providers"]
async fn live_lookup_smoke() -> anyhow::Result<()> {
    let providers = LyricsProviders::new(Lrclib::new("https://lrclib.net"), None);
    let q = LyricsQuery {
        title: "Never Gonna Give You Up".into(),
        artist: "Rick Astley".into(),
        album: Some("Whenever You Need Somebody".into()),
        duration_seconds: 213,
    };
    let result = providers.lookup(&q).await?;
    let candidate = result.best.context("No verified lyrics from any provider")?;
    println!(
        "Verified live lyrics: provider={}, quality={}, lines={}, fragments={}",
        candidate.provider,
        candidate.parsed.quality(),
        candidate.parsed.lines.len(),
        candidate.parsed.lines.iter().map(|l| l.words.len()).sum::<usize>()
    );
    Ok(())
}

#[tokio::test]
#[ignore = "diagnoses real external lyrics providers"]
async fn live_provider_diagnostics() {
    let providers = LyricsProviders::new(Lrclib::new("https://lrclib.net"), None);
    let q = LyricsQuery {
        title: "Never Gonna Give You Up".into(),
        artist: "Rick Astley".into(),
        album: Some("Whenever You Need Somebody".into()),
        duration_seconds: 213,
    };
    let mut tasks = futures_util::stream::FuturesUnordered::new();
    for provider in Provider::ALL {
        let providers = &providers;
        let q = &q;
        tasks.push(async move {
            match tokio::time::timeout(Duration::from_secs(12), providers.fetch(provider, q)).await {
                Ok(Ok(result)) => match result.best {
                    Some(c) => println!(
                        "{provider:?}: quality={} format={} duration_difference={} words={}",
                        c.parsed.quality(),
                        c.format,
                        c.duration_difference,
                        c.parsed.lines.iter().map(|l| l.words.len()).sum::<usize>()
                    ),
                    None => println!("{provider:?}: no matching text"),
                },
                Ok(Err(e)) => println!("{provider:?}: error {e:#}"),
                Err(_) => println!("{provider:?}: timed out"),
            }
        });
    }
    while tasks.next().await.is_some() {}
}
