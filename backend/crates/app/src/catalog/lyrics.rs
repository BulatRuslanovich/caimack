// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::sync::LazyLock;

use chrono::Utc;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use sqlx::types::Json;
use uuid::Uuid;

use super::tracks;
use crate::AppResult;

mod formats;

pub const MAX_LENGTH: usize = 2 * 1024 * 1024;

static TIMESTAMP: LazyLock<Regex> =
    LazyLock::new(|| pattern(r"\[(?<m>\d{1,3}):(?<s>[0-5]?\d)(?:[.:](?<f>\d{1,3}))?\]"));
static METADATA: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^\[[a-z]{2,10}:.*\]$"));
static OFFSET: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)\[offset:\s*(?<ms>[+-]?\d{1,6})\s*\]"));
static WORD_TIMESTAMP: LazyLock<Regex> = LazyLock::new(|| pattern(r"<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>"));
static TTML: LazyLock<Regex> = LazyLock::new(|| pattern(r"<(?:[A-Za-z_][\w.-]*:)?tt(?:\s|>)"));
static NUMERIC_LYRICS: LazyLock<Regex> = LazyLock::new(|| pattern(r"\[\d+,\d+\]"));
static YRC_WORD: LazyLock<Regex> = LazyLock::new(|| pattern(r"\(\d+,\d+,\d+\)"));

fn rich_format(raw: &str) -> Option<&'static str> {
    if TTML.is_match(raw) {
        Some("ttml")
    } else if NUMERIC_LYRICS.is_match(raw) || raw.contains("LyricContent=") {
        Some(if YRC_WORD.is_match(raw) { "yrc" } else { "qrc" })
    } else if WORD_TIMESTAMP.is_match(raw) {
        Some("lrc")
    } else {
        None
    }
}

pub(crate) fn pattern(source: &str) -> Regex {
    Regex::new(source).unwrap_or_else(|error| unreachable!("lyrics pattern {source} is valid: {error}"))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LyricLine {
    pub at: i32,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<i32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub words: Vec<LyricWord>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub background: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LyricWord {
    pub at: i32,
    pub end: i32,
    pub text: String,
}

impl LyricLine {
    pub fn new(at: i32, text: String) -> Self {
        Self { at, text, end: None, words: Vec::new(), background: false }
    }
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

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParsedLyrics {
    pub plain: String,
    pub lines: Vec<LyricLine>,
}

impl ParsedLyrics {
    pub fn is_empty(&self) -> bool {
        self.plain.is_empty() && self.lines.is_empty()
    }

    /// Richness plus coverage: partially timed documents never outrank fully timed ones.
    pub fn quality(&self) -> i16 {
        if self.lines.is_empty() {
            return 0;
        }
        let vocal = self.lines.iter().filter(|line| !line.text.trim().is_empty()).count();
        let rich = self.lines.iter().filter(|line| !line.words.is_empty()).count();
        if rich == 0 { 100 } else { 100 + (100 * rich / vocal.max(1)) as i16 }
    }

    pub fn without_timing(self) -> Self {
        Self { plain: self.plain, lines: Vec::new() }
    }
}

pub fn parse(raw: Option<&str>) -> ParsedLyrics {
    let Some(raw) = raw.filter(|raw| !raw.trim().is_empty()) else {
        return ParsedLyrics::default();
    };

    if let Some(format) = rich_format(raw) {
        return parse_format(raw, format, 0).unwrap_or_default();
    }
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
            timed.push(LyricLine::new(at, content.to_owned()));
        }
        append_line(&mut plain, content);
    }

    build(&plain, timed)
}

pub fn parse_format(raw: &str, format: &str, duration_ms: i32) -> anyhow::Result<ParsedLyrics> {
    formats::parse(raw, format, duration_ms)
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

fn build(plain: &str, mut timed: Vec<LyricLine>) -> ParsedLyrics {
    let text = plain.trim_end_matches('\n');
    if text.is_empty() && timed.is_empty() {
        return ParsedLyrics::default();
    }

    timed.sort_by_key(|line| line.at);
    timed.dedup();
    ParsedLyrics { plain: text.to_owned(), lines: timed }
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
    pub provider: Option<String>,
    pub sync_type: &'static str,
    pub attribution: serde_json::Value,
    pub original_lyrics: Option<String>,
}

pub async fn get(db: &PgPool, track_id: Uuid) -> AppResult<Option<LyricsDto>> {
    #[derive(sqlx::FromRow)]
    struct Row {
        track_id: Uuid,
        plain: String,
        synced: Json<Vec<LyricLine>>,
        source: i32,
        provider: Option<String>,
        source_format: Option<String>,
        attribution: serde_json::Value,
        original_lyrics: Option<String>,
    }
    let row = sqlx::query_as::<_, Row>(
        "SELECT track_id,plain,synced,source,provider,source_format,attribution,original_lyrics FROM track_lyrics WHERE track_id=$1",
    )
    .bind(track_id)
    .fetch_optional(db)
    .await?;

    Ok(row.map(|row| {
        let sync_type = if row.synced.iter().any(|line| !line.words.is_empty()) {
            if row.source_format.as_deref() == Some("ttml") { "syllable" } else { "word" }
        } else if row.synced.is_empty() {
            "plain"
        } else {
            "line"
        };
        LyricsDto {
            track_id: row.track_id,
            plain: row.plain,
            lines: row.synced.0,
            source: LyricsSource::from_db(row.source),
            provider: row.provider,
            sync_type,
            attribution: row.attribution,
            original_lyrics: row.original_lyrics,
        }
    }))
}

/// Prioritize visible tracks while preserving provider failure/negative-cache backoff.
pub async fn prioritize(db: &PgPool, track_id: Uuid) -> AppResult<bool> {
    let changed = sqlx::query(
        "INSERT INTO enrichment_jobs(kind,entity_id,track_id,priority)
         SELECT 'lyrics',id,id,-10 FROM tracks WHERE id=$1
         ON CONFLICT (kind,entity_id) DO UPDATE SET priority=-10,
             next_attempt_at=least(enrichment_jobs.next_attempt_at,now()),updated_at=now()
         WHERE (enrichment_jobs.locked_until IS NULL OR enrichment_jobs.locked_until<now())
           AND (enrichment_jobs.last_outcome IS NULL OR enrichment_jobs.next_attempt_at<=now())",
    )
    .bind(track_id)
    .execute(db)
    .await?;
    Ok(changed.rows_affected() > 0)
}

pub async fn replace(db: &PgPool, track_id: Uuid, text: Option<&str>) -> AppResult<Option<LyricsDto>> {
    tracks::require(db, track_id).await?;
    let parsed = if let Some((raw, format)) = text.and_then(|raw| rich_format(raw).map(|format| (raw, format))) {
        parse_format(raw, format, 0).map_err(|_| crate::AppError::validation("Invalid lyrics timing or format"))?
    } else {
        parse(text)
    };

    if parsed.is_empty() {
        sqlx::query!("DELETE FROM track_lyrics WHERE track_id = $1", track_id).execute(db).await?;
        return Ok(None);
    }

    sqlx::query(
        "INSERT INTO track_lyrics (track_id, plain, synced, source, updated_at,source_format,original_lyrics) VALUES ($1, $2, $3, $4, $5,$6,$7)
         ON CONFLICT (track_id) DO UPDATE
         SET plain = EXCLUDED.plain, synced = EXCLUDED.synced, source = EXCLUDED.source, updated_at = EXCLUDED.updated_at,
             provider=NULL,source_format=EXCLUDED.source_format,original_lyrics=EXCLUDED.original_lyrics,attribution='{}'::jsonb",
    ).bind(track_id).bind(&parsed.plain).bind(Json(&parsed.lines)).bind(LyricsSource::Manual as i32).bind(Utc::now())
    .bind(text.and_then(rich_format)).bind(text)
    .execute(db)
    .await?;

    get(db, track_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(at: i32, text: &str) -> LyricLine {
        LyricLine::new(at, text.to_owned())
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

    #[test]
    fn enhanced_lrc_retains_word_boundaries_and_spaces() {
        let parsed = parse(Some("[00:01.00]<00:01.00>Hello <00:01.50>world<00:02.00>\n[00:03.00]Next"));
        assert_eq!(parsed.lines[0].text, "Hello world");
        assert_eq!(parsed.lines[0].words[0].text, "Hello ");
        assert_eq!(parsed.lines[0].words[1].end, 2000);
    }

    #[test]
    fn old_json_remains_readable() {
        let line: LyricLine = serde_json::from_str(r#"{"at":1200,"text":"Hello"}"#).unwrap();
        assert!(line.words.is_empty());
    }
}
