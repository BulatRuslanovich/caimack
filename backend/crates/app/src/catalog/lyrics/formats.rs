// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use super::{LyricLine, LyricWord, MAX_LENGTH, OFFSET, ParsedLyrics, TIMESTAMP, pattern};
use anyhow::{Context, bail, ensure};
use regex::Regex;
use roxmltree::Node;
use std::sync::LazyLock;

static WORD: LazyLock<Regex> = LazyLock::new(|| pattern(r"<(?<m>\d{1,3}):(?<s>[0-5]\d)(?:[.:](?<f>\d{1,3}))?>"));
static HEADER: LazyLock<Regex> = LazyLock::new(|| pattern(r"\[(\d+),(\d+)\]"));
static NUMERIC_WORD: LazyLock<Regex> = LazyLock::new(|| pattern(r"\((\d+),(\d+)(?:,\d+)?\)"));
const MAX_TIME: i32 = 86_400_000;

fn timestamp(c: &regex::Captures<'_>) -> i32 {
    let f = c.name("f").map_or("", |v| v.as_str());
    c["m"].parse::<i32>().unwrap_or(0) * 60000
        + c["s"].parse::<i32>().unwrap_or(0) * 1000
        + format!("{f:0<3}").parse::<i32>().unwrap_or(0)
}

pub(super) fn parse(raw: &str, format: &str, duration: i32) -> anyhow::Result<ParsedLyrics> {
    ensure!(raw.len() <= MAX_LENGTH && !raw.contains('\0'), "Invalid or oversized lyrics");
    let mut lines = match format.to_ascii_lowercase().as_str() {
        "ttml" => ttml(raw)?,
        "qrc" | "yrc" => numeric(raw, format == "yrc")?,
        "lrc" | "enhanced_lrc" | "richsync" => lrc(raw, duration)?,
        "plain" | "text" | "txt" => return Ok(ParsedLyrics { plain: raw.trim().to_owned(), lines: Vec::new() }),
        _ => bail!("Unsupported lyric format"),
    };
    lines.sort_by_key(|line| line.at);
    ensure!(lines.len() <= 5000, "Too many lyric lines");
    let limit = if duration > 0 { (duration + 2000.max(duration / 100)).min(MAX_TIME) } else { MAX_TIME };
    let mut count = 0;
    for line in &lines {
        let end = line.end.unwrap_or(line.at);
        ensure!(0 <= line.at && line.at <= end && end <= limit, "Invalid lyric line interval");
        let mut previous = line.at;
        for word in &line.words {
            count += 1;
            ensure!(previous <= word.at && word.at <= word.end && word.end <= end, "Invalid word interval");
            previous = word.at;
        }
    }
    ensure!(count <= 50000, "Too many lyric fragments");
    let plain = lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join("\n");
    ensure!(!plain.trim().is_empty(), "Empty lyrics");
    Ok(ParsedLyrics { plain, lines })
}

fn lrc(raw: &str, duration: i32) -> anyhow::Result<Vec<LyricLine>> {
    let offset = OFFSET.captures_iter(raw).last().and_then(|c| c["ms"].parse::<i32>().ok()).unwrap_or(0);
    let mut rows = Vec::new();
    for row in raw.lines() {
        let content = TIMESTAMP.replace_all(row, "").trim().to_owned();
        let stamps: Vec<_> = TIMESTAMP.captures_iter(row).map(|c| timestamp(&c)).collect();
        if stamps.is_empty() && WORD.is_match(row) {
            rows.push((WORD.captures(row).map_or(0, |c| timestamp(&c)), row.to_owned()));
        } else {
            rows.extend(stamps.into_iter().map(|at| (at, content.clone())));
        }
        ensure!(rows.len() <= 5000, "Too many lyric lines");
    }
    rows.sort_by_key(|(at, _)| *at);
    let mut lines = Vec::new();
    for (index, (start, content)) in rows.iter().enumerate() {
        let markers: Vec<_> = WORD.captures_iter(content).collect();
        let line_end = rows
            .get(index + 1)
            .map_or_else(|| duration.max(*start).max(markers.last().map_or(*start, timestamp)), |row| row.0);
        let mut line = LyricLine::new((start - offset).max(0), content.clone());
        line.end = Some((line_end - offset).max(line.at));
        if !markers.is_empty() {
            ensure!(
                content[..markers[0].get(0).context("Missing marker")?.start()].trim().is_empty(),
                "Untimed word prefix"
            );
            for (i, marker) in markers.iter().enumerate() {
                let whole = marker.get(0).context("Missing marker")?;
                let stop = markers.get(i + 1).and_then(|c| c.get(0)).map_or(content.len(), |m| m.start());
                let text = &content[whole.end()..stop];
                if text.is_empty() {
                    continue;
                }
                let at = timestamp(marker) - offset;
                // Enhanced LRC supplies starts; the next marker closes the fragment.
                let end = markers.get(i + 1).map_or(line_end, timestamp) - offset;
                ensure!(at >= line.at && end >= at, "Out of order word timing");
                line.words.push(LyricWord { at, end, text: text.to_owned() });
            }
            line.text = line.words.iter().map(|w| w.text.as_str()).collect::<String>();
            line.end = Some(line.words.iter().map(|w| w.end).max().unwrap_or(line.at).max(line.end.unwrap_or(0)));
        }
        lines.push(line);
    }
    Ok(lines)
}

fn xml(raw: &str) -> anyhow::Result<roxmltree::Document<'_>> {
    // roxmltree also rejects DTDs by default; explicitly forbid them for clarity.
    ensure!(
        !raw.to_ascii_uppercase().contains("<!DOCTYPE") && !raw.to_ascii_uppercase().contains("<!ENTITY"),
        "DTD is forbidden"
    );
    roxmltree::Document::parse(raw).context("Invalid lyrics XML")
}

fn clock(raw: &str, frame_rate: f64, tick_rate: f64) -> Option<i32> {
    let value = raw.trim();
    let milliseconds = if let Some(v) = value.strip_suffix("ms") {
        v.parse::<f64>().ok()?
    } else if let Some(v) = value.strip_suffix('h') {
        v.parse::<f64>().ok()? * 3600000.0
    } else if let Some(v) = value.strip_suffix('m') {
        v.parse::<f64>().ok()? * 60000.0
    } else if let Some(v) = value.strip_suffix('s') {
        v.parse::<f64>().ok()? * 1000.0
    } else if let Some(v) = value.strip_suffix('f') {
        v.parse::<f64>().ok()? * 1000.0 / frame_rate
    } else if let Some(v) = value.strip_suffix('t') {
        v.parse::<f64>().ok()? * 1000.0 / tick_rate
    } else {
        let parts: Vec<_> = value.split(':').map(str::parse::<f64>).collect::<Result<_, _>>().ok()?;
        match parts.as_slice() {
            [m, s] if *s < 60.0 => (m * 60.0 + s) * 1000.0,
            [h, m, s] if *m < 60.0 && *s < 60.0 => (h * 3600.0 + m * 60.0 + s) * 1000.0,
            [h, m, s, f] if *m < 60.0 && *s < 60.0 && *f < frame_rate => {
                (h * 3600.0 + m * 60.0 + s + f / frame_rate) * 1000.0
            }
            _ => return None,
        }
    };
    (milliseconds.is_finite() && (0.0..=f64::from(MAX_TIME)).contains(&milliseconds))
        .then_some(milliseconds.round() as i32)
}

fn role(node: Node<'_, '_>, value: &str) -> bool {
    node.attributes().any(|attr| attr.name() == "role" && attr.value() == value)
}

fn ignored(node: Node<'_, '_>) -> bool {
    node.ancestors().any(|n| role(n, "x-translation") || role(n, "x-roman") || role(n, "x-romanization"))
}

fn bounds(node: Node<'_, '_>, frame: f64, tick: f64) -> anyhow::Result<(i32, Option<i32>)> {
    let parent = node.parent_element().map(|p| bounds(p, frame, tick)).transpose()?.unwrap_or((0, None));
    let resolve = |value: &str| -> anyhow::Result<i32> {
        let time = clock(value, frame, tick).context("Invalid TTML time")?;
        if value.trim().ends_with(['h', 'm', 's', 'f', 't']) {
            parent.0.checked_add(time).context("TTML time overflow")
        } else {
            Ok(time)
        }
    };
    let at = node.attribute("begin").map(resolve).transpose()?.unwrap_or(parent.0);
    let end = if let Some(end) = node.attribute("end") {
        Some(resolve(end)?)
    } else if let Some(dur) = node.attribute("dur") {
        Some(at.checked_add(clock(dur, frame, tick).context("Invalid TTML duration")?).context("TTML overflow")?)
    } else {
        parent.1
    };
    Ok((at, end))
}

fn ttml(raw: &str) -> anyhow::Result<Vec<LyricLine>> {
    let doc = xml(raw)?;
    let root = doc.root_element();
    ensure!(
        !root.descendants().any(|node| node.attribute("timeContainer") == Some("seq")),
        "Sequential TTML containers are unsupported"
    );
    let attr = |name| root.attributes().find(|a| a.name() == name).map(|a| a.value());
    let mut frame = attr("frameRate").unwrap_or("30").parse::<f64>()?;
    if let Some(mult) = attr("frameRateMultiplier") {
        let (n, d) = mult.split_once(' ').context("Invalid frame multiplier")?;
        frame *= n.parse::<f64>()? / d.parse::<f64>()?;
    }
    let tick = attr("tickRate").unwrap_or("1").parse::<f64>()?;
    ensure!(frame.is_finite() && frame > 0.0 && frame <= 240.0 && tick.is_finite() && tick > 0.0, "Invalid TTML rate");
    let mut lines = Vec::new();
    for node in root.descendants().filter(|n| n.has_tag_name("p") || role(*n, "x-bg")) {
        if ignored(node) {
            continue;
        }
        ensure!(node.ancestors().count() <= 64, "TTML nesting too deep");
        let (at, end) = bounds(node, frame, tick)?;
        let mut line = LyricLine::new(at, String::new());
        line.background = role(node, "x-bg");
        let mut untimed = false;
        for text in node.descendants().filter(|n| (n.is_text() || n.has_tag_name("br")) && !ignored(*n)) {
            if text.ancestors().take_while(|n| *n != node).any(|n| role(n, "x-bg")) {
                continue;
            }
            if text.has_tag_name("br") {
                line.text.push('\n');
                if let Some(word) = line.words.last_mut() {
                    word.text.push('\n');
                }
                continue;
            }
            let fragment = text.text().unwrap_or("");
            let timed = text.ancestors().take_while(|n| *n != node).find(|n| {
                n.attribute("begin").is_some() && (n.attribute("end").is_some() || n.attribute("dur").is_some())
            });
            if let Some(timed) = timed {
                let (at, end) = bounds(timed, frame, tick)?;
                line.words.push(LyricWord {
                    at,
                    end: end.context("Missing TTML fragment end")?,
                    text: fragment.to_owned(),
                });
                line.text.push_str(fragment);
            } else if fragment.trim().is_empty() {
                if fragment.contains(['\n', '\r', '\t']) {
                    continue;
                }
                if let Some(word) = line.words.last_mut() {
                    word.text.push_str(fragment);
                    line.text.push_str(fragment);
                }
            } else {
                untimed = true;
                line.text.push_str(fragment);
            }
        }
        if line.text.trim().is_empty() {
            continue;
        }
        if untimed {
            line.words.clear();
        }
        line.end = end.or_else(|| line.words.iter().map(|w| w.end).max());
        ensure!(line.end.is_some(), "Missing TTML line end");
        lines.push(line);
    }
    Ok(lines)
}

fn numeric(raw: &str, yrc: bool) -> anyhow::Result<Vec<LyricLine>> {
    let payload;
    let raw = if raw.trim_start().starts_with('<') {
        let doc = xml(raw)?;
        payload = doc.descendants().filter_map(|n| n.attribute("LyricContent")).collect::<Vec<_>>().join("\n");
        payload.as_str()
    } else {
        raw
    };
    let headers: Vec<_> = HEADER.captures_iter(raw).collect();
    let mut lines = Vec::new();
    for (i, header) in headers.iter().enumerate() {
        let whole = header.get(0).context("Missing numeric header")?;
        let stop = headers.get(i + 1).and_then(|c| c.get(0)).map_or(raw.len(), |m| m.start());
        let content = raw[whole.end()..stop].trim_end();
        let at = header[1].parse::<i32>()?;
        let end = at.checked_add(header[2].parse::<i32>()?).context("Numeric lyric overflow")?;
        let markers: Vec<_> = NUMERIC_WORD.captures_iter(content).collect();
        let mut line = LyricLine::new(at, String::new());
        line.end = Some(end);
        let mut position = 0;
        for (j, marker) in markers.iter().enumerate() {
            let whole = marker.get(0).context("Missing numeric marker")?;
            let stop = markers.get(j + 1).and_then(|c| c.get(0)).map_or(content.len(), |m| m.start());
            if yrc && j == 0 {
                ensure!(content[..whole.start()].trim().is_empty(), "Untimed YRC prefix");
            }
            let text = if yrc { &content[whole.end()..stop] } else { &content[position..whole.start()] };
            let at = marker[1].parse::<i32>()?;
            let end = at.checked_add(marker[2].parse::<i32>()?).context("Word timing overflow")?;
            if !text.is_empty() {
                line.words.push(LyricWord { at, end, text: text.to_owned() });
                line.text.push_str(text);
            }
            position = whole.end();
        }
        if !yrc {
            ensure!(content[position..].trim().is_empty(), "Untimed QRC suffix");
        }
        if !line.words.is_empty() {
            lines.push(line);
        }
    }
    Ok(lines)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ttml_preserves_syllables_background_and_unicode() {
        let p = parse(r#"<tt xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div><p begin="1s" end="3s"><span begin="0s" end="0.5s">При</span><span begin="0.5s" end="1s">вет </span><span ttm:role="x-bg" begin="1s" end="2s"><span begin="0s" end="1s">эй</span></span><span ttm:role="x-translation">Hello</span></p></div></body></tt>"#, "ttml", 5000).unwrap();
        assert_eq!(p.lines[0].text, "Привет ");
        assert_eq!(p.lines[0].words.len(), 2);
        assert!(p.lines[1].background);
        assert_eq!(p.lines[0].words[0].at, 1000);
        assert_eq!(p.lines[1].words[0].at, 2000);
    }
    #[test]
    fn qrc_and_yrc_keep_exact_word_durations() {
        for (fmt, raw) in [
            ("qrc", "[1000,2000]Hello (1000,500)world(1700,800)"),
            ("yrc", "[1000,2000](1000,500,0)Hello (1700,800,0)world"),
        ] {
            let p = parse(raw, fmt, 5000).unwrap();
            assert_eq!(p.lines[0].words[0].end, 1500);
            assert_eq!(p.lines[0].words[1].at, 1700);
        }
    }
    #[test]
    fn malformed_and_unsafe_timings_are_rejected() {
        for (fmt, raw) in [
            ("ttml", "<!DOCTYPE tt [<!ENTITY x 'oops'>]><tt/>"),
            ("yrc", "[1000,1000](1500,2000,0)bad"),
            ("lrc", "[00:02]<00:02>one<00:01>two"),
            ("ttml", "<tt><body><p begin='1s' end='2s'><span begin='1s' end='NaNs'>bad</span></p></body></tt>"),
        ] {
            assert!(parse(raw, fmt, 5000).is_err(), "{raw}");
        }
    }
}
