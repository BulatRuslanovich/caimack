// SPDX-License-Identifier: AGPL-3.0-only

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use media::formats;
use media::tags::AudioTags;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::Instrument;
use uuid::Uuid;

use super::client::{FileInfo, YandexClient, YandexTrack};
use super::imports::{ImportJob, ImportKind};
use crate::i18n::{self, Lang};
use crate::integrations::music::audio::{Audio, Scratch};
use crate::library::playlists::{self, PlaylistRequest};
use crate::upload::{self, ProbeFile, ProbeVerdict, Uploads};
use crate::{AppError, AppResult};

const LOSSLESS_CODECS: [&str; 2] = ["flac-mp4", "mp3"];
const LOSSY_CODECS: [&str; 1] = ["mp3"];
const TRACK_PAUSE: Duration = Duration::from_secs(1);
const TOKEN_REJECTED: &str = "Yandex Music rejected the token.";

#[derive(Debug, PartialEq, Eq)]
enum Outcome {
    Added(Uuid),
    Skipped(Option<Uuid>),
}

#[derive(Clone)]
pub struct Importer {
    pub yandex: YandexClient,
    pub uploads: Uploads,
}

pub fn artist(track: &YandexTrack) -> String {
    if track.artists.is_empty() { "Unknown Artist".to_owned() } else { track.artists.join(", ") }
}

pub fn probe_file(track: &YandexTrack) -> ProbeFile {
    ProbeFile {
        file_name: file_name(track, formats::FLAC.extension),
        content_hash: None,
        title: Some(track.title.clone()),
        artist: Some(artist(track)),
    }
}

fn file_name(track: &YandexTrack, extension: &str) -> String {
    let name: String = format!("{} - {}", artist(track), track.title)
        .chars()
        .map(|c| if c.is_control() || r#"/\:*?"<>|"#.contains(c) { '_' } else { c })
        .collect();
    format!("{name}{extension}")
}

impl Importer {
    async fn import(
        &self,
        token: &str,
        track: &YandexTrack,
        genres: &HashMap<String, String>,
        lang: Lang,
        reuse_existing: bool,
    ) -> AppResult<Outcome> {
        let probed = upload::probe(&self.uploads.db, Uuid::nil(), vec![probe_file(track)]).await?;
        let candidate = probed.files.first();
        let matched = candidate.and_then(|file| file.matched.as_ref()).map(|track| track.id);
        if reuse_existing && matched.is_some() {
            return Ok(Outcome::Skipped(matched));
        }
        if !track.available {
            return Err(AppError::validation("This track is not available on Yandex Music."));
        }

        let verdict = candidate.map_or(ProbeVerdict::New, |file| file.verdict);
        if verdict == ProbeVerdict::Duplicate {
            return Ok(Outcome::Skipped(matched));
        }

        let info = resolve_file(&self.yandex, token, &track.id).await?;
        if verdict == ProbeVerdict::Upgrade && !lossless(&info) {
            return Ok(Outcome::Skipped(matched));
        }
        let prepared = prepare_file(&self.yandex, token, track, genres, info).await?;
        let format = prepared.format;
        let audio = &prepared.path;
        let length = tokio::fs::metadata(audio).await.map_err(AppError::internal)?.len();
        let body = tokio::fs::File::open(audio).await.map_err(AppError::internal)?;
        let name = file_name(track, format.extension);
        let result = self.uploads.upload(Uuid::nil(), &name, i64::try_from(length).ok(), body, lang).await;
        if let Some(failure) = result.failed.into_iter().next() {
            if reuse_existing
                && let Some(matched) = upload::probe(&self.uploads.db, Uuid::nil(), vec![probe_file(track)])
                    .await?
                    .files
                    .into_iter()
                    .next()
                    .and_then(|file| file.matched)
            {
                return Ok(Outcome::Skipped(Some(matched.id)));
            }
            return Err(AppError::validation("{0}").arg(failure.reason));
        }

        let id =
            result.uploaded.first().ok_or_else(|| AppError::internal(anyhow::anyhow!("Missing uploaded track")))?.id;
        tracing::debug!(provider_track_id = track.id, codec = format.codec(), "Yandex Music track imported");
        Ok(Outcome::Added(id))
    }
}

pub(crate) async fn prepare(
    yandex: &YandexClient,
    token: &str,
    track: &YandexTrack,
    genres: &HashMap<String, String>,
) -> AppResult<Audio> {
    let file = resolve_file(yandex, token, &track.id).await?;
    prepare_file(yandex, token, track, genres, file).await
}

async fn resolve_file(yandex: &YandexClient, token: &str, id: &str) -> AppResult<FileInfo> {
    Ok(match yandex.file_info(token, id, "lossless", &LOSSLESS_CODECS).await? {
        Some(file) => file,
        None => yandex
            .file_info(token, id, "hq", &LOSSY_CODECS)
            .await?
            .ok_or_else(|| AppError::validation("Yandex Music did not give a download link for this track."))?,
    })
}

fn lossless(file: &FileInfo) -> bool {
    matches!(file.codec.as_str(), "flac-mp4" | "flac")
}

async fn prepare_file(
    yandex: &YandexClient,
    token: &str,
    track: &YandexTrack,
    genres: &HashMap<String, String>,
    file: FileInfo,
) -> AppResult<Audio> {
    let lossless = lossless(&file);

    if !lossless && file.codec != "mp3" {
        return Err(
            AppError::validation("Yandex Music offered only {0}, which Caimack does not store.").arg(&file.codec)
        );
    }

    let format = if lossless { formats::FLAC } else { formats::MP3 };
    let scratch = Scratch::new().await?;
    let downloaded = scratch.file("source");
    let audio = scratch.file(&format!("track{}", format.extension));

    yandex.download(&file.url, &downloaded).await?;
    if file.codec == "flac-mp4" {
        if !media::ffmpeg::remux_flac(&downloaded, &audio).await? {
            return Err(AppError::validation("The FLAC stream could not be unpacked."));
        }
    } else {
        tokio::fs::rename(&downloaded, &audio).await.map_err(AppError::internal)?;
    }

    let album = track.album.as_ref();
    let (cover, lyrics) = tokio::join!(
        yandex.cover(album.and_then(|a| a.cover_uri.as_deref()).or(track.cover_uri.as_deref())),
        yandex.lyrics(token, &track.id),
    );
    let tags = AudioTags {
        title: track.title.clone(),
        artists: track.artists.clone(),
        album_artists: album
            .map(|a| a.artists.clone())
            .filter(|a| !a.is_empty())
            .unwrap_or_else(|| track.artists.clone()),
        album: album.map(|a| a.title.clone()),
        genre: album.and_then(|a| a.genre.as_ref()).map(|code| genres.get(code).unwrap_or(code).clone()),
        year: album.and_then(|a| a.year),
        track_number: album.and_then(|a| a.track_number),
        disc_number: album.and_then(|a| a.disc_number),
        cover,
        lyrics,
    };
    write_tags(audio.clone(), tags).await?;
    Ok(Audio { path: audio, format, original_bitrate: None, album: None, cover: None, _scratch: scratch })
}

async fn write_tags(path: PathBuf, tags: AudioTags) -> AppResult<()> {
    tokio::task::spawn_blocking(move || media::tags::write(&path, &tags))
        .await
        .map_err(AppError::internal)?
        .map_err(AppError::Internal)
}

fn localized(error: &AppError, lang: Lang) -> String {
    match error.message() {
        Some(message) => message.localized(lang),
        None => i18n::localize("The import failed.", &[], lang),
    }
}

fn is_token_problem(error: &AppError) -> bool {
    error.message().is_some_and(|message| message.template == TOKEN_REJECTED)
}

pub fn spawn(
    importer: Importer,
    mut jobs: mpsc::UnboundedReceiver<Arc<ImportJob>>,
    cancel: CancellationToken,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            let job = tokio::select! {
                () = cancel.cancelled() => break,
                job = jobs.recv() => job,
            };
            let Some(job) = job else { break };
            let started = std::time::Instant::now();
            let outcome = tokio::select! {
                () = cancel.cancelled() => break,
                outcome = run(&importer, &job, &cancel).instrument(tracing::error_span!("yandex_import", job_id = %job.id, kind = ?job.kind)) => outcome,
            };
            match outcome {
                Ok(()) => job.finish(),
                Err(error @ AppError::Internal(_)) => {
                    tracing::error!(job_id = %job.id, error = ?error, "Yandex Music import failed");
                    job.fail(localized(&error, job.lang));
                }
                Err(error) => {
                    tracing::warn!(job_id = %job.id, %error, "Yandex Music import stopped");
                    job.fail(localized(&error, job.lang));
                }
            }
            let status = job.dto();
            tracing::info!(job_id = %job.id, outcome = ?status.status, total = status.total,
                done = status.done, added = status.added, skipped = status.skipped, failed = status.failures.len(),
                elapsed_secs = started.elapsed().as_secs(), "Yandex Music import finished");
        }
    })
}

async fn run(importer: &Importer, job: &ImportJob, cancel: &CancellationToken) -> AppResult<()> {
    if job.cancelled.is_cancelled() {
        return Ok(());
    }
    let yandex = &importer.yandex;
    let source = job.source_id.clone().unwrap_or_default();
    let (title, tracks) = match job.kind {
        ImportKind::Likes => (None, yandex.tracks(&job.token, &yandex.liked_track_ids(&job.token).await?).await?),
        ImportKind::Album => {
            let (album, tracks) = yandex.album(&job.token, &source).await?;
            (Some(album.title), tracks)
        }
        ImportKind::Track => {
            let tracks = yandex.tracks(&job.token, &[source]).await?;
            (tracks.first().map(|track| format!("{} — {}", artist(track), track.title)), tracks)
        }
        ImportKind::Playlist => {
            let (name, tracks) = tokio::select! {
                () = job.cancelled.cancelled() => return Ok(()),
                result = yandex.playlist(&job.token, &source) => result?,
            };
            (Some(name), tracks)
        }
    };
    if tracks.is_empty() {
        return Err(AppError::validation("Nothing to import here."));
    }

    let genres = yandex.genre_titles(&job.token).await?;
    let playlist = title.as_ref().filter(|_| job.kind == ImportKind::Playlist);
    job.start(title.clone(), tracks.len());
    tracing::info!(total = tracks.len(), "Yandex Music import started");
    let mut reported = std::time::Instant::now();
    let mut playlist_tracks = Vec::new();

    for (index, track) in tracks.iter().enumerate() {
        if job.cancelled.is_cancelled() {
            return Ok(());
        }
        let name = format!("{} — {}", artist(track), track.title);
        job.importing(&name);

        let outcome = importer.import(&job.token, track, &genres, job.lang, playlist.is_some()).await;
        let reused = playlist.is_some() && matches!(outcome, Ok(Outcome::Skipped(_)));
        match outcome {
            Ok(Outcome::Added(id)) => {
                job.added();
                if playlist.is_some() {
                    playlist_tracks.push(id);
                }
            }
            Ok(Outcome::Skipped(id)) => {
                job.skipped();
                if playlist.is_some() {
                    playlist_tracks.extend(id);
                }
            }

            Err(error) if is_token_problem(&error) => return Err(error),
            Err(error) => {
                if let AppError::Internal(inner) = &error {
                    tracing::error!(provider_track_id = track.id, error = %format!("{inner:#}"), "Importing Yandex Music track failed");
                } else {
                    tracing::warn!(provider_track_id = track.id, %error, "Yandex Music track skipped after import failure");
                }
                job.track_failed(&name, localized(&error, job.lang));
            }
        }

        if reported.elapsed() >= Duration::from_secs(30) {
            let status = job.dto();
            tracing::info!(
                total = status.total,
                done = status.done,
                added = status.added,
                skipped = status.skipped,
                failed = status.failures.len(),
                "Yandex Music import progress"
            );
            reported = std::time::Instant::now();
        }

        if !reused && index + 1 < tracks.len() {
            tokio::select! {
                () = cancel.cancelled() => return Ok(()),
                () = job.cancelled.cancelled() => return Ok(()),
                () = tokio::time::sleep(TRACK_PAUSE) => {}
            }
        }
    }
    if let Some(name) = playlist
        && !job.cancelled.is_cancelled()
        && !cancel.is_cancelled()
    {
        if playlist_tracks.is_empty() {
            return Err(AppError::validation("No tracks were available to add to the playlist."));
        }
        let request = PlaylistRequest { name: name.chars().take(200).collect(), description: None, is_public: false };
        let playlist =
            playlists::create_with_tracks(&importer.uploads.db, job.user_id, request, &playlist_tracks).await?;
        job.record_playlist(playlist.id);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(artists: &[&str], title: &str) -> YandexTrack {
        YandexTrack {
            id: "1".into(),
            title: title.into(),
            artists: artists.iter().map(|a| (*a).to_owned()).collect(),
            album: None,
            cover_uri: None,
            duration_seconds: 200,
            available: true,
        }
    }

    #[test]
    fn file_names_join_artists_and_drop_path_characters() {
        assert_eq!(file_name(&track(&["A", "B"], "Hit/Mix: 2"), ".flac"), "A, B - Hit_Mix_ 2.flac");
        assert_eq!(probe_file(&track(&[], "Song")).artist.as_deref(), Some("Unknown Artist"));
    }

    #[tokio::test]
    async fn scratch_folder_is_removed_on_drop() -> AppResult<()> {
        let scratch = Scratch::new().await?;
        let file = scratch.file("test.mp3");
        tokio::fs::write(&file, b"audio").await.map_err(AppError::internal)?;
        drop(scratch);
        assert!(!file.exists());
        Ok(())
    }

    #[cfg(feature = "integration-tests")]
    #[sqlx::test(migrations = "../../../db/migrations")]
    async fn creates_a_private_playlist_in_source_order_with_existing_and_missing_tracks(
        db: sqlx::PgPool,
    ) -> anyhow::Result<()> {
        use super::super::client::tests::mock_server;
        use super::super::imports::{ImportQueue, ImportStatus};
        use crate::integrations::enrichment::EnrichmentQueue;
        use crate::storage::Storage;
        use crate::transcode::TranscodeQueue;

        let user = Uuid::now_v7();
        let artist = Uuid::now_v7();
        let first = Uuid::now_v7();
        let second = Uuid::now_v7();
        sqlx::query("INSERT INTO users(id,username,password_hash,created_at) VALUES ($1,'alice','unused',now())")
            .bind(user)
            .execute(&db)
            .await?;
        sqlx::query("INSERT INTO artists(id,name,normalized_name,created_at) VALUES ($1,'Artist','artist',now())")
            .bind(artist)
            .execute(&db)
            .await?;
        sqlx::query(
            "INSERT INTO tracks(id,title,normalized_title,artist_id,duration_seconds,file_path,original_file_name,mime_type,file_size,content_hash,created_at)
             VALUES ($1,'First','first',$3,160,'first.mp3','first.mp3','audio/mpeg',100,'first',now()),
                    ($2,'Second','second',$3,180,'second.mp3','second.mp3','audio/mpeg',100,'second',now())",
        ).bind(first).bind(second).bind(artist).execute(&db).await?;
        sqlx::query("INSERT INTO track_artists(track_id,artist_id,position) VALUES ($1,$3,0), ($2,$3,0)")
            .bind(first)
            .bind(second)
            .bind(artist)
            .execute(&db)
            .await?;

        let source = "/playlist/92ad51cd-9305-4765-a925-4efb44b86543";
        let (yandex, server) = mock_server(vec![
            (
                "/playlist/92ad51cd-9305-4765-a925-4efb44b86543?rich-tracks=true&page-size=100&page=0",
                "200 OK",
                r#"{"result":{"title":"Portable Mix","revision":4,"pager":{"total":3,"page":0},
                    "tracks":[{"track":{"id":2,"title":"Second","artists":[{"name":"Artist"}]}},{"id":3}]}}"#,
            ),
            (
                "/playlist/92ad51cd-9305-4765-a925-4efb44b86543?rich-tracks=true&page-size=100&page=1",
                "200 OK",
                r#"{"result":{"title":"Portable Mix","revision":4,"pager":{"total":3,"page":1},
                    "tracks":[{"track":{"id":1,"title":"First","artists":[{"name":"Artist"}]}}]}}"#,
            ),
            ("/genres", "200 OK", r#"{"result":[]}"#),
        ])
        .await;
        let scratch = Scratch::new().await?;
        let (transcodes, _transcode_jobs) = TranscodeQueue::new();
        let (enrichment, _enrichment_jobs) = EnrichmentQueue::new();
        let importer = Importer {
            yandex,
            uploads: Uploads {
                db: db.clone(),
                storage: Storage::open(&scratch.file("storage"))?,
                transcodes,
                hashes: Default::default(),
                enrichment,
            },
        };
        let (queue, mut jobs) = ImportQueue::new();
        queue.enqueue(user, ImportKind::Playlist, Some(source.into()), "test-token".into(), Lang::En)?;
        let job = jobs.try_recv()?;

        run(&importer, &job, &CancellationToken::new()).await?;
        job.finish();
        server.await?;
        let status = job.dto();
        assert_eq!(
            (status.status, status.added, status.skipped, status.failures.len()),
            (ImportStatus::Finished, 0, 2, 1)
        );
        let playlist = playlists::detail(&db, user, status.playlist_id.expect("created playlist")).await?;
        assert_eq!(playlist.name, "Portable Mix");
        assert_eq!(playlist.owner_id, user);
        assert!(!playlist.is_public);
        assert_eq!(playlist.tracks.iter().map(|track| track.id).collect::<Vec<_>>(), [second, first]);
        Ok(())
    }
}
