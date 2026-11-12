// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

mod matching;
mod providers;

use super::lrclib::{Lrclib, LyricsLookup, LyricsQuery};
use crate::catalog::lyrics::ParsedLyrics;
use futures_util::stream::{FuturesUnordered, StreamExt};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::Instant;

const LOOKUP_BUDGET: Duration = Duration::from_secs(12);
const BODY_LIMIT: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct Candidate {
    pub parsed: ParsedLyrics,
    pub provider: &'static str,
    pub format: String,
    pub original: String,
    pub attribution: Value,
    pub exact: bool,
    pub duration_difference: i32,
}

impl Candidate {
    pub fn rank(&self) -> (bool, i16, std::cmp::Reverse<i32>) {
        (self.exact, self.parsed.quality(), std::cmp::Reverse(self.duration_difference))
    }
}

#[derive(Clone)]
pub struct LyricsProviders {
    lrclib: Lrclib,
    http: reqwest::Client,
    cooldowns: Arc<Mutex<HashMap<String, Instant>>>,
    better_key: Option<String>,
    endpoints: Arc<providers::Endpoints>,
}

pub struct LookupResult {
    pub best: Option<Candidate>,
    pub instrumental: bool,
}

impl LyricsProviders {
    pub fn new(lrclib: Lrclib, better_key: Option<String>) -> Self {
        Self {
            lrclib,
            http: super::http_client(Duration::from_secs(5)),
            cooldowns: Arc::default(),
            better_key,
            endpoints: Arc::new(providers::Endpoints::default()),
        }
    }

    /// Every source gets the same deadline. Dropping pending futures cancels their requests.
    pub async fn lookup(&self, query: &LyricsQuery) -> anyhow::Result<LookupResult> {
        let mut pending = FuturesUnordered::new();
        for provider in providers::Provider::ALL {
            pending.push(async move {
                let result = tokio::time::timeout(LOOKUP_BUDGET, self.fetch(provider, query)).await;
                (provider, result)
            });
        }
        let mut candidates = Vec::new();
        let mut failed = false;
        let mut instrumental = false;
        while let Some((provider, result)) = pending.next().await {
            match result {
                Ok(Ok(found)) => {
                    instrumental |= found.instrumental;
                    candidates.extend(found.best);
                }
                Ok(Err(error)) => {
                    failed = true;
                    tracing::debug!(?provider, "Lyrics source failed: {error:#}");
                }
                Err(_) => {
                    failed = true;
                    tracing::debug!(?provider, "Lyrics source deadline exceeded");
                }
            }
        }
        let best = choose_best(candidates);
        if best.is_none() && !instrumental && failed {
            anyhow::bail!("Lyrics sources unavailable; retry later");
        }
        Ok(LookupResult { best, instrumental })
    }

    async fn lrclib(&self, query: &LyricsQuery) -> anyhow::Result<LookupResult> {
        let (result, duration) = self.lrclib.lookup_with_duration(query).await?;
        let instrumental = matches!(result, LyricsLookup::Instrumental);
        let best = match result {
            LyricsLookup::Found(original) => {
                let format = if crate::catalog::lyrics::pattern(r"\[\d{1,3}:\d{2}").is_match(&original) {
                    "lrc"
                } else {
                    "plain"
                };
                matching::candidate(
                    query,
                    &query.title,
                    &query.artist,
                    duration.unwrap_or(0.0),
                    &original,
                    format,
                    "LRCLIB",
                )
            }
            _ => None,
        };
        Ok(LookupResult { best, instrumental })
    }
}

fn text_size(candidate: &Candidate) -> usize {
    candidate.parsed.plain.chars().filter(|c| c.is_alphanumeric()).count()
}

fn choose_best(candidates: Vec<Candidate>) -> Option<Candidate> {
    let exact = candidates.iter().any(|c| c.exact);
    let longest = candidates.iter().filter(|c| !exact || c.exact).map(text_size).max().unwrap_or(0);
    candidates
        .into_iter()
        .filter(|c| (!exact || c.exact) && text_size(c) * 10 >= longest * 7)
        .max_by_key(Candidate::rank)
}

#[cfg(test)]
mod tests;
