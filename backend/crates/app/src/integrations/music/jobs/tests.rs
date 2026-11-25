// SPDX-License-Identifier: AGPL-3.0-only

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use serde_json::{Value, json};
use sqlx::PgPool;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

use super::super::audio::Scratch;
use super::*;
use crate::integrations::enrichment::EnrichmentQueue;
use crate::storage::Storage;
use crate::transcode::TranscodeQueue;
use crate::upload::Uploads;

const SPOTIFY: &str = "https://open.spotify.com/playlist/0123456789012345678901";

fn candidate(id: &str, title: &str, source: &str, artist: &str) -> Value {
    json!({ "id": id, "title": title, "artist": artist, "source": source, "duration": 10 })
}

async fn fake_sources(
    listener: TcpListener,
    available: Arc<AtomicBool>,
    requests: Arc<AtomicUsize>,
    mp3: Vec<u8>,
    flac: Vec<u8>,
) {
    let mp3 = Arc::new(mp3);
    let flac = Arc::new(flac);
    while let Ok((socket, _)) = listener.accept().await {
        let (available, requests, mp3, flac) = (available.clone(), requests.clone(), mp3.clone(), flac.clone());
        tokio::spawn(async move {
            let mut socket = BufReader::new(socket);
            let mut first = String::new();
            socket.read_line(&mut first).await?;
            let path = first.split_whitespace().nth(1).unwrap_or("");
            let mut length = 0;
            loop {
                let mut header = String::new();
                if socket.read_line(&mut header).await? == 0 || header == "\r\n" {
                    break;
                }
                if let Some(("content-length", content)) = header.to_lowercase().trim().split_once(':') {
                    length = content.trim().parse().unwrap_or_default();
                }
            }
            let mut request = vec![0; length];
            socket.read_exact(&mut request).await?;
            let request: Value = serde_json::from_slice(&request).unwrap_or_default();
            let (body, headers) = match path {
                "/spotify" => {
                    let changes = requests.fetch_add(1, Ordering::SeqCst);
                    let tracks = ["First", "Second", "Third"]
                        .into_iter()
                        .enumerate()
                        .map(|(index, title)| candidate(&index.to_string(), title, "spotify", "Artist"))
                        .collect::<Vec<_>>();
                    (json!({ "name": if changes == 0 { "Import mix" } else { "Source changed" }, "tracks": tracks, "partial": false }).to_string().into_bytes(), "Content-Type: application/json\r\n")
                }
                "/search" => {
                    let found = match request["source"].as_str() {
                        Some("soundcloud") => {
                            let mut found = vec![candidate("cover", "Second", "soundcloud", "Another artist")];
                            if available.load(Ordering::SeqCst) {
                                let mut short = candidate("preview", "Second", "soundcloud", "Artist");
                                short["format"] = "flac".into();
                                found.push(short);
                            }
                            found
                        }
                        Some("zvu4no") if available.load(Ordering::SeqCst) => {
                            vec![candidate("mp3", "Second", "zvu4no", "Artist")]
                        }
                        _ => vec![],
                    };
                    (json!(found).to_string().into_bytes(), "Content-Type: application/json\r\n")
                }
                "/download" if request["id"] == "mp3" => (mp3.to_vec(), "X-Audio-Format: mp3\r\n"),
                "/download" if request["id"] == "preview" => (flac.to_vec(), "X-Audio-Format: flac\r\n"),
                _ => (Vec::new(), ""),
            };
            socket
                .write_all(
                    format!("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: {}\r\n{headers}\r\n", body.len())
                        .as_bytes(),
                )
                .await?;
            socket.write_all(&body).await?;
            Ok::<_, std::io::Error>(())
        });
    }
}

async fn audio_fixture(scratch: &Scratch, name: &str, seconds: u32) -> anyhow::Result<Vec<u8>> {
    let path = scratch.file(name);
    let status = tokio::process::Command::new(media::ffmpeg::EXECUTABLE)
        .args([
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440",
            "-t",
            &seconds.to_string(),
        ])
        .arg(&path)
        .status()
        .await?;
    anyhow::ensure!(status.success(), "could not create the audio fixture");
    Ok(tokio::fs::read(path).await?)
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn playlist_recovers_expired_lease_and_retries_in_original_order(db: PgPool) -> anyhow::Result<()> {
    if !media::ffmpeg::is_present().await {
        eprintln!("ffmpeg is required to create test audio");
        return Ok(());
    }
    let scratch = Scratch::new().await?;
    let user = Uuid::now_v7();
    let first = Uuid::now_v7();
    let third = Uuid::now_v7();
    let artist = Uuid::now_v7();
    sqlx::query("INSERT INTO users(id,username,password_hash,created_at) VALUES ($1,'music-test','unused',now())")
        .bind(user)
        .execute(&db)
        .await?;
    sqlx::query("INSERT INTO artists(id,name,normalized_name,created_at) VALUES ($1,'Artist','artist',now())")
        .bind(artist)
        .execute(&db)
        .await?;
    sqlx::query(
        "INSERT INTO tracks(id,title,normalized_title,artist_id,duration_seconds,file_path,original_file_name,mime_type,
           file_size,content_hash,codec,created_at)
         VALUES ($1,'First','first',$3,10,'first.flac','first.flac','audio/flac',100,'first','flac',now()),
                ($2,'Third','third',$3,10,'third.flac','third.flac','audio/flac',100,'third','flac',now())",
    ).bind(first).bind(third).bind(artist).execute(&db).await?;
    sqlx::query("INSERT INTO track_artists(track_id,artist_id,position) VALUES ($1,$3,0), ($2,$3,0)")
        .bind(first)
        .bind(third)
        .bind(artist)
        .execute(&db)
        .await?;

    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let url = reqwest::Url::parse(&format!("http://{}/", listener.local_addr()?))?;
    let available = Arc::new(AtomicBool::new(false));
    let reads = Arc::new(AtomicUsize::new(0));
    let server = tokio::spawn(fake_sources(
        listener,
        available.clone(),
        reads.clone(),
        audio_fixture(&scratch, "fixture.mp3", 10).await?,
        audio_fixture(&scratch, "preview.flac", 2).await?,
    ));
    let (transcodes, _jobs) = TranscodeQueue::new();
    let (enrichment, _enrichment_jobs) = EnrichmentQueue::new();
    let uploads = Uploads {
        db: db.clone(),
        storage: Storage::open(&scratch.file("storage"))?,
        transcodes,
        enrichment,
        hashes: Default::default(),
    };
    let (yandex, yandex_worker) = super::super::super::yandex::YandexMusic::start_worker(
        crate::config::YandexMusicConfig { base_url: url.to_string(), client: "test".into(), sign_key: "test".into() },
        uploads.clone(),
        CancellationToken::new(),
    );
    let make_service = || -> AppResult<Music> {
        let music = Music::new(uploads.clone(), Default::default(), yandex.clone())?;
        music.transport.use_test_endpoint(url.clone());
        Ok(music)
    };
    let service = make_service()?;
    assert_eq!(service.playlist_link(SPOTIFY)?.provider.id(), "spotify");
    assert_eq!(service.playlist_link("https://vk.ru/music/playlist/-1_2")?.provider.id(), "vk");
    assert_eq!(service.playlist_link("https://music.yandex.ru/users/owner/playlists/1")?.provider.id(), "yandex");
    assert!(service.playlist_link("https://open.spotify.com.example.org/playlist/0123456789012345678901").is_err());
    let (preview, _) = service.preview_playlist(user, SPOTIFY).await?;
    let job_id = service
        .enqueue(
            user,
            ImportRequest::Playlist {
                url: SPOTIFY.into(),
                sources: vec!["soundcloud".into(), "zvu4no".into()],
                allow_partial: false,
                preview_id: Some(preview),
            },
        )
        .await?;

    let claim = service.claim().await?.expect("first worker claimed the job");
    assert_eq!(claim.id, job_id);
    drop(service);
    sqlx::query("UPDATE music_imports SET locked_until=now()-interval '1 second' WHERE id=$1")
        .bind(job_id)
        .execute(&db)
        .await?;

    let recovered = make_service()?;
    let shutdown = CancellationToken::new();
    for _ in 0..10 {
        let Some(claim) = recovered.claim().await? else { break };
        recovered.run_claim(&claim, &shutdown).await;
    }
    let jobs = recovered.imports(user).await?;
    assert_eq!((jobs[0].title.as_deref(), jobs[0].total, jobs[0].done, jobs[0].failed), (Some("Import mix"), 3, 3, 1));
    assert_eq!(jobs[0].playlist_id, Some(job_id));
    assert_eq!(reads.load(Ordering::SeqCst), 1, "import uses the same track list the user previewed");
    assert!(recovered.items(Uuid::nil(), job_id, 0).await?.is_empty());

    available.store(true, Ordering::SeqCst);
    recovered.retry(user, job_id).await?;
    for _ in 0..10 {
        let Some(claim) = recovered.claim().await? else { break };
        recovered.run_claim(&claim, &shutdown).await;
    }
    let rows = recovered.items(user, job_id, 0).await?;
    assert_eq!(rows[1].state, "added", "{:?}", rows[1]);
    assert!(
        rows[1]
            .attempts
            .as_array()
            .unwrap()
            .iter()
            .any(|a| a["source"] == "soundcloud" && a["state"] == "download-failed")
    );
    let playlist = crate::library::playlists::detail(&db, user, job_id).await?;
    assert!(!playlist.is_public);
    assert_eq!(
        playlist.tracks.iter().map(|track| track.id).collect::<Vec<_>>(),
        vec![first, rows[1].track_id.unwrap(), third]
    );
    assert_eq!(playlist.tracks[1].codec.as_deref(), Some("mp3"));
    assert_eq!(reads.load(Ordering::SeqCst), 1);
    server.abort();
    yandex_worker.abort();
    Ok(())
}
