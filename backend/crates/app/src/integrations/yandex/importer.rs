// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use media::formats;
use media::tags::AudioTags;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::client::{YandexClient, YandexTrack};
use super::imports::{ImportJob, ImportKind};
use crate::i18n::{self, Lang};
use crate::upload::{self, ProbeFile, ProbeVerdict, Uploads};
use crate::{AppError, AppResult};

const LOSSLESS_CODECS: [&str; 2] = ["flac-mp4", "mp3"];
const LOSSY_CODECS: [&str; 1] = ["mp3"];
const TRACK_PAUSE: Duration = Duration::from_secs(1);
const TOKEN_REJECTED: &str = "Yandex Music rejected the token.";

#[derive(Debug, PartialEq, Eq)]
enum Outcome {
    Added,
    Skipped,
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

struct Scratch(PathBuf);

impl Drop for Scratch {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_dir_all(&self.0) {
            tracing::warn!("Could not clean up the import folder {}: {error}", self.0.display());
        }
    }
}

impl Importer {
    async fn import(
        &self,
        token: &str,
        track: &YandexTrack,
        genres: &HashMap<String, String>,
        lang: Lang,
    ) -> AppResult<Outcome> {
        if !track.available {
            return Err(AppError::validation("This track is not available on Yandex Music."));
        }

        let probed = upload::probe(&self.uploads.db, Uuid::nil(), vec![probe_file(track)]).await?;
        let verdict = probed.files.first().map_or(ProbeVerdict::New, |file| file.verdict);
        if verdict == ProbeVerdict::Duplicate {
            return Ok(Outcome::Skipped);
        }

        let file = match self.yandex.file_info(token, &track.id, "lossless", &LOSSLESS_CODECS).await? {
            Some(file) => file,
            None => self
                .yandex
                .file_info(token, &track.id, "hq", &LOSSY_CODECS)
                .await?
                .ok_or_else(|| AppError::validation("Yandex Music did not give a download link for this track."))?,
        };

        let lossless = matches!(file.codec.as_str(), "flac-mp4" | "flac");

        if verdict == ProbeVerdict::Upgrade && !lossless {
            return Ok(Outcome::Skipped);
        }
        if !lossless && file.codec != "mp3" {
            return Err(
                AppError::validation("Yandex Music offered only {0}, which Caimack does not store.").arg(&file.codec)
            );
        }

        let format = if lossless { formats::FLAC } else { formats::MP3 };
        let scratch = Scratch(std::env::temp_dir().join("caimack-yandex").join(Uuid::now_v7().simple().to_string()));
        tokio::fs::create_dir_all(&scratch.0).await.map_err(AppError::internal)?;
        let downloaded = scratch.0.join("source");
        let audio = scratch.0.join(format!("track{}", format.extension));

        self.yandex.download(&file.url, &downloaded).await?;
        if file.codec == "flac-mp4" {
            if !media::ffmpeg::remux_flac(&downloaded, &audio).await? {
                return Err(AppError::validation("The FLAC stream could not be unpacked."));
            }
        } else {
            tokio::fs::rename(&downloaded, &audio).await.map_err(AppError::internal)?;
        }

        let album = track.album.as_ref();
        let (cover, lyrics) = tokio::join!(
            self.yandex.cover(album.and_then(|a| a.cover_uri.as_deref()).or(track.cover_uri.as_deref())),
            self.yandex.lyrics(token, &track.id),
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

        let length = tokio::fs::metadata(&audio).await.map_err(AppError::internal)?.len();
        let body = tokio::fs::File::open(&audio).await.map_err(AppError::internal)?;
        let name = file_name(track, format.extension);
        let result = self.uploads.upload(Uuid::nil(), &name, i64::try_from(length).ok(), body, lang).await;
        if let Some(failure) = result.failed.into_iter().next() {
            return Err(AppError::validation("{0}").arg(failure.reason));
        }

        tracing::info!("Imported Yandex Music track {} ({})", track.id, file.codec);
        Ok(Outcome::Added)
    }
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

            let outcome = tokio::select! {
                () = cancel.cancelled() => break,
                outcome = run(&importer, &job, &cancel) => outcome,
            };
            match outcome {
                Ok(()) => job.finish(),
                Err(error @ AppError::Internal(_)) => {
                    tracing::error!("Yandex Music import {} failed: {error:#}", job.id);
                    job.fail(localized(&error, job.lang));
                }
                Err(error) => {
                    tracing::info!("Yandex Music import {} stopped: {error}", job.id);
                    job.fail(localized(&error, job.lang));
                }
            }
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
    };
    if tracks.is_empty() {
        return Err(AppError::validation("Nothing to import here."));
    }

    let genres = yandex.genre_titles(&job.token).await?;
    job.start(title, tracks.len());

    for (index, track) in tracks.iter().enumerate() {
        if job.cancelled.is_cancelled() {
            return Ok(());
        }
        let name = format!("{} — {}", artist(track), track.title);
        job.importing(&name);

        match importer.import(&job.token, track, &genres, job.lang).await {
            Ok(Outcome::Added) => job.added(),
            Ok(Outcome::Skipped) => job.skipped(),

            Err(error) if is_token_problem(&error) => return Err(error),
            Err(error) => {
                if let AppError::Internal(inner) = &error {
                    tracing::error!("Importing Yandex Music track {} failed: {inner:#}", track.id);
                }
                job.track_failed(&name, localized(&error, job.lang));
            }
        }

        if index + 1 < tracks.len() {
            tokio::select! {
                () = cancel.cancelled() => return Ok(()),
                () = job.cancelled.cancelled() => return Ok(()),
                () = tokio::time::sleep(TRACK_PAUSE) => {}
            }
        }
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

    #[test]
    fn scratch_folder_is_removed_on_drop() -> std::io::Result<()> {
        let path = std::env::temp_dir().join(format!("caimack-scratch-{}", Uuid::now_v7().simple()));
        std::fs::create_dir_all(&path)?;
        std::fs::write(path.join("file"), b"x")?;
        drop(Scratch(path.clone()));
        assert!(!path.exists());
        Ok(())
    }
}
