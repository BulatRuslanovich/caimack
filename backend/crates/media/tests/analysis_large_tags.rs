// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::process::Command;

use media::tags::{self, AudioTags};

#[test]
fn mp3_behind_a_large_cover_is_analysed() {
    let file = std::env::temp_dir().join(format!("caimack-analysis-{}.mp3", uuid::Uuid::now_v7().simple()));
    let status = Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=44100",
        ])
        .args(["-t", "10", "-y"])
        .arg(&file)
        .status()
        .expect("ffmpeg must be on PATH");
    assert!(status.success(), "ffmpeg could not write an mp3 file");

    let mut cover = vec![0xFF, 0xD8, 0xFF, 0xE0];
    cover.resize(2 * 1024 * 1024, 7);
    let written = AudioTags { title: "Big cover".to_owned(), cover: Some(cover), ..AudioTags::default() };
    tags::write(&file, &written).expect("write tags");

    let analysis = media::analysis::analyze(&file, 10.0, false);
    std::fs::remove_file(&file).expect("clean up");

    let analysis = analysis.expect("the audio after a 2 MB tag must be readable");
    assert!(analysis.loudness.is_some());
}
