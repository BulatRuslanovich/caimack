// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

#![expect(clippy::expect_used, reason = "a test without ffmpeg or a temp dir cannot run at all")]

use std::path::PathBuf;
use std::process::Command;

use media::tags::{self, AudioTags};

fn silence(extension: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("caimack-tags-{}.{extension}", uuid::Uuid::now_v7().simple()));
    let status = Command::new("ffmpeg")
        .args(["-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"])
        .args(["-t", "1", "-y"])
        .arg(&path)
        .status()
        .expect("ffmpeg must be on PATH");
    assert!(status.success(), "ffmpeg could not write a .{extension} file");
    path
}

fn round_trip(extension: &str) {
    let file = silence(extension);
    let written = AudioTags {
        title: "Новая песня".to_owned(),
        artists: vec!["Первый".to_owned(), "Second Artist".to_owned()],
        album_artists: vec!["Первый".to_owned()],
        album: Some("Альбом".to_owned()),
        genre: Some("Русский рэп".to_owned()),
        year: Some(2024),
        track_number: Some(7),
        disc_number: Some(2),
        cover: Some(vec![0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]),
        lyrics: Some("[00:01.250]Первая строка\n[00:02.500]Second line".to_owned()),
    };

    tags::write(&file, &written).expect("write");
    let read = tags::read(&file).expect("read back");
    std::fs::remove_file(&file).expect("clean up");

    assert_eq!(
        (read.title.as_deref(), read.artists, read.album_artists, read.album.as_deref(), read.genre.as_deref()),
        (
            Some("Новая песня"),
            vec!["Первый".to_owned(), "Second Artist".to_owned()],
            vec!["Первый".to_owned()],
            Some("Альбом"),
            Some("Русский рэп")
        )
    );
    assert_eq!((read.year, read.track_number, read.disc_number), (Some(2024), Some(7), Some(2)));
    assert_eq!(read.cover, Some(vec![0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]));
    assert_eq!(read.lyrics, written.lyrics);
}

#[test]
fn mp3_tags_round_trip() {
    round_trip("mp3");
}

#[test]
fn flac_tags_round_trip() {
    round_trip("flac");
}
