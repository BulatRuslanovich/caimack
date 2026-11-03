// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

use std::path::Path;

use anyhow::Context;
use lofty::config::WriteOptions;
use lofty::file::{AudioFile, FileType, TaggedFileExt};
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey, ItemValue, Tag, TagItem, TagType};

#[derive(Debug, Clone, Default)]
pub struct AudioMetadata {
    pub title: Option<String>,
    pub artists: Vec<String>,
    pub album_artists: Vec<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    pub duration_seconds: i32,
    pub cover: Option<Vec<u8>>,
    pub lyrics: Option<String>,
    pub codec: Option<&'static str>,
    pub bitrate_kbps: Option<i32>,
    pub sample_rate_hz: Option<i32>,
    pub bits_per_sample: Option<i32>,
}

pub fn read(path: &Path) -> Option<AudioMetadata> {
    let opened = Probe::open(path).map_err(|error| error.to_string());
    let guessed = opened.and_then(|probe| probe.guess_file_type().map_err(|error| error.to_string()));
    let tagged = match guessed.and_then(|probe| probe.read().map_err(|error| error.to_string())) {
        Ok(tagged) => tagged,
        Err(error) => {
            tracing::debug!("No readable audio in {}: {error}", path.display());
            return None;
        }
    };

    let properties = tagged.properties();
    let codec = match tagged.file_type() {
        FileType::Mpeg => Some("mp3"),
        FileType::Flac => Some("flac"),
        _ => None,
    };

    #[expect(clippy::cast_possible_truncation, reason = "track lengths are far below i32::MAX seconds")]
    let duration_seconds = properties.duration().as_secs_f64().round_ties_even() as i32;
    let positive = |value: Option<u32>| value.filter(|&v| v > 0).and_then(|v| i32::try_from(v).ok());

    let mut metadata = AudioMetadata {
        duration_seconds,
        codec,
        bitrate_kbps: positive(properties.audio_bitrate()),
        sample_rate_hz: positive(properties.sample_rate()),
        bits_per_sample: positive(properties.bit_depth().map(u32::from)),
        ..AudioMetadata::default()
    };

    if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
        fill_from_tag(&mut metadata, tag);
    }
    Some(metadata)
}

fn fill_from_tag(metadata: &mut AudioMetadata, tag: &Tag) {
    metadata.title = clean(tag.title().as_deref());
    metadata.artists = clean_all(tag.get_strings(ItemKey::TrackArtist));
    metadata.album_artists = clean_all(tag.get_strings(ItemKey::AlbumArtist));
    metadata.album = clean(tag.album().as_deref());
    metadata.genre = clean(tag.genre().as_deref());
    metadata.year = year(tag);
    metadata.track_number = tag.track().filter(|&n| n > 0).and_then(|n| i32::try_from(n).ok());
    metadata.disc_number = tag.disk().filter(|&n| n > 0).and_then(|n| i32::try_from(n).ok());
    metadata.lyrics = clean(tag.get_string(ItemKey::UnsyncLyrics)).or_else(|| clean(tag.get_string(ItemKey::Lyrics)));

    let pictures = tag.pictures();
    let cover = pictures.iter().find(|p| p.pic_type() == PictureType::CoverFront).or_else(|| pictures.first());
    metadata.cover = cover.map(|p| p.data().to_vec()).filter(|data| !data.is_empty());
}

fn year(tag: &Tag) -> Option<i32> {
    let year = tag.date().map(|date| i32::from(date.year)).or_else(|| {
        let text = tag.get_string(ItemKey::Year).or_else(|| tag.get_string(ItemKey::RecordingDate))?;
        text.trim().get(..4)?.parse().ok()
    })?;
    (1..3000).contains(&year).then_some(year)
}

fn clean(value: Option<&str>) -> Option<String> {
    let cleaned = value?.replace('\0', "");
    let cleaned = cleaned.trim();
    (!cleaned.is_empty()).then(|| cleaned.to_owned())
}

fn clean_all<'a>(values: impl Iterator<Item = &'a str>) -> Vec<String> {
    values.filter_map(|value| clean(Some(value))).collect()
}

#[derive(Debug, Clone, Default)]
pub struct AudioTags {
    pub title: String,
    pub artists: Vec<String>,
    pub album_artists: Vec<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    pub cover: Option<Vec<u8>>,
    pub lyrics: Option<String>,
}

pub fn write(path: &Path, tags: &AudioTags) -> anyhow::Result<()> {
    let mut tagged = Probe::open(path)?.guess_file_type()?.read().context("Not a readable audio file")?;
    let tag_type = tagged.primary_tag_type();
    if tagged.tag(tag_type).is_none() {
        tagged.insert_tag(Tag::new(tag_type));
    }
    let tag = tagged.tag_mut(tag_type).context("The file cannot hold tags")?;

    tag.set_title(tags.title.clone());
    for (key, values) in [(ItemKey::TrackArtist, &tags.artists), (ItemKey::AlbumArtist, &tags.album_artists)] {
        tag.remove_key(key);
        for value in values {
            tag.push(TagItem::new(key, ItemValue::Text(value.clone())));
        }
    }
    match &tags.album {
        Some(album) => tag.set_album(album.clone()),
        None => tag.remove_album(),
    }
    match &tags.genre {
        Some(genre) => tag.set_genre(genre.clone()),
        None => tag.remove_genre(),
    }
    match tags.year.filter(|&year| year > 0) {
        Some(year) => {
            tag.insert_text(ItemKey::RecordingDate, year.to_string());
        }
        None => tag.remove_key(ItemKey::RecordingDate),
    }
    match tags.track_number.and_then(|n| u32::try_from(n).ok()).filter(|&n| n > 0) {
        Some(number) => tag.set_track(number),
        None => tag.remove_track(),
    }
    match tags.disc_number.and_then(|n| u32::try_from(n).ok()).filter(|&n| n > 0) {
        Some(number) => tag.set_disk(number),
        None => tag.remove_disk(),
    }
    if let Some(cover) = tags.cover.as_ref().filter(|cover| !cover.is_empty()) {
        let mime = if cover.starts_with(&[0x89, 0x50, 0x4E, 0x47]) { MimeType::Png } else { MimeType::Jpeg };
        tag.remove_picture_type(PictureType::CoverFront);
        tag.push_picture(Picture::unchecked(cover.clone()).pic_type(PictureType::CoverFront).mime_type(mime).build());
    }
    if let Some(lyrics) = tags.lyrics.as_ref().filter(|text| !text.trim().is_empty()) {
        let key = if tag_type == TagType::Id3v2 { ItemKey::UnsyncLyrics } else { ItemKey::Lyrics };
        tag.remove_key(ItemKey::Lyrics);
        tag.remove_key(ItemKey::UnsyncLyrics);
        tag.insert_text(key, lyrics.clone());
    }

    tagged.save_to_path(path, WriteOptions::default()).context("Could not write the tags")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_values_are_dropped() {
        assert_eq!(clean(Some(" \0 ")), None);
    }

    #[test]
    fn values_are_trimmed() {
        assert_eq!(clean(Some("  Aurora Lane ")), Some("Aurora Lane".to_owned()));
    }
}
