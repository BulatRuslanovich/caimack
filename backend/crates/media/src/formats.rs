// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::io::Read;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AudioFormat {
    pub extension: &'static str,
    pub mime_type: &'static str,
}

impl AudioFormat {
    pub fn label(self) -> String {
        self.extension.trim_start_matches('.').to_uppercase()
    }

    pub fn codec(self) -> &'static str {
        self.extension.trim_start_matches('.')
    }
}

pub const MP3: AudioFormat = AudioFormat { extension: ".mp3", mime_type: "audio/mpeg" };
pub const FLAC: AudioFormat = AudioFormat { extension: ".flac", mime_type: "audio/flac" };

pub const ACCEPTED: &str = ".mp3, .flac";

pub fn for_file_name(file_name: &str) -> Option<AudioFormat> {
    let extension = Path::new(file_name).extension()?.to_str()?.to_ascii_lowercase();
    match extension.as_str() {
        "mp3" => Some(MP3),
        "flac" => Some(FLAC),
        _ => None,
    }
}

pub fn is_lossless(codec: Option<&str>) -> bool {
    codec == Some("flac")
}

pub fn sniff_container(path: &Path) -> Option<&'static str> {
    let mut head = [0u8; 8];
    std::fs::File::open(path).ok()?.read_exact(&mut head).ok()?;
    head.starts_with(b"fLaC").then_some(".flac")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_is_case_insensitive() {
        assert_eq!(for_file_name("Song.FLAC"), Some(FLAC));
    }

    #[test]
    fn other_formats_are_rejected() {
        assert_eq!(for_file_name("song.ogg"), None);
    }

    #[test]
    fn label_is_upper_case_extension() {
        assert_eq!(MP3.label(), "MP3");
    }
}
