// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::BTreeMap;
use std::sync::LazyLock;

use chrono::Utc;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use sqlx::types::Json;
use uuid::Uuid;

use super::tracks;
use crate::AppResult;

const MAX_LENGTH: usize = 20_000;

static TIMESTAMP: LazyLock<Regex> =
    LazyLock::new(|| pattern(r"\[(?<m>\d{1,3}):(?<s>[0-5]?\d)(?:[.:](?<f>\d{1,3}))?\]"));
static METADATA: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^\[[a-z]{2,10}:.*\]$"));
static OFFSET: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)\[offset:\s*(?<ms>[+-]?\d{1,6})\s*\]"));

fn pattern(source: &str) -> Regex {
    Regex::new(source).unwrap_or_else(|error| unreachable!("lyrics pattern {source} is valid: {error}"))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LyricLine {
    pub at: i32,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum LyricsSource {
    Embedded = 0,
    Manual = 1,
    Provider = 2,
}

impl LyricsSource {
    fn from_db(value: i32) -> Self {
        match value {
            1 => Self::Manual,
            2 => Self::Provider,
            _ => Self::Embedded,
        }
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct ParsedLyrics {
    pub plain: String,
    pub lines: Vec<LyricLine>,
}

impl ParsedLyrics {
    pub fn is_empty(&self) -> bool {
        self.plain.is_empty() && self.lines.is_empty()
    }
}

pub fn parse(raw: Option<&str>) -> ParsedLyrics {
    let Some(raw) = raw.filter(|raw| !raw.trim().is_empty()) else {
        return ParsedLyrics::default();
    };

    let mut text = raw.replace('\0', "").replace("\r\n", "\n").replace('\r', "\n");
    if text.chars().count() > MAX_LENGTH {
        text = text.chars().take(MAX_LENGTH).collect();
    }

    let offset = OFFSET.captures(&text).and_then(|captures| captures["ms"].parse::<i32>().ok()).map_or(0, |ms| -ms);

    let mut timed = Vec::new();
    let mut plain = String::new();
    for line in text.split('\n') {
        let stamps: Vec<_> = TIMESTAMP.captures_iter(line).collect();
        if stamps.is_empty() {
            let content = line.trim();
            if !content.is_empty() && !METADATA.is_match(content) {
                append_line(&mut plain, content);
            }
            continue;
        }

        let content = TIMESTAMP.replace_all(line, "");
        let content = content.trim();
        for stamp in stamps {
            let minutes: i32 = stamp["m"].parse().unwrap_or(0);
            let seconds: i32 = stamp["s"].parse().unwrap_or(0);
            let fraction = stamp.name("f").map_or("", |f| f.as_str());
            let millis = match fraction.len() {
                0 => 0,
                1 => fraction.parse::<i32>().unwrap_or(0) * 100,
                2 => fraction.parse::<i32>().unwrap_or(0) * 10,
                _ => fraction[..3].parse().unwrap_or(0),
            };
            let at = ((minutes * 60 + seconds) * 1000 + millis + offset).max(0);
            timed.push(LyricLine { at, text: content.to_owned() });
        }
        append_line(&mut plain, content);
    }

    build(&plain, timed)
}

pub fn from_timed_lines(lines: Vec<LyricLine>) -> ParsedLyrics {
    let mut timed: Vec<LyricLine> = lines.into_iter().filter(|line| line.at >= 0).collect();
    if timed.is_empty() {
        return ParsedLyrics::default();
    }
    timed.sort_by_key(|line| line.at);
    let mut plain = String::new();
    for line in &timed {
        append_line(&mut plain, line.text.trim());
    }
    build(&plain, timed)
}

fn build(plain: &str, timed: Vec<LyricLine>) -> ParsedLyrics {
    let text = plain.trim_end_matches('\n');
    if text.is_empty() && timed.is_empty() {
        return ParsedLyrics::default();
    }

    let mut by_time = BTreeMap::new();
    for line in timed {
        by_time.entry(line.at).or_insert(line);
    }
    ParsedLyrics { plain: text.to_owned(), lines: by_time.into_values().collect() }
}

fn append_line(plain: &mut String, content: &str) {
    if content.is_empty() && (plain.is_empty() || plain.ends_with("\n\n")) {
        return;
    }
    plain.push_str(content);
    plain.push('\n');
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsDto {
    pub track_id: Uuid,
    pub plain: String,
    pub lines: Vec<LyricLine>,
    pub source: LyricsSource,
}

pub async fn get(db: &PgPool, track_id: Uuid) -> AppResult<Option<LyricsDto>> {
    let row = sqlx::query!(
        r#"SELECT track_id, plain, synced AS "synced: Json<Vec<LyricLine>>", source FROM track_lyrics WHERE track_id = $1"#,
        track_id
    )
    .fetch_optional(db)
    .await?;

    Ok(row.map(|row| LyricsDto {
        track_id: row.track_id,
        plain: row.plain,
        lines: row.synced.0,
        source: LyricsSource::from_db(row.source),
    }))
}

pub async fn replace(db: &PgPool, track_id: Uuid, text: Option<&str>) -> AppResult<Option<LyricsDto>> {
    tracks::require(db, track_id).await?;
    let parsed = parse(text);

    if parsed.is_empty() {
        sqlx::query!("DELETE FROM track_lyrics WHERE track_id = $1", track_id).execute(db).await?;
        return Ok(None);
    }

    sqlx::query!(
        "INSERT INTO track_lyrics (track_id, plain, synced, source, updated_at) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (track_id) DO UPDATE
         SET plain = EXCLUDED.plain, synced = EXCLUDED.synced, source = EXCLUDED.source, updated_at = EXCLUDED.updated_at",
        track_id,
        parsed.plain,
        Json(&parsed.lines) as _,
        LyricsSource::Manual as i32,
        Utc::now()
    )
    .execute(db)
    .await?;

    Ok(Some(LyricsDto { track_id, plain: parsed.plain, lines: parsed.lines, source: LyricsSource::Manual }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(at: i32, text: &str) -> LyricLine {
        LyricLine { at, text: text.to_owned() }
    }

    #[test]
    fn lrc_lines_get_timestamps_and_plain_text() {
        let parsed = parse(Some("[ar:Someone]\n[00:02.00]First\n[00:10.5]Second\n\n\nPlain tail"));
        assert_eq!(
            parsed,
            ParsedLyrics {
                plain: "First\nSecond\nPlain tail".to_owned(),
                lines: vec![line(2000, "First"), line(10500, "Second")]
            }
        );
    }

    #[test]
    fn offset_shifts_every_line() {
        let parsed = parse(Some("[offset:+500]\n[00:01.00]Hi"));
        assert_eq!(parsed.lines, [line(500, "Hi")]);
    }

    #[test]
    fn one_line_with_several_stamps_repeats() {
        let parsed = parse(Some("[00:01.00][00:20.00]Chorus"));
        assert_eq!(parsed.lines, [line(1000, "Chorus"), line(20000, "Chorus")]);
    }

    #[test]
    fn blank_text_is_empty() {
        assert!(parse(Some(" \n ")).is_empty());
    }
}
