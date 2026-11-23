// SPDX-License-Identifier: AGPL-3.0-only

use super::{Delivery, Hit, Recording, hosts};
use crate::{AppError, AppResult};
use regex::Regex;
use std::sync::LazyLock;

#[derive(Clone, Copy)]
pub(in super::super) struct Site {
    pub source: &'static str,
    pub split: &'static str,
    pub pattern: &'static [&'static str],
    pub domains: &'static [&'static str],
    pub bitrate: fn(&str) -> Option<i32>,
}

static TAGS: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(r"<[^>]*>").ok());

fn capture<'a>(regex: &Regex, input: &'a str) -> Option<&'a str> {
    regex.captures(input)?.get(1).map(|value| value.as_str())
}

pub(in super::super) fn clean(value: &str) -> String {
    let value = TAGS.as_ref().map_or_else(|| std::borrow::Cow::Borrowed(value), |tags| tags.replace_all(value, ""));
    html_escape::decode_html_entities(&value).trim().to_owned()
}

fn clock(value: &str) -> i32 {
    value
        .trim()
        .split(':')
        .try_fold(0_i32, |seconds, part| {
            let part: i32 = part.parse().ok()?;
            seconds.checked_mul(60)?.checked_add(part)
        })
        .unwrap_or_default()
        .max(0)
}

pub(in super::super) fn parse_results(site: Site, html: &str) -> AppResult<Vec<Hit>> {
    let regexes = site
        .pattern
        .iter()
        .map(|pattern| Regex::new(pattern))
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::internal)?;
    let field = |index: usize, block| clean(capture(&regexes[index], block).unwrap_or_default());
    Ok(html
        .split(site.split)
        .skip(1)
        .filter_map(|block| {
            let title = field(1, block);
            let artist = field(0, block);
            if title.is_empty() || artist.is_empty() {
                return None;
            }
            let href = html_escape::decode_html_entities(capture(&regexes[3], block)?);
            let href = if href.starts_with("//") { format!("https:{href}") } else { href.into_owned() };
            let url = hosts(&href, site.domains)?;
            let bitrate = (site.bitrate)(block);
            Some(
                Hit::new(
                    site.source,
                    &href,
                    Recording { title, artist, duration: clock(&field(2, block)), isrc: None },
                    Delivery::Http { url, hosts: site.domains },
                )
                .quality("mp3", bitrate),
            )
        })
        .take(super::MAX_RESULTS)
        .collect())
}
