// SPDX-License-Identifier: AGPL-3.0-only

use std::path::PathBuf;

use media::formats::{FLAC, MP3};
use media::tags::{self, AudioTags};
use uuid::Uuid;

use crate::i18n::Lang;
use crate::upload::{UploadResult, Uploads};
use crate::{AppError, AppResult, background};

pub const MAX_BYTES: usize = 24 * 1024 * 1024;
pub const MAX_COVER_BYTES: usize = 2 * 1024 * 1024;
const MAX_NAME_CHARS: usize = 200;

pub struct VkAudio<'a> {
    pub title: &'a str,
    pub artist: &'a str,
    pub format: &'a str,
    pub audio: &'a [u8],
    pub album: Option<&'a str>,
    pub cover: Option<&'a [u8]>,
}

struct Scratch(PathBuf);

impl Drop for Scratch {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_dir_all(&self.0)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            tracing::warn!(%error, "Could not remove temporary VK import files");
        }
    }
}

pub async fn import(uploads: &Uploads, user: Uuid, request: VkAudio<'_>, lang: Lang) -> AppResult<UploadResult> {
    let title = name(request.title)?;
    let artist = name(request.artist)?;
    let album = request.album.and_then(valid_name).map(str::to_owned);
    let cover = request.cover.filter(|bytes| !bytes.is_empty() && bytes.len() <= MAX_COVER_BYTES).map(<[u8]>::to_vec);
    let format = match request.format {
        "flac" => FLAC,
        "mp3" | "stream" => MP3,
        _ => return Err(invalid_audio()),
    };
    if request.audio.is_empty() {
        return Err(invalid_audio());
    }
    if request.audio.len() > MAX_BYTES {
        return Err(AppError::payload_too_large("The VK Music file exceeds the 24 MB upload limit."));
    }

    let permit = background::permit().await.map_err(AppError::internal)?;
    let scratch = Scratch(std::env::temp_dir().join(format!("caimack-vk-{}", Uuid::now_v7())));
    tokio::fs::create_dir(&scratch.0).await.map_err(AppError::internal)?;
    let audio = scratch.0.join(format!("audio{}", format.extension));
    if request.format == "stream" {
        let source = scratch.0.join("stream");
        tokio::fs::write(&source, request.audio).await.map_err(AppError::internal)?;
        if !media::ffmpeg::convert_uploaded_audio_to_mp3(&source, &audio).await? {
            return Err(invalid_audio());
        }
    } else {
        tokio::fs::write(&audio, request.audio).await.map_err(AppError::internal)?;
    }

    let file_name: String = format!("{artist} - {title}")
        .chars()
        .map(|ch| if ch.is_control() || r#"/\:*?"<>|"#.contains(ch) { '_' } else { ch })
        .take(240)
        .collect();
    let file_name = format!("{file_name}{}", format.extension);
    let tags_path = audio.clone();
    let _scratch = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let current = tags::read(&tags_path).ok_or_else(invalid_audio)?;
        if current.codec != Some(format.codec()) || current.duration_seconds <= 0 {
            return Err(invalid_audio());
        }
        let tags = AudioTags {
            title,
            artists: vec![artist],
            album_artists: current.album_artists,
            album: album.or(current.album),
            genre: current.genre,
            year: current.year,
            track_number: current.track_number,
            disc_number: current.disc_number,
            cover: cover.and_then(|bytes| media::images::cover_jpeg(&bytes).ok()),
            lyrics: None,
        };
        tags::write(&tags_path, &tags).map_err(AppError::internal)?;
        Ok::<_, AppError>(scratch)
    })
    .await
    .map_err(AppError::internal)??;

    let file = tokio::fs::File::open(audio).await.map_err(AppError::internal)?;
    let length = file.metadata().await.map_err(AppError::internal)?.len();
    Ok(uploads.upload(user, &file_name, i64::try_from(length).ok(), file, lang).await)
}

fn name(value: &str) -> AppResult<String> {
    valid_name(value)
        .map(str::to_owned)
        .ok_or_else(|| AppError::validation("The VK Music track has invalid title or artist information."))
}

fn valid_name(value: &str) -> Option<&str> {
    let name = value.trim();
    (!name.is_empty() && name.chars().count() <= MAX_NAME_CHARS && !name.chars().any(char::is_control)).then_some(name)
}

fn invalid_audio() -> AppError {
    AppError::validation("Could not read the audio from VK Music.")
}
