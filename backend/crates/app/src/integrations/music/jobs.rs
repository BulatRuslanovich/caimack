// SPDX-License-Identifier: AGPL-3.0-only

use std::time::Duration;

use futures_util::{FutureExt, StreamExt, stream::FuturesUnordered};
use media::tags::{self, AudioMetadata, AudioTags};
use serde_json::{Value, json};
use sqlx::{PgConnection, types::Json};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::audio::Audio;
use super::model::{query, rank, same_recording};
use super::{Candidate, ImportItem, ImportRequest, ImportSummary, Music, PlaylistSnapshot, Recording};
use crate::upload::UploadMode;
use crate::{AppError, AppResult};

pub(super) const MAX_PLAYLIST_ITEMS: usize = 10_000;

#[derive(sqlx::FromRow)]
struct Claim {
    id: Uuid,
    user_id: Uuid,
    lease: Uuid,
    request: Json<ImportRequest>,
    title: Option<String>,
}

#[derive(sqlx::FromRow)]
struct Item {
    position: i32,
    recording: Json<Candidate>,
    state: String,
    track_id: Option<Uuid>,
    error: Option<String>,
    attempts: Value,
    upgrade: Option<Json<Candidate>>,
    selection: Option<Json<super::TrackSelection>>,
}

#[derive(sqlx::FromRow)]
struct LocalTrack {
    id: Uuid,
    artist: String,
    duration: i32,
    codec: Option<String>,
    file_path: String,
    content_hash: String,
}

impl Music {
    pub async fn enqueue(&self, user: Uuid, request: ImportRequest) -> AppResult<Uuid> {
        match &request {
            ImportRequest::Track { candidate, sources, search_query, .. } => {
                let available = self.sources();
                if !available.contains(&candidate.source.as_str())
                    || candidate.restricted
                    || candidate.id.is_empty()
                    || candidate.id.len() > 500
                    || candidate.track.artist.len() > 2000
                    || candidate.track.title.len() > 2000
                    || sources.len() > available.len()
                    || search_query.as_ref().is_some_and(|query| query.chars().count() > 200)
                {
                    return Err(AppError::validation("Invalid music track selection."));
                }
            }
            ImportRequest::Playlist { url, sources, .. } => {
                if url.len() > 1000 || sources.len() > self.sources().len() || sources.is_empty() {
                    return Err(AppError::validation("Select music sources for this import."));
                }
                self.playlist_link(url)?;
            }
        }
        let preview = match &request {
            ImportRequest::Playlist { url, preview_id: Some(id), allow_partial, .. } => {
                let snapshot = self.read_preview(user, *id, url)?;
                if snapshot.partial && !allow_partial {
                    return Err(AppError::validation("Only part of the playlist could be read."));
                }
                Some(snapshot)
            }
            _ => None,
        };
        let id = Uuid::now_v7();
        let mut tx = self.uploads.db.begin().await?;
        let written = sqlx::query(
            "INSERT INTO music_imports (id,user_id,request)
             SELECT $1,$2,$3 WHERE (SELECT count(*) FROM music_imports WHERE user_id=$2 AND state IN ('queued','running','waiting')) < 20",
        )
        .bind(id).bind(user).bind(Json(request)).execute(&mut *tx).await?;
        if written.rows_affected() == 0 {
            return Err(AppError::conflict("Too many imports are already queued."));
        }
        if let Some(preview) = preview {
            record_snapshot(&mut tx, id, None, preview).await?;
        }
        tx.commit().await?;
        Ok(id)
    }

    pub async fn imports(&self, user: Uuid) -> AppResult<Vec<ImportSummary>> {
        Ok(sqlx::query_as(
            "SELECT j.id,j.title,j.state,j.error,j.playlist_id,j.partial,j.omitted,
                count(i.position) AS total, count(i.position) FILTER (WHERE i.state<>'queued') AS done,
                count(i.position) FILTER (WHERE i.state IN ('failed','review')) AS failed
             FROM (SELECT * FROM music_imports WHERE user_id=$1 ORDER BY created_at DESC LIMIT 40) j
             LEFT JOIN music_import_items i ON i.job_id=j.id
             GROUP BY j.id,j.title,j.state,j.error,j.playlist_id,j.partial,j.omitted,j.created_at
             ORDER BY j.created_at DESC",
        )
        .bind(user)
        .fetch_all(&self.uploads.db)
        .await?)
    }

    pub async fn items(&self, user: Uuid, job: Uuid, offset: i64) -> AppResult<Vec<ImportItem>> {
        let rows: Vec<Item> = sqlx::query_as(
            "SELECT i.position,i.recording,i.state,i.track_id,i.error,i.attempts,i.upgrade,i.selection FROM music_import_items i
             JOIN music_imports j ON j.id=i.job_id WHERE j.id=$1 AND j.user_id=$2 ORDER BY i.position LIMIT 100 OFFSET $3",
        ).bind(job).bind(user).bind(offset.max(0)).fetch_all(&self.uploads.db).await?;
        Ok(rows
            .into_iter()
            .map(|row| ImportItem {
                position: row.position,
                track: row.recording.0,
                state: row.state,
                track_id: row.track_id,
                error: row.error,
                attempts: row.attempts,
                upgrade: row.upgrade.map(|candidate| candidate.0),
            })
            .collect())
    }

    pub async fn cancel(&self, user: Uuid, job: Uuid) -> AppResult<()> {
        sqlx::query("UPDATE music_imports SET state='cancelled',lease=NULL,locked_until=NULL WHERE id=$1 AND user_id=$2 AND state IN ('queued','waiting','running')")
            .bind(job).bind(user).execute(&self.uploads.db).await?;
        Ok(())
    }

    pub async fn retry(&self, user: Uuid, job: Uuid) -> AppResult<()> {
        let mut tx = self.uploads.db.begin().await?;
        let changed = sqlx::query(
            "UPDATE music_imports SET state='queued',error=NULL,runnable_at=now()
             WHERE id=$1 AND user_id=$2 AND state IN ('finished','cancelled','waiting')",
        )
        .bind(job)
        .bind(user)
        .execute(&mut *tx)
        .await?;
        if changed.rows_affected() == 0 {
            return Err(AppError::conflict("This import cannot be retried right now."));
        }
        sqlx::query(
            "UPDATE music_import_items SET state='queued',error=NULL
             WHERE job_id=$1 AND (state IN ('failed','review') OR track_id IS NULL)",
        )
        .bind(job)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn choose(&self, user: Uuid, job: Uuid, position: i32, selected: super::TrackSelection) -> AppResult<()> {
        if !self.sources().contains(&selected.candidate.source.as_str())
            || selected.candidate.restricted
            || selected.candidate.id.is_empty()
            || selected.candidate.id.len() > 500
            || !(2..=200).contains(&selected.query.chars().count())
        {
            return Err(AppError::validation("Invalid music track selection."));
        }
        let mut tx = self.uploads.db.begin().await?;
        let updated = sqlx::query(
            "UPDATE music_imports SET state='queued',error=NULL,runnable_at=now()
              WHERE id=$1 AND user_id=$2 AND state='finished'
                AND EXISTS (SELECT 1 FROM music_import_items WHERE job_id=$1 AND position=$3 AND state IN ('failed','review'))",
        ).bind(job).bind(user).bind(position).execute(&mut *tx).await?;
        if updated.rows_affected() == 0 {
            return Err(AppError::conflict("This playlist position cannot be changed right now."));
        }
        sqlx::query(
            "UPDATE music_import_items SET state='queued',error=NULL,selection=$3 WHERE job_id=$1 AND position=$2",
        )
        .bind(job)
        .bind(position)
        .bind(Json(selected))
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn upgrade(&self, user: Uuid, job: Uuid, position: i32) -> AppResult<()> {
        type Offer = (Json<Candidate>, Json<Candidate>, String, Uuid, Json<ImportRequest>);
        let (target, candidate, hash, track_id, request): Offer = sqlx::query_as(
            "SELECT i.recording,i.upgrade,i.upgrade_hash,i.track_id,j.request FROM music_import_items i
             JOIN music_imports j ON j.id=i.job_id WHERE j.id=$1 AND j.user_id=$2 AND i.position=$3
                AND j.state='finished' AND i.upgrade IS NOT NULL AND i.track_id IS NOT NULL",
        )
        .bind(job)
        .bind(user)
        .bind(position)
        .fetch_optional(&self.uploads.db)
        .await?
        .ok_or_else(|| AppError::not_found("This upgrade is unavailable."))?;
        let local = self
            .local(&target.track)
            .await?
            .filter(|track| track.id == track_id && track.content_hash == hash)
            .ok_or_else(|| AppError::conflict("The library copy changed. Look for an upgrade again."))?;
        let generated = query(&target.track);
        let (search_query, native_playlist) = match &request.0 {
            ImportRequest::Track { search_query, .. } => {
                let original = (candidate.source == target.source && candidate.id == target.id)
                    .then_some(search_query.as_deref())
                    .flatten();
                (original.unwrap_or(&generated), None)
            }
            ImportRequest::Playlist { url, .. } => {
                let native = (candidate.source == target.source && candidate.id == target.id).then_some(url.as_str());
                (generated.as_str(), native)
            }
        };
        let audio = self.stage(user, &candidate, search_query, native_playlist).await?;
        let mut metadata = audio.metadata().await?;
        validate_duration(&target.track, &candidate.track, &metadata)?;
        if metadata.codec != Some("flac") || !self.same_audio(&local, &audio, metadata.duration_seconds).await {
            return Err(AppError::conflict("The source no longer has the verified FLAC copy."));
        }
        if let Some(path) = self.uploads.storage.existing(&local.file_path)
            && let Some(current) =
                tokio::task::spawn_blocking(move || tags::read(&path)).await.map_err(AppError::internal)?
        {
            metadata.album_artists = current.album_artists;
            metadata.album = current.album;
            metadata.genre = current.genre;
            metadata.year = current.year;
            metadata.track_number = current.track_number;
            metadata.disc_number = current.disc_number;
            metadata.cover = current.cover;
            metadata.lyrics = current.lyrics;
        }
        self.publish(user, &target, &candidate, &audio, metadata, UploadMode::Replace { id: track_id, hash }).await?;
        sqlx::query("UPDATE music_import_items SET upgrade=NULL,upgrade_hash=NULL WHERE job_id=$1 AND position=$2")
            .bind(job)
            .bind(position)
            .execute(&self.uploads.db)
            .await?;
        Ok(())
    }

    pub fn spawn(self, shutdown: CancellationToken) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            loop {
                let claim = tokio::select! {
                    () = shutdown.cancelled() => break,
                    claim = self.claim() => claim,
                };
                match claim {
                    Ok(Some(claim)) => self.run_claim(&claim, &shutdown).await,
                    Ok(None) => {
                        tokio::select! {
                            () = shutdown.cancelled() => break,
                            () = tokio::time::sleep(Duration::from_secs(1)) => (),
                        }
                    }
                    Err(error) => {
                        tracing::warn!(%error, "Could not claim a music import");
                        tokio::select! {
                            () = shutdown.cancelled() => break,
                            () = tokio::time::sleep(Duration::from_secs(5)) => (),
                        }
                    }
                }
            }
        })
    }

    async fn claim(&self) -> AppResult<Option<Claim>> {
        Ok(sqlx::query_as(
            "WITH next AS (
                SELECT id FROM music_imports
                WHERE state IN ('queued','running','waiting') AND runnable_at<=now()
                  AND (locked_until IS NULL OR locked_until<now())
                ORDER BY runnable_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1
             )
             UPDATE music_imports j SET state='running',lease=$1,locked_until=now()+interval '45 seconds'
             FROM next WHERE j.id=next.id RETURNING j.id,j.user_id,j.lease,j.request,j.title",
        )
        .bind(Uuid::now_v7())
        .fetch_optional(&self.uploads.db)
        .await?)
    }

    async fn run_claim(&self, job: &Claim, shutdown: &CancellationToken) {
        let mut heartbeat = tokio::time::interval(Duration::from_secs(10));
        heartbeat.tick().await;
        let work = self.step(job).boxed();
        tokio::pin!(work);
        loop {
            tokio::select! {
                () = shutdown.cancelled() => {
                    let _ = self.release(job, "queued", None).await;
                    return;
                }
                result = &mut work => {
                    if let Err(error) = result {
                        tracing::warn!(import_id = %job.id, %error, "Music import step failed");
                        let _ = self.release(job, "finished", Some(&reason(&error))).await;
                    }
                    return;
                }
                _ = heartbeat.tick() => match sqlx::query(
                    "UPDATE music_imports SET locked_until=now()+interval '45 seconds' WHERE id=$1 AND lease=$2 AND state='running'",
                ).bind(job.id).bind(job.lease).execute(&self.uploads.db).await {
                    Ok(result) if result.rows_affected() == 1 => (),
                    _ => return,
                }
            }
        }
    }

    async fn release(&self, job: &Claim, state: &str, error: Option<&str>) -> AppResult<()> {
        sqlx::query(
            "UPDATE music_imports SET state=$3,error=$4,runnable_at=now()+
                CASE WHEN $3='waiting' THEN interval '12 seconds' ELSE interval '0 seconds' END,
                lease=NULL,locked_until=NULL WHERE id=$1 AND lease=$2",
        )
        .bind(job.id)
        .bind(job.lease)
        .bind(state)
        .bind(error)
        .execute(&self.uploads.db)
        .await?;
        Ok(())
    }

    async fn step(&self, job: &Claim) -> AppResult<()> {
        if job.title.is_none() {
            return self.read_request(job).await;
        }
        let item: Option<Item> = sqlx::query_as(
            "SELECT position,recording,state,track_id,error,attempts,upgrade,selection FROM music_import_items
             WHERE job_id=$1 AND state='queued' ORDER BY position LIMIT 1",
        )
        .bind(job.id)
        .fetch_optional(&self.uploads.db)
        .await?;
        if let Some(item) = item {
            let required = match &job.request.0 {
                ImportRequest::Track { candidate, automatic: false, .. } => Some(candidate.source.as_str()),
                ImportRequest::Track { sources, .. } | ImportRequest::Playlist { sources, .. } => {
                    if let [source] = sources.as_slice() { Some(source.as_str()) } else { None }
                }
            };
            let source = item.selection.as_ref().map(|selection| selection.candidate.source.as_str()).or(required);
            if source
                .and_then(|id| self.provider(id))
                .is_some_and(|provider| provider.status(job.user_id).needs_connection())
                && self.local(&item.recording.track).await?.is_none()
            {
                return self.release(job, "waiting", Some("Connect the music source to continue.")).await;
            }
            self.acquire(job, &item).await?;
            return self.release(job, "queued", None).await;
        }
        self.finish(job).await
    }

    async fn read_request(&self, job: &Claim) -> AppResult<()> {
        let snapshot = match &job.request.0 {
            ImportRequest::Track { candidate, .. } => PlaylistSnapshot {
                name: format!("{} — {}", candidate.track.artist, candidate.track.title),
                tracks: vec![candidate.clone()],
                omitted: 0,
                partial: false,
            },
            ImportRequest::Playlist { url, allow_partial, .. } => {
                let link = self.playlist_link(url)?;
                if link.provider.status(job.user_id).needs_connection() {
                    return self.release(job, "waiting", Some("Connect the playlist source to continue.")).await;
                }
                let snapshot = match link.provider.playlist(job.user_id, &link.id).await {
                    Ok(snapshot) => snapshot,
                    Err(_) if link.provider.status(job.user_id).needs_connection() => {
                        return self.release(job, "waiting", Some("Connect the playlist source to continue.")).await;
                    }
                    Err(error) => return Err(error),
                };
                if snapshot.partial && !allow_partial {
                    return self.release(job, "finished", Some("Only part of the playlist could be read.")).await;
                }
                snapshot
            }
        };
        let mut tx = self.uploads.db.begin().await?;
        record_snapshot(&mut tx, job.id, Some(job.lease), snapshot).await?;
        tx.commit().await?;
        Ok(())
    }

    async fn candidates(
        &self,
        job: &Claim,
        target: &Candidate,
        search_query: &str,
        sources: &[String],
        playlist: bool,
    ) -> AppResult<Vec<Candidate>> {
        let configured: Vec<_> = self
            .providers
            .iter()
            .filter(|provider| {
                provider.capabilities().audio
                    && provider.audio_status(job.user_id) == super::providers::SourceStatus::Ready
                    && sources.iter().any(|source| source == provider.id())
            })
            .map(|provider| provider.id())
            .collect();
        let mut candidates = Vec::new();
        if configured.contains(&target.source.as_str()) && !target.restricted {
            candidates.push(target.clone());
        }
        let mut searches = FuturesUnordered::new();
        for source in configured {
            searches.push(
                async move {
                    let result = tokio::time::timeout(
                        Duration::from_secs(48),
                        self.search(job.user_id, source, search_query, false),
                    )
                    .await;
                    (source, result)
                }
                .boxed(),
            );
        }
        while let Some((source, result)) = searches.next().await {
            match result {
                Ok(Ok(found)) => {
                    let mut matches: Vec<_> = found
                        .tracks
                        .into_iter()
                        .filter(|candidate| !candidate.restricted && same_recording(&target.track, &candidate.track))
                        .collect();
                    matches.sort_by_key(|candidate| {
                        std::cmp::Reverse(rank(candidate.format.as_deref(), candidate.bitrate))
                    });
                    candidates.extend(matches.into_iter().take(2));
                }
                Ok(Err(error)) => self.note(job, target, source, "search-failed", Some(reason(&error))).await?,
                Err(_) => self.note(job, target, source, "search-failed", Some("Search timed out.".into())).await?,
            }
        }

        let corroborated: Vec<_> = candidates
            .iter()
            .filter(|candidate| candidate.track.duration > 0)
            .map(|candidate| (candidate.source.clone(), candidate.track.duration))
            .collect();
        let mut seen = std::collections::HashSet::new();
        candidates.retain(|candidate| {
            let exact = candidate.source == target.source && candidate.id == target.id
                || target.track.isrc.is_some() && target.track.isrc == candidate.track.isrc;
            let known_length = (target.track.duration > 0 && candidate.track.duration > 0)
                || (candidate.track.duration > 0
                    && corroborated.iter().any(|(source, duration)| {
                        source != &candidate.source && duration.abs_diff(candidate.track.duration) <= 3
                    }));
            (!playlist || exact || known_length) && seen.insert((candidate.source.clone(), candidate.id.clone()))
        });
        Ok(candidates)
    }

    async fn acquire(&self, job: &Claim, item: &Item) -> AppResult<()> {
        let target = item.selection.as_ref().map_or(&item.recording.0, |selection| &selection.candidate);
        let (sources, automatic, custom_query, playlist) = match &job.request.0 {
            ImportRequest::Track { sources, automatic, search_query, .. } => {
                (sources, *automatic, search_query.as_deref(), None)
            }
            ImportRequest::Playlist { sources, url, .. } => (sources, true, None, Some(url.as_str())),
        };
        let (automatic, custom_query, playlist) = item
            .selection
            .as_ref()
            .map_or((automatic, custom_query, playlist), |selection| (false, Some(selection.query.as_str()), None));
        let generated = query(&target.track);
        let search_query = custom_query.filter(|value| value.chars().count() >= 2).unwrap_or(&generated);
        let local = self.local(&target.track).await?;
        if local.as_ref().is_some_and(|track| track.codec.as_deref() == Some("flac")) {
            return self
                .save_item(job, item.position, "reused", local.as_ref().map(|track| track.id), None, None)
                .await;
        }

        let candidates = if automatic {
            self.candidates(job, target, &generated, sources, playlist.is_some()).await?
        } else {
            vec![target.clone()]
        };
        let empty = candidates.is_empty();
        let mut remaining = candidates.into_iter().map(|candidate| {
            let download_query =
                if candidate.source == target.source && candidate.id == target.id { search_query } else { &generated };
            (candidate, download_query)
        });
        let mut downloads = FuturesUnordered::new();
        for (candidate, download_query) in remaining.by_ref().take(4) {
            downloads.push(self.inspect_candidate(job.user_id, candidate, target, download_query, playlist).boxed());
        }

        let mut best: Option<(Candidate, Audio, AudioMetadata, (bool, i32))> = None;
        while let Some((candidate, result)) = downloads.next().await {
            if let Some((next, download_query)) = remaining.next() {
                downloads.push(self.inspect_candidate(job.user_id, next, target, download_query, playlist).boxed());
            }
            match result {
                Ok((audio, metadata)) => {
                    let quality = rank(metadata.codec, audio.original_bitrate.or(metadata.bitrate_kbps));
                    self.note(job, target, &candidate.source, "checked", None).await?;
                    if best.as_ref().is_none_or(|(current, _, _, score)| {
                        (quality, candidate.source == target.source, &candidate.source, &candidate.id)
                            > (*score, current.source == target.source, &current.source, &current.id)
                    }) {
                        best = Some((candidate, audio, metadata, quality));
                    }
                }
                Err(error) => {
                    self.note(job, target, &candidate.source, "download-failed", Some(reason(&error))).await?
                }
            }
        }

        if let Some(local) = local {
            let upgrade = if let Some((candidate, audio, metadata, (true, _))) = &best {
                self.same_audio(&local, audio, metadata.duration_seconds).await.then_some(candidate)
            } else {
                None
            };
            return self
                .save_item(
                    job,
                    item.position,
                    "reused",
                    Some(local.id),
                    None,
                    upgrade.map(|candidate| (candidate, local.content_hash.as_str())),
                )
                .await;
        }

        let Some((candidate, audio, metadata, _)) = best else {
            let (state, error) = if empty {
                ("review", "No confident match was found.")
            } else {
                ("failed", "No source supplied a complete file.")
            };
            return self.save_item(job, item.position, state, None, Some(error), None).await;
        };

        let active =
            sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM music_imports WHERE id=$1 AND lease=$2)")
                .bind(job.id)
                .bind(job.lease)
                .fetch_one(&self.uploads.db)
                .await?;
        if !active {
            return Ok(());
        }
        let outcome = self.publish(job.user_id, target, &candidate, &audio, metadata, UploadMode::KeepExisting).await;
        match outcome {
            Ok(track_id) => {
                self.note(job, target, &candidate.source, "selected", None).await?;
                self.save_item(job, item.position, "added", Some(track_id), None, None).await
            }
            Err(error) => {
                if let Some(local) = self.local(&target.track).await? {
                    self.save_item(job, item.position, "reused", Some(local.id), None, None).await
                } else {
                    self.save_item(job, item.position, "failed", None, Some(&reason(&error)), None).await
                }
            }
        }
    }

    async fn inspect_candidate(
        &self,
        user: Uuid,
        candidate: Candidate,
        target: &Candidate,
        query: &str,
        playlist: Option<&str>,
    ) -> (Candidate, AppResult<(Audio, AudioMetadata)>) {
        let native_playlist = playlist.filter(|_| candidate.source == target.source && candidate.id == target.id);
        let result = tokio::time::timeout(Duration::from_secs(145), async {
            let audio = self.stage(user, &candidate, query, native_playlist).await?;
            let metadata = audio.metadata().await?;
            validate_duration(&target.track, &candidate.track, &metadata)?;
            Ok((audio, metadata))
        })
        .await
        .unwrap_or_else(|_| Err(AppError::validation("Download timed out.")));
        (candidate, result)
    }

    async fn local(&self, expected: &Recording) -> AppResult<Option<LocalTrack>> {
        let rows: Vec<LocalTrack> = sqlx::query_as(
            "SELECT t.id,t.duration_seconds AS duration,t.codec,t.file_path,t.content_hash,
                COALESCE((SELECT string_agg(a.name, ', ' ORDER BY a.name) FROM track_artists ta
                    JOIN artists a ON a.id=ta.artist_id WHERE ta.track_id=t.id), main.name) AS artist
             FROM tracks t JOIN artists main ON main.id=t.artist_id WHERE t.normalized_title=$1
             ORDER BY (t.codec='flac') DESC NULLS LAST,t.bitrate_kbps DESC NULLS LAST,t.id LIMIT 100",
        )
        .bind(crate::text::normalize_key(&expected.title))
        .fetch_all(&self.uploads.db)
        .await?;
        Ok(rows.into_iter().find(|row| {
            same_recording(
                expected,
                &Recording {
                    title: expected.title.clone(),
                    artist: row.artist.clone(),
                    duration: row.duration,
                    isrc: None,
                },
            )
        }))
    }

    async fn same_audio(&self, local: &LocalTrack, audio: &Audio, duration: i32) -> bool {
        let Some(path) = self.uploads.storage.existing(&local.file_path) else { return false };
        let candidate = audio.path.clone();
        let local_duration = local.duration;
        tokio::task::spawn_blocking(move || {
            let reference = media::analysis::analyze(&path, f64::from(local_duration), false).ok()?.fingerprint?;
            let incoming = media::analysis::analyze(&candidate, f64::from(duration), false).ok()?.fingerprint?;
            reco::duplicates::bit_error(&reference, &incoming)
        })
        .await
        .ok()
        .flatten()
        .is_some_and(|error| error <= reco::duplicates::MAX_BIT_ERROR)
    }

    async fn publish(
        &self,
        user: Uuid,
        target: &Candidate,
        candidate: &Candidate,
        audio: &Audio,
        metadata: AudioMetadata,
        mode: UploadMode,
    ) -> AppResult<Uuid> {
        let path = audio.path.clone();
        let tags = AudioTags {
            title: target.track.title.clone(),
            artists: vec![target.track.artist.clone()],
            album_artists: metadata.album_artists,
            album: target.album.clone().or(metadata.album).or_else(|| candidate.album.clone()),
            genre: metadata.genre,
            year: metadata.year,
            track_number: metadata.track_number,
            disc_number: metadata.disc_number,
            cover: metadata.cover,
            lyrics: metadata.lyrics,
        };
        tokio::task::spawn_blocking(move || tags::write(&path, &tags)).await.map_err(AppError::internal)??;
        let name: String = format!("{} - {}", target.track.artist, target.track.title)
            .chars()
            .map(|ch| if ch.is_control() || r#"/\:*?"<>|"#.contains(ch) { '_' } else { ch })
            .take(220)
            .collect();
        let file = tokio::fs::File::open(&audio.path).await.map_err(AppError::internal)?;
        Ok(self.uploads.upload_single(user, &format!("{name}{}", audio.format.extension), None, file, mode).await?.id)
    }

    async fn note(
        &self,
        job: &Claim,
        target: &Candidate,
        source: &str,
        state: &str,
        error: Option<String>,
    ) -> AppResult<()> {
        sqlx::query(
            "UPDATE music_import_items i SET attempts=i.attempts || $3::jsonb
             WHERE i.job_id=$1 AND i.position=(SELECT min(position) FROM music_import_items WHERE job_id=$1 AND state='queued')
               AND EXISTS (SELECT 1 FROM music_imports WHERE id=$1 AND lease=$2)",
        ).bind(job.id).bind(job.lease).bind(json!([{ "source": source, "state": state, "error": error, "title": target.track.title }]))
            .execute(&self.uploads.db).await?;
        Ok(())
    }

    async fn save_item(
        &self,
        job: &Claim,
        position: i32,
        state: &str,
        track: Option<Uuid>,
        error: Option<&str>,
        upgrade: Option<(&Candidate, &str)>,
    ) -> AppResult<()> {
        sqlx::query(
            "UPDATE music_import_items SET state=$4,track_id=$5,error=$6,upgrade=$7,upgrade_hash=$8
             WHERE job_id=$1 AND position=$3 AND EXISTS (SELECT 1 FROM music_imports WHERE id=$1 AND lease=$2)",
        )
        .bind(job.id)
        .bind(job.lease)
        .bind(position)
        .bind(state)
        .bind(track)
        .bind(error)
        .bind(upgrade.map(|(candidate, _)| Json(candidate)))
        .bind(upgrade.map(|(_, hash)| hash))
        .execute(&self.uploads.db)
        .await?;
        Ok(())
    }

    async fn finish(&self, job: &Claim) -> AppResult<()> {
        let mut tx = self.uploads.db.begin().await?;
        let owned: bool = sqlx::query_scalar("SELECT true FROM music_imports WHERE id=$1 AND lease=$2 FOR UPDATE")
            .bind(job.id)
            .bind(job.lease)
            .fetch_optional(&mut *tx)
            .await?
            .unwrap_or(false);
        if !owned {
            return Ok(());
        }
        let publish = match &job.request.0 {
            ImportRequest::Playlist { url, .. } => {
                let link = self.playlist_link(url)?;
                !link.provider.is_album_link(&link.id)
            }
            ImportRequest::Track { .. } => false,
        };
        let playlist_id = if publish { publish_playlist(&mut tx, job).await? } else { None };
        sqlx::query(
            "UPDATE music_imports SET state='finished',lease=NULL,locked_until=NULL,playlist_id=$2 WHERE id=$1",
        )
        .bind(job.id)
        .bind(playlist_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }
}

fn reason(error: &AppError) -> String {
    error.message().map_or_else(|| "The music import could not be completed.".to_owned(), ToString::to_string)
}

fn validate_duration(expected: &Recording, candidate: &Recording, metadata: &AudioMetadata) -> AppResult<()> {
    if [expected.duration, candidate.duration]
        .into_iter()
        .any(|duration| duration > 0 && duration.abs_diff(metadata.duration_seconds) > 3)
    {
        return Err(AppError::validation("The downloaded audio has the wrong duration."));
    }
    Ok(())
}

async fn publish_playlist(conn: &mut PgConnection, job: &Claim) -> AppResult<Option<Uuid>> {
    let tracks: Vec<Uuid> = sqlx::query_scalar(
        "SELECT track_id FROM music_import_items WHERE job_id=$1 AND track_id IS NOT NULL
         GROUP BY track_id ORDER BY min(position)",
    )
    .bind(job.id)
    .fetch_all(&mut *conn)
    .await?;
    if tracks.is_empty() {
        return Ok(None);
    }
    sqlx::query(
        "INSERT INTO playlists (id,user_id,name,is_public,created_at,updated_at)
         VALUES ($1,$2,$3,false,now(),now()) ON CONFLICT (id) DO NOTHING",
    )
    .bind(job.id)
    .bind(job.user_id)
    .bind(job.title.as_deref().unwrap_or("Imported playlist"))
    .execute(&mut *conn)
    .await?;
    let ids: Vec<_> = tracks.iter().map(|_| Uuid::now_v7()).collect();
    sqlx::query(
        "INSERT INTO playlist_tracks (id,playlist_id,track_id,position)
         SELECT entry.id,$1,entry.track_id,entry.ordinality-1 FROM unnest($2::uuid[],$3::uuid[]) WITH ORDINALITY AS entry(track_id,id,ordinality)
         ON CONFLICT (playlist_id,track_id) DO UPDATE SET position=EXCLUDED.position",
    ).bind(job.id).bind(&tracks).bind(ids).execute(&mut *conn).await?;
    sqlx::query("UPDATE playlists SET updated_at=now() WHERE id=$1 AND user_id=$2")
        .bind(job.id)
        .bind(job.user_id)
        .execute(&mut *conn)
        .await?;
    Ok(Some(job.id))
}

async fn record_snapshot(
    conn: &mut PgConnection,
    id: Uuid,
    lease: Option<Uuid>,
    snapshot: PlaylistSnapshot,
) -> AppResult<()> {
    if snapshot.tracks.len() > MAX_PLAYLIST_ITEMS {
        return Err(AppError::validation("The playlist exceeds the import size limit."));
    }
    let recordings: Vec<_> =
        snapshot.tracks.iter().map(serde_json::to_value).collect::<Result<_, _>>().map_err(AppError::internal)?;
    let title = snapshot.name.trim().chars().take(200).collect::<String>();
    let title = if title.is_empty() { "Imported playlist" } else { &title };
    let changed = sqlx::query(
        "UPDATE music_imports SET title=$3,partial=$4,omitted=$5,state='queued',error=NULL,lease=NULL,locked_until=NULL
         WHERE id=$1 AND lease IS NOT DISTINCT FROM $2",
    )
    .bind(id)
    .bind(lease)
    .bind(title)
    .bind(snapshot.partial)
    .bind(i32::try_from(snapshot.omitted).unwrap_or(i32::MAX))
    .execute(&mut *conn)
    .await?;
    if changed.rows_affected() == 1 {
        sqlx::query(
            "INSERT INTO music_import_items (job_id,position,recording)
             SELECT $1,ordinality-1,recording FROM jsonb_array_elements($2) WITH ORDINALITY AS entries(recording,ordinality)
             ON CONFLICT DO NOTHING",
        ).bind(id).bind(json!(recordings)).execute(&mut *conn).await?;
    }
    Ok(())
}

#[cfg(all(test, feature = "integration-tests"))]
mod tests;
