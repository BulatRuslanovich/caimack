// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use super::{METADATA, TIMESTAMP, pattern};
use regex::Regex;
use std::borrow::Cow;
use std::sync::LazyLock;

static NUMERIC_HEADER: LazyLock<Regex> = LazyLock::new(|| pattern(r"^\s*\[\d+,\d+\]"));
static NUMERIC_WORD: LazyLock<Regex> = LazyLock::new(|| pattern(r"\(\d+,\d+(?:,\d+)?\)"));
static WORD: LazyLock<Regex> = LazyLock::new(|| pattern(r"<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>"));
static TAG: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?im)^\s*\[(ti|ar):([^\]\r\n]*)\]\s*$"));
static TITLE_SEPARATOR: LazyLock<Regex> = LazyLock::new(|| pattern(r"\s+[-–—|]\s+"));
static CREDIT: LazyLock<Regex> = LazyLock::new(|| {
    pattern(concat!(
        r"(?ix)^\s*(?:",
        r"作\s*[词詞]|作\s*曲|[词詞曲]|[编編]\s*曲|[编編]写|",
        r"制作(?:人|公司)?|製作(?:人|公司)?|[录錄]音(?:[师師])?|混音(?:[师師])?|母[带帶](?:工程[师師])?|",
        r"[监監]制|出品|[发發]行|版[权權]|和[声聲]|",
        r"lyrics?(?:\s+by)?|music(?:\s+by)?|words(?:\s+by)?|",
        r"(?:written|composed|produced|arranged|mixed|mastered|recorded)\s+by|",
        r"lyricist|composer|producer|arrangement|mixing|mastering|copyright|",
        r"автор(?:\s+текста)?|текст(?:\s+песни)?|слова|музыка|композитор|аранжировка|сведение|мастеринг|продюсер",
        r")\s*[:：]\s*\S"
    ))
});

/// A display-only view of provider envelopes. Vocal word intervals are never reassigned.
pub(super) fn text(row: &str) -> String {
    let row = row.trim_start_matches('\u{feff}');
    if NUMERIC_HEADER.is_match(row) {
        let content = NUMERIC_HEADER.replace(row, "");
        return NUMERIC_WORD.replace_all(&content, "").trim().to_owned();
    }
    let timed = TIMESTAMP.is_match(row) || WORD.is_match(row);
    if timed {
        let content = TIMESTAMP.replace_all(row, "");
        return WORD.replace_all(&content, "").trim().to_owned();
    }
    row.to_owned()
}

pub(super) fn is_credit(row: &str) -> bool {
    CREDIT.is_match(text(row).trim())
}

fn key(value: &str) -> String {
    value.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

pub(super) fn is_title(row: &str, title: &str, artist: &str) -> bool {
    if title.trim().is_empty() || artist.trim().is_empty() {
        return false;
    }
    let content = text(row);
    let title = key(title);
    let artist = key(artist);
    TITLE_SEPARATOR.find_iter(&content).any(|separator| {
        let left = key(&content[..separator.start()]);
        let right = key(&content[separator.end()..]);
        left == title && right == artist || left == artist && right == title
    })
}

/// Strip whole credit rows before format detection: some LRC responses begin with YRC credits.
pub(super) fn source(raw: &str) -> Cow<'_, str> {
    let mut title = "";
    let mut artist = "";
    for tag in TAG.captures_iter(raw) {
        if tag[1].eq_ignore_ascii_case("ti") {
            title = tag.get(2).map_or("", |m| m.as_str());
        } else {
            artist = tag.get(2).map_or("", |m| m.as_str());
        }
    }
    let unwanted = |row: &str| is_credit(row) || is_title(row, title, artist);
    if !raw.lines().any(unwanted) {
        return Cow::Borrowed(raw);
    }
    Cow::Owned(raw.lines().filter(|row| !unwanted(row)).collect::<Vec<_>>().join("\n"))
}

pub(super) fn plain(raw: &str) -> String {
    raw.lines()
        .filter_map(|row| {
            let content = text(row);
            (!CREDIT.is_match(content.trim()) && !METADATA.is_match(content.trim())).then_some(content)
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim_matches('\n')
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_credit_labels_are_removed_but_verses_are_preserved() {
        for row in [
            "作词 : Name",
            "作詞：Name",
            "作曲: Name",
            "编曲：Name",
            "制作人: Name",
            "Lyrics by: Name",
            "Written by: Name",
            "Музыка: Name",
        ] {
            assert!(is_credit(row), "{row}");
        }
        for row in [
            "[Chorus]",
            "[Припев]",
            "Music is all I need",
            "This is my music: loud",
            "Я написал тебе письмо",
            "Hello: world",
        ] {
            assert!(!is_credit(row), "{row}");
        }
    }

    #[test]
    fn titles_require_matching_track_metadata_and_a_real_separator() {
        assert!(is_title("[00:00.00]Adventure Of A Lifetime - Marcell", "Adventure Of A Lifetime", "Marcell"));
        assert!(!is_title("[00:20.00]Adventure Of A Lifetime - Other singer", "Adventure Of A Lifetime", "Marcell"));
        assert!(!is_title("Go on", "Go", "On"));
    }
}
