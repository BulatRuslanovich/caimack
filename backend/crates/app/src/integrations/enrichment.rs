// SPDX-License-Identifier: MIT
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
use super::lrclib::{Lrclib, LyricsLookup, LyricsQuery};
use crate::catalog::lyrics::{self, LyricsSource};
use crate::catalog::tags;
use crate::covers;
use crate::storage::{ARTIST_IMAGE_DIRECTORY, COVER_DIRECTORY, Storage};

const CAPACITY: usize = 2048;
const ARTIST_PAUSE: Duration = Duration::from_secs(2);
const LYRICS_PAUSE: Duration = Duration::from_millis(500);
const BACKFILL_DELAY: Duration = Duration::from_secs(60);
const BACKFILL_CHUNK: usize = 20;

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
    pub lrclib: Lrclib,
}

#[derive(Debug, PartialEq, Eq)]
enum Outcome {
    Saved,
    Skipped,
    NotFound,
    Instrumental,
}

impl Enrichment {
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
        let Some(row) = row.filter(|row| row.cover_path.is_none()) else { return Ok(Outcome::Skipped) };
        let Some(cover) = self.deezer.track_cover(&row.title, &row.artist_name, row.album_title.as_deref()).await?
        else {
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
        let album = match current.album_id {
            Some(album) => album,
            None => tags::album(&mut tx, &cover.album_title, row.artist_id, row.year).await?,
        };
        let available = sqlx::query_scalar!("SELECT cover_path IS NULL FROM albums WHERE id = $1 FOR UPDATE", album)
            .fetch_one(&mut *tx)
            .await?;
        if available != Some(true) {
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
        let Some(row) = row.filter(|row| row.image_path.is_none()) else { return Ok(Outcome::Skipped) };

        let Some(bytes) = self.deezer.artist_image(&row.name).await? else { return Ok(Outcome::NotFound) };
        if bytes.is_empty() {
            return Ok(Outcome::NotFound);
        }
        let set = covers::renditions(bytes).await?;
        let path = self.storage.save_renditions(ARTIST_IMAGE_DIRECTORY, artist, &set).await?;

        let updated =
            sqlx::query!("UPDATE artists SET image_path = $2 WHERE id = $1 AND image_path IS NULL", artist, path)
                .execute(&self.db)
                .await;
        match updated {
            Ok(done) if done.rows_affected() == 1 => Ok(Outcome::Saved),
            Ok(_) => Ok(Outcome::Skipped),
            Err(error) => {
                self.storage.delete_cover(&path);
                Err(error.into())
            }
        }
    }

    async fn lyrics(&self, track: Uuid) -> anyhow::Result<Outcome> {
        let row = sqlx::query!(
            r#"SELECT t.title, t.duration_seconds, ar.name AS artist_name, al.title AS "album_title?",
                      EXISTS (SELECT 1 FROM track_lyrics l WHERE l.track_id = t.id) AS "has_lyrics!"
               FROM tracks t JOIN artists ar ON ar.id = t.artist_id LEFT JOIN albums al ON al.id = t.album_id
               WHERE t.id = $1"#,
            track
        )
        .fetch_optional(&self.db)
        .await?;
        let Some(row) = row.filter(|row| !row.has_lyrics) else { return Ok(Outcome::Skipped) };

        let query = LyricsQuery {
            title: row.title,
            artist: row.artist_name,
            album: row.album_title,
            duration_seconds: row.duration_seconds,
        };
        let text = match self.lrclib.lookup(&query).await? {
            LyricsLookup::Found(text) => text,
            LyricsLookup::NotFound => return Ok(Outcome::NotFound),
            LyricsLookup::Instrumental => return Ok(Outcome::Instrumental),
        };
        let parsed = lyrics::parse(Some(&text));
        if parsed.is_empty() {
            return Ok(Outcome::NotFound);
        }

        sqlx::query!(
            "INSERT INTO track_lyrics (track_id, plain, synced, source, updated_at) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (track_id) DO NOTHING",
            track,
            parsed.plain,
            sqlx::types::Json(&parsed.lines) as _,
            LyricsSource::Provider as i32,
            Utc::now()
        )
        .execute(&self.db)
        .await?;
        Ok(Outcome::Saved)
    }
}

pub fn spawn(
    enrichment: Enrichment,
    queue: EnrichmentQueue,
    mut requests: mpsc::Receiver<EnrichmentRequest>,
    cancel: CancellationToken,
) -> Vec<tokio::task::JoinHandle<()>> {
    let backfill = {
        let (db, queue, cancel) = (enrichment.db.clone(), queue.clone(), cancel.clone());
        tokio::spawn(async move {
            tokio::select! {
                () = cancel.cancelled() => return,
                () = tokio::time::sleep(BACKFILL_DELAY) => {}
            }
            match sqlx::query_scalar!("SELECT id FROM artists WHERE image_path IS NULL").fetch_all(&db).await {
                Ok(artists) => {
                    for chunk in artists.chunks(BACKFILL_CHUNK) {
                        queue.try_enqueue(EnrichmentRequest { track: None, artists: chunk.to_vec() });
                    }
                    tracing::debug!("Queued {} artists without a photo for a lookup", artists.len());
                }
                Err(error) => tracing::error!("Queueing artists without a photo failed: {error}"),
            }
        })
    };

    let worker = tokio::spawn(async move {
        loop {
            let request = tokio::select! {
                () = cancel.cancelled() => break,
                request = requests.recv() => request,
            };
            let Some(request) = request else { break };

            let mut seen = HashSet::new();
            for artist in request.artists.iter().filter(|artist| seen.insert(**artist)) {
                report(&format!("Artist image enrichment for {artist}"), enrichment.artist_image(*artist).await);
                if pause(&cancel, ARTIST_PAUSE).await {
                    return;
                }
            }
            if let Some(track) = request.track {
                report(&format!("Cover enrichment for track {track}"), enrichment.track_cover(track).await);
                if pause(&cancel, ARTIST_PAUSE).await {
                    return;
                }
                report(&format!("Lyrics enrichment for track {track}"), enrichment.lyrics(track).await);
                queue.finished(Some(track));
                if pause(&cancel, LYRICS_PAUSE).await {
                    return;
                }
            }
        }
    });

    vec![backfill, worker]
}

async fn pause(cancel: &CancellationToken, how_long: Duration) -> bool {
    tokio::select! {
        () = cancel.cancelled() => true,
        () = tokio::time::sleep(how_long) => false,
    }
}

fn report(step: &str, result: anyhow::Result<Outcome>) {
    match result {
        Ok(Outcome::Saved) => tracing::info!("{step} finished with Saved"),
        Ok(outcome) => tracing::debug!("{step} finished with {outcome:?}"),
        Err(error) => tracing::warn!("{step} failed: {error:#}"),
    }
}
