// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use chrono::Utc;
use regex::Regex;
use sqlx::PgConnection;
use uuid::Uuid;

use crate::AppResult;
use crate::text::normalize_key;

pub const MAX_CREDITS: usize = 12;
const UNKNOWN_ARTIST: &str = "Unknown Artist";
const UNKNOWN_ALBUM: &str = "Unknown Album";

static SEPARATOR: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\s*[;/]\s*|\s*,\s*|[\s(\[]+(?:featuring|feat|ft|versus|vs)\.?\s+|\s+[x×]\s+")
        .unwrap_or_else(|error| unreachable!("the artist separator pattern is valid: {error}"))
});

pub fn split_artist_names(raw: &str) -> Vec<String> {
    let Some(value) = clean_name(raw) else {
        return Vec::new();
    };

    let mut names = Vec::new();
    let mut seen = HashSet::new();
    for part in SEPARATOR.split(&value) {
        let Some(name) = clean_name(part) else { continue };
        if !seen.insert(normalize_key(&name)) {
            continue;
        }
        names.push(name);
        if names.len() == MAX_CREDITS {
            break;
        }
    }

    if names.is_empty() { vec![value] } else { names }
}

fn clean_name(value: &str) -> Option<String> {
    let cleaned = value.replace('\0', "");
    let cleaned = cleaned.trim_matches([' ', '\t', '(', ')', '[', ']', '-', '_']);
    (!cleaned.trim().is_empty()).then(|| cleaned.to_owned())
}

#[derive(Default)]
pub struct TagResolver {
    artists: HashMap<String, Uuid>,
    known_names: HashMap<String, bool>,
    created: Vec<Uuid>,
}

impl TagResolver {
    pub fn created(&self) -> &[Uuid] {
        &self.created
    }

    pub async fn resolve_artists(&mut self, conn: &mut PgConnection, raw_values: &[&str]) -> AppResult<Vec<Uuid>> {
        let mut resolved = Vec::new();
        let mut seen = HashSet::new();

        for raw in raw_values {
            if raw.trim().is_empty() {
                continue;
            }
            let whole = raw.trim();
            let key = normalize_key(whole);

            let known = if self.artists.contains_key(&key) {
                true
            } else if let Some(&known) = self.known_names.get(&key) {
                known
            } else {
                let exists = sqlx::query_scalar!(
                    r#"SELECT EXISTS (SELECT 1 FROM artists WHERE normalized_name = $1) AS "exists!""#,
                    key
                )
                .fetch_one(&mut *conn)
                .await?;
                self.known_names.insert(key, exists);
                exists
            };

            let names = if known { vec![whole.to_owned()] } else { split_artist_names(whole) };
            for name in names {
                if !seen.insert(normalize_key(&name)) {
                    continue;
                }
                resolved.push(self.artist(conn, &name).await?);
                if resolved.len() == MAX_CREDITS {
                    return Ok(resolved);
                }
            }
        }

        if resolved.is_empty() {
            resolved.push(self.artist(conn, UNKNOWN_ARTIST).await?);
        }
        Ok(resolved)
    }

    async fn artist(&mut self, conn: &mut PgConnection, name: &str) -> AppResult<Uuid> {
        let trimmed = if name.trim().is_empty() { UNKNOWN_ARTIST } else { name.trim() };
        let key = normalize_key(trimmed);
        if let Some(&id) = self.artists.get(&key) {
            return Ok(id);
        }

        let inserted = sqlx::query_scalar!(
            "INSERT INTO artists (id, name, normalized_name, created_at) VALUES ($1, $2, $3, $4)
             ON CONFLICT (normalized_name) DO NOTHING RETURNING id",
            Uuid::now_v7(),
            trimmed,
            key,
            Utc::now()
        )
        .fetch_optional(&mut *conn)
        .await?;
        let id = match inserted {
            Some(id) => {
                self.created.push(id);
                id
            }
            None => {
                sqlx::query_scalar!("SELECT id FROM artists WHERE normalized_name = $1", key)
                    .fetch_one(&mut *conn)
                    .await?
            }
        };

        self.artists.insert(key, id);
        Ok(id)
    }
}

pub async fn album(conn: &mut PgConnection, title: &str, artist_id: Uuid, year: Option<i32>) -> AppResult<Uuid> {
    let trimmed = if title.trim().is_empty() { UNKNOWN_ALBUM } else { title.trim() };
    let key = normalize_key(trimmed);

    sqlx::query!(
        "INSERT INTO albums (id, title, normalized_title, artist_id, year, created_at) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (artist_id, normalized_title) DO UPDATE SET year = COALESCE(albums.year, EXCLUDED.year)",
        Uuid::now_v7(),
        trimmed,
        key,
        artist_id,
        year,
        Utc::now()
    )
    .execute(&mut *conn)
    .await?;

    Ok(sqlx::query_scalar!("SELECT id FROM albums WHERE artist_id = $1 AND normalized_title = $2", artist_id, key)
        .fetch_one(&mut *conn)
        .await?)
}

pub async fn genre(conn: &mut PgConnection, name: &str) -> AppResult<Uuid> {
    let trimmed = name.trim();
    let key = normalize_key(trimmed);

    sqlx::query!(
        "INSERT INTO genres (id, name, normalized_name, created_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (normalized_name) DO NOTHING",
        Uuid::now_v7(),
        trimmed,
        key,
        Utc::now()
    )
    .execute(&mut *conn)
    .await?;

    Ok(sqlx::query_scalar!("SELECT id FROM genres WHERE normalized_name = $1", key).fetch_one(&mut *conn).await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_on_separators_and_featuring() {
        assert_eq!(
            split_artist_names("TERELYA, Mika Vino feat. Kid; Other / Last x Final"),
            ["TERELYA", "Mika Vino", "Kid", "Other", "Last", "Final"]
        );
    }

    #[test]
    fn keeps_a_single_name_and_drops_repeats() {
        assert_eq!(split_artist_names(" (Aurora Lane) , aurora lane "), ["Aurora Lane"]);
    }

    #[test]
    fn x_inside_a_word_is_not_a_separator() {
        assert_eq!(split_artist_names("Xzibit"), ["Xzibit"]);
    }
}
