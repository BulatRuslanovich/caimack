// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use super::{Candidate, LyricsQuery};
use crate::catalog::lyrics::parse_format;
use crate::text::to_latin;
use regex::Regex;
use std::sync::LazyLock;

static DECORATION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\s*[\[(](?:official(?: music)? video|official audio|lyrics?|\d{4} remaster(?:ed)?|remaster(?:ed)?(?: \d{4})?|deluxe(?: edition)?)[\])]\s*").unwrap_or_else(|e| unreachable!("{e}"))
});
static VERSION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)(?:\b(sped(?: up)?|speed up|slowed(?: down)?|remix|live|acoustic|cover|instrumental|караоке|ремикс)\b)",
    )
    .unwrap_or_else(|e| unreachable!("{e}"))
});

pub(super) fn key(text: &str) -> String {
    to_latin(text).to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect()
}

fn title(text: &str) -> String {
    key(&DECORATION.replace_all(text, " "))
}

pub(super) fn candidate(
    query: &LyricsQuery,
    name: &str,
    artist: &str,
    duration: f64,
    raw: &str,
    format: &str,
    provider: &'static str,
) -> Option<Candidate> {
    if name.trim().is_empty() || artist.trim().is_empty() || query.artist.trim().is_empty() {
        return None;
    }
    let requested = title(&query.title);
    let offered = title(name);
    let same = requested == offered;
    let base = !same
        && VERSION.find(&query.title).is_some_and(|m| {
            matches!(
                m.as_str().to_ascii_lowercase().as_str(),
                "sped" | "sped up" | "speed up" | "slowed" | "slowed down" | "remix" | "ремикс"
            )
        })
        && title(&VERSION.replace_all(&query.title, "").replace(['(', ')', '[', ']'], "")) == offered;
    if !same && !base {
        return None;
    }
    // Full credit or the same leading artist is required; transliteration is deterministic.
    let leading = |s: &str| key(s.split([',', ';', '&']).next().unwrap_or(s).split(" feat.").next().unwrap_or(s));
    if key(artist) != key(&query.artist) && leading(artist) != leading(&query.artist) {
        return None;
    }
    let wanted = f64::from(query.duration_seconds);
    let known = duration.is_finite() && duration > 0.0 && wanted > 0.0;
    let difference = if known { (wanted - duration).abs() } else { f64::INFINITY };
    if same && known && difference > 15.0_f64.max(wanted * 0.05) {
        return None;
    }
    let parsed = parse_format(raw, format, if known { (duration * 1000.0).round() as i32 } else { 0 })
        .ok()?
        .clean_for_track(&query.title, &query.artist);
    if parsed.is_empty() {
        return None;
    }
    let parsed =
        if base || !known || difference > 6.0_f64.max(wanted * 0.035) { parsed.without_timing() } else { parsed };
    Some(Candidate {
        parsed,
        provider,
        format: format.to_owned(),
        original: raw.to_owned(),
        attribution: serde_json::Value::Null,
        exact: same,
        duration_difference: if known { (difference * 1000.0).round() as i32 } else { i32::MAX },
    })
}
