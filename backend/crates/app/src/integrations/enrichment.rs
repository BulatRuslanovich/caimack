// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::Utc;
use sqlx::PgPool;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::deezer::Deezer;
use super::lrclib::LyricsQuery;
use super::lyrics::{Candidate, LyricsProviders};
use crate::catalog::lyrics::LyricsSource;
use crate::catalog::tags;
use crate::covers;
use crate::storage::{ARTIST_IMAGE_DIRECTORY, COVER_DIRECTORY, CoverSize, Storage};

const CAPACITY: usize = 2048;
const ARTIST_PAUSE: Duration = Duration::from_secs(2);
const BACKFILL_DELAY: Duration = Duration::from_secs(60);

#[derive(Debug, Clone)]
pub struct EnrichmentRequest {
    pub track: Option<Uuid>,
    pub artists: Vec<Uuid>,
}

#[derive(Clone)]
pub struct EnrichmentQueue {
    sender: mpsc::Sender<EnrichmentRequest>,
    queued_tracks: Arc<Mutex<HashSet<Uuid>>>,
}

impl EnrichmentQueue {
    pub fn new() -> (Self, mpsc::Receiver<EnrichmentRequest>) {
        let (sender, receiver) = mpsc::channel(CAPACITY);
        (Self { sender, queued_tracks: Arc::default() }, receiver)
    }

    pub fn try_enqueue(&self, request: EnrichmentRequest) -> bool {
        if let Some(track) = request.track
            && !self.queued_tracks.lock().is_ok_and(|mut queued| queued.insert(track))
        {
            return false;
        }
        let track = request.track;
        if self.sender.try_send(request).is_ok() {
            return true;
        }
        self.finished(track);
        false
    }

    fn finished(&self, track: Option<Uuid>) {
        if let (Some(track), Ok(mut queued)) = (track, self.queued_tracks.lock()) {
            queued.remove(&track);
        }
    }
}

#[derive(Clone)]
pub struct Enrichment {
    pub db: PgPool,
    pub storage: Storage,
    pub deezer: Deezer,
    pub lyrics_providers: LyricsProviders,
}

#[derive(Debug, PartialEq, Eq)]
enum Outcome {
    Saved,
    Skipped,
    NotFound,
    Instrumental,
}

impl Enrichment {
    fn image_exists(&self, path: Option<&str>) -> bool {
        path.is_some_and(|path| {
            [CoverSize::Full, CoverSize::Thumb, CoverSize::Large]
                .into_iter()
                .any(|size| self.storage.existing(&Storage::cover_variant(path, size)).is_some())
        })
    }

    async fn track_cover(&self, track: Uuid) -> anyhow::Result<Outcome> {
        let row = sqlx::query!(
            r#"SELECT t.title, t.artist_id, t.album_id, t.year, ar.name AS artist_name,
                      al.title AS "album_title?", al.cover_path
               FROM tracks t JOIN artists ar ON ar.id = t.artist_id LEFT JOIN albums al ON al.id = t.album_id
               WHERE t.id = $1"#,
            track
        )
        .fetch_optional(&self.db)
        .await?;
        let Some(row) = row.filter(|row| !self.image_exists(row.cover_path.as_deref())) else {
            return Ok(Outcome::Skipped);
        };
        let file: Option<String> =
            sqlx::query_scalar("SELECT file_path FROM tracks WHERE id=$1").bind(track).fetch_optional(&self.db).await?;
        let embedded = if let Some(path) = file.and_then(|path| self.storage.existing(&path)) {
            tokio::task::spawn_blocking(move || {
                media::tags::read(&path).and_then(|tags| tags.cover.map(|bytes| (bytes, tags.album)))
            })
            .await?
        } else {
            None
        };
        let local = embedded.and_then(|(bytes, album)| {
            row.album_title
                .clone()
                .or(album)
                .filter(|title| !title.trim().is_empty())
                .map(|album_title| super::deezer::TrackCover { album_title, bytes })
        });
        let Some(cover) = (match local {
            Some(cover) => Some(cover),
            None => self.deezer.track_cover(&row.title, &row.artist_name, row.album_title.as_deref()).await?,
        }) else {
            return Ok(Outcome::NotFound);
        };
        if cover.bytes.is_empty() {
            return Ok(Outcome::NotFound);
        }
        let set = covers::renditions(cover.bytes).await?;
        // Keep network requests and image processing outside the transaction.
        let mut tx = self.db.begin().await?;
        let current = sqlx::query!("SELECT album_id FROM tracks WHERE id = $1 FOR UPDATE", track)
            .fetch_optional(&mut *tx)
            .await?;
        let Some(current) = current.filter(|current| current.album_id == row.album_id) else {
            return Ok(Outcome::Skipped);
        };
        let unchanged: bool = sqlx::query_scalar("SELECT title=$2 AND artist_id=$3 FROM tracks WHERE id=$1")
            .bind(track)
            .bind(&row.title)
            .bind(row.artist_id)
            .fetch_one(&mut *tx)
            .await?;
        if !unchanged {
            return Ok(Outcome::Skipped);
        }
        let album = match current.album_id {
            Some(album) => album,
            None => tags::album(&mut tx, &cover.album_title, row.artist_id, row.year).await?,
        };
        let available = sqlx::query_scalar!("SELECT cover_path IS NULL FROM albums WHERE id = $1 FOR UPDATE", album)
            .fetch_one(&mut *tx)
            .await?;
        let current_path: Option<String> =
            sqlx::query_scalar("SELECT cover_path FROM albums WHERE id=$1").bind(album).fetch_one(&mut *tx).await?;
        if available != Some(true) && self.image_exists(current_path.as_deref()) {
            if current.album_id.is_none() {
                sqlx::query!("UPDATE tracks SET album_id = $2 WHERE id = $1", track, album).execute(&mut *tx).await?;
                tx.commit().await?;
            }
            return Ok(Outcome::Skipped);
        }
        let path = self.storage.save_renditions(COVER_DIRECTORY, Uuid::now_v7(), &set).await?;
        let result: anyhow::Result<()> = async {
            sqlx::query!("UPDATE albums SET cover_path = $2 WHERE id = $1", album, path).execute(&mut *tx).await?;
            sqlx::query!("UPDATE tracks SET album_id = $2 WHERE id = $1", track, album).execute(&mut *tx).await?;
            tx.commit().await?;
            Ok(())
        }
        .await;
        if let Err(error) = result {
            self.storage.delete_cover(&path);
            return Err(error);
        }
        Ok(Outcome::Saved)
    }

    async fn artist_image(&self, artist: Uuid) -> anyhow::Result<Outcome> {
        let row =
            sqlx::query!("SELECT name, image_path FROM artists WHERE id = $1", artist).fetch_optional(&self.db).await?;
        let Some(row) = row.filter(|row| !self.image_exists(row.image_path.as_deref())) else {
            return Ok(Outcome::Skipped);
        };

        let Some(bytes) = self.deezer.artist_image(&row.name).await? else { return Ok(Outcome::NotFound) };
        if bytes.is_empty() {
            return Ok(Outcome::NotFound);
        }
        let set = covers::renditions(bytes).await?;
        let path = self.storage.save_renditions(ARTIST_IMAGE_DIRECTORY, Uuid::now_v7(), &set).await?;

        let updated = sqlx::query(
            "UPDATE artists SET image_path=$2 WHERE id=$1 AND image_path IS NOT DISTINCT FROM $3 AND name=$4",
        )
        .bind(artist)
        .bind(&path)
        .bind(&row.image_path)
        .bind(&row.name)
        .execute(&self.db)
        .await;
        match updated {
            Ok(done) if done.rows_affected() == 1 => Ok(Outcome::Saved),
            Ok(_) => {
                self.storage.delete_cover(&path);
                Ok(Outcome::Skipped)
            }
            Err(error) => {
                self.storage.delete_cover(&path);
                Err(error.into())
            }
        }
    }

    async fn lyrics(&self, track: Uuid) -> anyhow::Result<Outcome> {
        #[derive(sqlx::FromRow)]
        struct Row {
            title: String,
            duration_seconds: i32,
            artist_name: String,
            album_title: Option<String>,
            content_hash: String,
            manual: bool,
        }
        let row = sqlx::query_as::<_, Row>(
            "SELECT t.title, t.duration_seconds, t.content_hash, ar.name AS artist_name, al.title AS album_title,
                      EXISTS (SELECT 1 FROM track_lyrics l WHERE l.track_id = t.id AND l.source=1) AS manual
               FROM tracks t JOIN artists ar ON ar.id = t.artist_id LEFT JOIN albums al ON al.id = t.album_id
               WHERE t.id = $1",
        )
        .bind(track)
        .fetch_optional(&self.db)
        .await?;
        let Some(row) = row.filter(|row| !row.manual) else { return Ok(Outcome::Skipped) };

        let query = LyricsQuery {
            title: row.title,
            artist: row.artist_name,
            album: row.album_title,
            duration_seconds: row.duration_seconds,
        };
        let found = self.lyrics_providers.lookup(&query).await?;
        let Some(found) = found.best else {
            return Ok(if found.instrumental { Outcome::Instrumental } else { Outcome::NotFound });
        };
        save_lyrics(&self.db, track, &query, &row.content_hash, &found).await
    }
}

async fn save_lyrics(
    db: &PgPool,
    track: Uuid,
    query: &LyricsQuery,
    hash: &str,
    found: &Candidate,
) -> anyhow::Result<Outcome> {
    // The network is finished. Lock the identity only for the short write transaction.
    let mut tx = db.begin().await?;
    let unchanged: Option<Uuid> = sqlx::query_scalar(
        "SELECT t.id FROM tracks t JOIN artists ar ON ar.id=t.artist_id
             LEFT JOIN albums al ON al.id=t.album_id
             WHERE t.id=$1 AND t.title=$2 AND ar.name=$3 AND t.duration_seconds=$4 AND t.content_hash=$5
               AND al.title IS NOT DISTINCT FROM $6 FOR SHARE OF t,ar",
    )
    .bind(track)
    .bind(&query.title)
    .bind(&query.artist)
    .bind(query.duration_seconds)
    .bind(hash)
    .bind(&query.album)
    .fetch_optional(&mut *tx)
    .await?;
    if unchanged.is_none() {
        return Ok(Outcome::Skipped);
    }
    let saved = sqlx::query(
            "INSERT INTO track_lyrics (track_id,plain,synced,source,updated_at,provider,source_format,original_lyrics,attribution,match_exact,match_distance_ms)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT (track_id) DO UPDATE SET plain=EXCLUDED.plain,synced=EXCLUDED.synced,
                source=EXCLUDED.source,updated_at=EXCLUDED.updated_at,provider=EXCLUDED.provider,
                source_format=EXCLUDED.source_format,original_lyrics=EXCLUDED.original_lyrics,attribution=EXCLUDED.attribution,
                match_exact=EXCLUDED.match_exact,match_distance_ms=EXCLUDED.match_distance_ms
             WHERE track_lyrics.source<>1
               AND (EXCLUDED.match_exact,EXCLUDED.quality,-EXCLUDED.match_distance_ms)
                   > (track_lyrics.match_exact,track_lyrics.quality,-track_lyrics.match_distance_ms)
               AND char_length(regexp_replace(EXCLUDED.plain,'[[:space:][:punct:]]','','g'))*10
                   >=char_length(regexp_replace(track_lyrics.plain,'[[:space:][:punct:]]','','g'))*7",
        )
        .bind(track)
        .bind(&found.parsed.plain)
        .bind(sqlx::types::Json(&found.parsed.lines))
        .bind(LyricsSource::Provider as i32)
        .bind(Utc::now())
        .bind(found.provider).bind(&found.format).bind(&found.original).bind(&found.attribution)
        .bind(found.exact).bind(found.duration_difference)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(if saved.rows_affected() == 1 { Outcome::Saved } else { Outcome::Skipped })
}

pub fn spawn(
    enrichment: Enrichment,
    queue: EnrichmentQueue,
    mut requests: mpsc::Receiver<EnrichmentRequest>,
    cancel: CancellationToken,
) -> Vec<tokio::task::JoinHandle<()>> {
    let wake = Arc::new(tokio::sync::Notify::new());
    let mut handles = Vec::new();
    let signal = Arc::clone(&wake);
    let stop = cancel.clone();
    handles.push(tokio::spawn(async move {
        loop {
            tokio::select! {
                () = stop.cancelled() => return,
                request = requests.recv() => match request {
                    Some(request) => { queue.finished(request.track); signal.notify_waiters(); }
                    None => return,
                }
            }
        }
    }));
    for kind in ["cover", "artist", "lyrics"] {
        let (enrichment, wake, cancel) = (enrichment.clone(), Arc::clone(&wake), cancel.clone());
        handles.push(tokio::spawn(async move {
            let mut next_seed = tokio::time::Instant::now() + BACKFILL_DELAY;
            loop {
                if cancel.is_cancelled() { return; }
                if tokio::time::Instant::now() >= next_seed {
                    let delay = match super::enrichment_jobs::seed(&enrichment.db, kind).await {
                        Ok(500) => Duration::from_secs(5),
                        Ok(_) => Duration::from_secs(86_400),
                        Err(error) => { tracing::error!("Enrichment {kind} discovery failed: {error}"); Duration::from_secs(30) }
                    };
                    next_seed = tokio::time::Instant::now() + delay;
                }
                let job = match super::enrichment_jobs::claim(&enrichment.db, kind).await {
                    Ok(job) => job,
                    Err(error) => { tracing::error!("Enrichment {kind} claim failed: {error}"); None }
                };
                let Some(job) = job else {
                    tokio::select! {
                        () = cancel.cancelled() => return,
                        () = wake.notified() => {},
                        () = tokio::time::sleep(next_seed.saturating_duration_since(tokio::time::Instant::now()).min(Duration::from_secs(30))) => {},
                    }
                    continue;
                };
                let result = tokio::select! {
                    () = cancel.cancelled() => return,
                    result = async {
                        match kind {
                            "cover" => enrichment.track_cover(job.entity_id).await,
                            "artist" => enrichment.artist_image(job.entity_id).await,
                            _ => enrichment.lyrics(job.entity_id).await,
                        }
                    } => result,
                };
                let skipped = matches!(result, Ok(Outcome::Skipped));
                let (outcome, error) = match result {
                    Ok(Outcome::Saved) => { tracing::info!("Enrichment {kind} {} saved", job.entity_id); ("saved", None) }
                    Ok(Outcome::Skipped) => ("skipped", None),
                    Ok(Outcome::NotFound) => ("not_found", None),
                    Ok(Outcome::Instrumental) => ("instrumental", None),
                    Err(error) => {
                        tracing::warn!("Enrichment {kind} {} failed; scheduling retry: {error:#}", job.entity_id);
                        ("failed", Some(format!("{error:#}").chars().take(2000).collect()))
                    }
                };
                if let Err(error) = super::enrichment_jobs::finish(&enrichment.db, kind, &job, outcome, error).await {
                    tracing::error!("Enrichment {kind} completion failed; lease will expire: {error}");
                }
                if !skipped && kind != "lyrics" && pause(&cancel, ARTIST_PAUSE).await { return; }
            }
        }));
    }
    handles
}

async fn pause(cancel: &CancellationToken, how_long: Duration) -> bool {
    tokio::select! {
        () = cancel.cancelled() => true,
        () = tokio::time::sleep(how_long) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[sqlx::test(migrations = "../../../db/migrations")]
    #[cfg_attr(not(feature = "integration-tests"), ignore = "requires local PostgreSQL")]
    async fn lyric_upgrades_preserve_manual_edits_and_reject_stale_recordings(db: PgPool) -> anyhow::Result<()> {
        let artist = Uuid::now_v7();
        let track = Uuid::now_v7();
        sqlx::query("INSERT INTO artists(id,name,normalized_name,created_at) VALUES ($1,'Artist','artist',now())")
            .bind(artist)
            .execute(&db)
            .await?;
        sqlx::query("INSERT INTO tracks(id,title,normalized_title,artist_id,duration_seconds,file_path,original_file_name,mime_type,file_size,content_hash,created_at) VALUES ($1,'Song','song',$2,180,'music/test.mp3','test.mp3','audio/mpeg',100,'hash',now())").bind(track).bind(artist).execute(&db).await?;
        let query = LyricsQuery { title: "Song".into(), artist: "Artist".into(), album: None, duration_seconds: 180 };
        let mut found = Candidate {
            parsed: crate::catalog::lyrics::parse_format("Hello world", "plain", 180000)?,
            provider: "Test",
            format: "plain".into(),
            original: "Hello world".into(),
            attribution: serde_json::json!({}),
            exact: true,
            duration_difference: 0,
        };
        assert_eq!(save_lyrics(&db, track, &query, "hash", &found).await?, Outcome::Saved);
        found.parsed = crate::catalog::lyrics::parse_format("[00:01]<00:01>Hello <00:02>world<00:03>", "lrc", 180000)?;
        assert_eq!(save_lyrics(&db, track, &query, "hash", &found).await?, Outcome::Saved);
        let dto = crate::catalog::lyrics::get(&db, track).await?.unwrap();
        assert_eq!(dto.sync_type, "word");
        assert_eq!(dto.lines[0].words.len(), 2);
        crate::catalog::lyrics::replace(&db, track, Some("Manual text")).await?;
        assert_eq!(save_lyrics(&db, track, &query, "hash", &found).await?, Outcome::Skipped);
        assert_eq!(crate::catalog::lyrics::get(&db, track).await?.unwrap().plain, "Manual text");
        assert_eq!(save_lyrics(&db, track, &query, "different-hash", &found).await?, Outcome::Skipped);
        Ok(())
    }

    #[sqlx::test(migrations = "../../../db/migrations")]
    #[cfg_attr(not(feature = "integration-tests"), ignore = "requires local PostgreSQL and ffmpeg")]
    async fn embedded_art_repairs_old_tracks_and_missing_files_without_replacing_existing_art(
        db: PgPool,
    ) -> anyhow::Result<()> {
        let root = std::env::temp_dir().join(format!("caimack-enrichment-{}", Uuid::now_v7()));
        let storage = Storage::open(&root)?;
        let audio = root.join("music/test.flac");
        let image = root.join("image.png");
        assert!(
            std::process::Command::new("ffmpeg")
                .args([
                    "-nostdin",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "anullsrc=r=44100:cl=stereo",
                    "-t",
                    "1",
                    "-y"
                ])
                .arg(&audio)
                .status()?
                .success()
        );
        assert!(
            std::process::Command::new("ffmpeg")
                .args([
                    "-nostdin",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=red:s=32x32",
                    "-frames:v",
                    "1",
                    "-y"
                ])
                .arg(&image)
                .status()?
                .success()
        );
        media::tags::write(
            &audio,
            &media::tags::AudioTags {
                title: "Song".into(),
                artists: vec!["Artist".into()],
                album_artists: vec![],
                album: Some("Old Album".into()),
                genre: None,
                year: None,
                track_number: None,
                disc_number: None,
                cover: Some(std::fs::read(&image)?),
                lyrics: None,
            },
        )?;
        let artist = Uuid::now_v7();
        let track = Uuid::now_v7();
        sqlx::query("INSERT INTO artists(id,name,normalized_name,created_at) VALUES ($1,'Artist','artist',now())")
            .bind(artist)
            .execute(&db)
            .await?;
        sqlx::query("INSERT INTO tracks(id,title,normalized_title,artist_id,duration_seconds,file_path,original_file_name,mime_type,file_size,content_hash,created_at)
            VALUES ($1,'Song','song',$2,1,'music/test.flac','test.flac','audio/flac',100,'hash',now())")
            .bind(track).bind(artist).execute(&db).await?;
        let enrichment = Enrichment {
            db: db.clone(),
            storage: storage.clone(),
            deezer: Deezer::new("http://127.0.0.1:9"),
            lyrics_providers: LyricsProviders::new(super::super::lrclib::Lrclib::new("http://127.0.0.1:9"), None),
        };
        assert_eq!(enrichment.track_cover(track).await?, Outcome::Saved);
        let path: String =
            sqlx::query_scalar("SELECT cover_path FROM albums WHERE id=(SELECT album_id FROM tracks WHERE id=$1)")
                .bind(track)
                .fetch_one(&db)
                .await?;
        assert!(storage.existing(&path).is_some());
        assert_eq!(enrichment.track_cover(track).await?, Outcome::Skipped);
        storage.delete_cover(&path);
        assert_eq!(enrichment.track_cover(track).await?, Outcome::Saved);
        std::fs::remove_dir_all(root)?;
        Ok(())
    }
}
