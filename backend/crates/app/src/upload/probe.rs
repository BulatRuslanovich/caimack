// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::{HashMap, HashSet};

use media::formats;
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use sqlx::PgPool;
use uuid::Uuid;

use crate::AppResult;
use crate::catalog::dto::TrackDto;
use crate::catalog::tags::split_artist_names;
use crate::catalog::tracks;
use crate::text::normalize_key;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeFile {
    pub file_name: String,
    pub content_hash: Option<String>,
    pub title: Option<String>,
    pub artist: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub enum ProbeVerdict {
    New,
    Duplicate,
    Upgrade,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub enum ProbeBasis {
    None,
    Tags,
    Hash,
    HashAndTags,
}

#[skip_serializing_none]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeMatch {
    pub file_name: String,
    pub verdict: ProbeVerdict,
    pub basis: ProbeBasis,
    #[serde(rename = "match")]
    pub matched: Option<TrackDto>,
}

#[derive(Debug, Serialize)]
pub struct ProbeResult {
    pub files: Vec<ProbeMatch>,
}

pub async fn probe(db: &PgPool, user: Uuid, files: Vec<ProbeFile>) -> AppResult<ProbeResult> {
    if files.is_empty() {
        return Ok(ProbeResult { files: vec![] });
    }

    let mut hashes: HashMap<usize, String> = HashMap::new();
    let mut candidates: HashMap<usize, (String, HashSet<String>)> = HashMap::new();
    for (index, file) in files.iter().enumerate() {
        if let Some(hash) = file.content_hash.as_deref().map(str::to_ascii_lowercase)
            && hash.len() == 64
            && hash.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
        {
            hashes.insert(index, hash);
        }
        let title = file.title.as_deref().map(str::trim).filter(|t| !t.is_empty());
        let artist = file.artist.as_deref().map(str::trim).filter(|a| !a.is_empty());
        if let (Some(title), Some(artist)) = (title, artist) {
            let keys: HashSet<String> = split_artist_names(artist).iter().map(|name| normalize_key(name)).collect();
            if !keys.is_empty() {
                candidates.insert(index, (normalize_key(title), keys));
            }
        }
    }

    let distinct: Vec<String> = hashes.values().cloned().collect::<HashSet<_>>().into_iter().collect();
    let known: HashMap<String, Uuid> = if distinct.is_empty() {
        HashMap::new()
    } else {
        sqlx::query!("SELECT content_hash, id FROM tracks WHERE content_hash = ANY($1)", &distinct)
            .fetch_all(db)
            .await?
            .into_iter()
            .map(|row| (row.content_hash, row.id))
            .collect()
    };
    let by_hash: HashMap<usize, Uuid> =
        hashes.iter().filter_map(|(index, hash)| known.get(hash).map(|id| (*index, *id))).collect();

    let unmatched: HashMap<usize, (String, HashSet<String>)> =
        candidates.iter().filter(|(index, _)| !by_hash.contains_key(index)).map(|(i, c)| (*i, c.clone())).collect();
    let by_tags = match_by_tags(db, &unmatched).await?;

    let ids: Vec<Uuid> = by_hash.values().copied().chain(by_tags.values().map(|(id, _)| *id)).collect();
    let matched = tracks::by_ids(db, user, &ids).await?;

    let results = files
        .into_iter()
        .enumerate()
        .map(|(index, file)| {
            let (verdict, track) = if let Some(id) = by_hash.get(&index) {
                (ProbeVerdict::Duplicate, Some(*id))
            } else if let Some((id, lossless)) = by_tags.get(&index) {
                let upgrade = !lossless && formats::for_file_name(&file.file_name) == Some(formats::FLAC);
                (if upgrade { ProbeVerdict::Upgrade } else { ProbeVerdict::Duplicate }, Some(*id))
            } else {
                (ProbeVerdict::New, None)
            };
            let basis = match (hashes.contains_key(&index), candidates.contains_key(&index)) {
                (true, true) => ProbeBasis::HashAndTags,
                (true, false) => ProbeBasis::Hash,
                (false, true) => ProbeBasis::Tags,
                (false, false) => ProbeBasis::None,
            };
            let matched = track.and_then(|id| matched.get(&id).cloned());
            ProbeMatch { file_name: file.file_name, verdict, basis, matched }
        })
        .collect();
    Ok(ProbeResult { files: results })
}

async fn match_by_tags(
    db: &PgPool,
    candidates: &HashMap<usize, (String, HashSet<String>)>,
) -> AppResult<HashMap<usize, (Uuid, bool)>> {
    if candidates.is_empty() {
        return Ok(HashMap::new());
    }
    let titles: Vec<String> = candidates.values().map(|(title, _)| title.clone()).collect();
    let rows = sqlx::query!(
        r#"SELECT t.id, t.normalized_title, t.codec,
                  ARRAY(SELECT a.normalized_name FROM track_artists ta JOIN artists a ON a.id = ta.artist_id
                        WHERE ta.track_id = t.id) AS "artist_keys!"
           FROM tracks t WHERE t.normalized_title = ANY($1)"#,
        &titles
    )
    .fetch_all(db)
    .await?;

    let mut matches = HashMap::new();
    for (index, (title, keys)) in candidates {
        let same: Vec<_> = rows
            .iter()
            .filter(|row| &row.normalized_title == title && row.artist_keys.iter().any(|k| keys.contains(k)))
            .collect();
        let best = same.iter().find(|row| formats::is_lossless(row.codec.as_deref())).or_else(|| same.first());
        if let Some(best) = best {
            matches.insert(*index, (best.id, formats::is_lossless(best.codec.as_deref())));
        }
    }
    Ok(matches)
}
