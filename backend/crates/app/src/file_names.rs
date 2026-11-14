// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

//! Optional catalog-driven names. A committed journal precedes every filesystem change.
use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};

use anyhow::{Context, bail};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::storage::{self, Storage};

const SIDECARS: &[&str] = &["lrc", "txt", "srt", "jpg", "jpeg", "png"];

#[derive(Default)]
pub(super) struct Report {
    pub renamed: u64,
    pub problems: Vec<String>,
}

#[derive(sqlx::FromRow)]
struct Track {
    id: Uuid,
    file_path: String,
    content_hash: String,
    title: String,
    artist: String,
    file_name_verified: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Move {
    from: String,
    to: String,
    hash: String,
}

#[derive(sqlx::FromRow)]
struct Job {
    id: Uuid,
    track_id: Uuid,
    source_path: String,
    target_path: String,
    moves: sqlx::types::Json<Vec<Move>>,
}

// Scanning and renaming use the same OS lock, including across API processes.
pub(super) fn lock(storage: &Storage) -> anyhow::Result<Option<File>> {
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(storage.resolve(".file-names.lock")?)?;
    match file.try_lock() {
        Ok(()) => Ok(Some(file)),
        Err(std::fs::TryLockError::WouldBlock) => Ok(None),
        Err(std::fs::TryLockError::Error(error)) => Err(error.into()),
    }
}

fn clean(value: &str) -> String {
    value
        .chars()
        .map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches([' ', '.'])
        .to_owned()
}

fn stem(artist: &str, title: &str) -> Option<String> {
    let artist = clean(artist);
    let title = clean(title);
    if artist.is_empty() || title.is_empty() || artist.eq_ignore_ascii_case("Unknown Artist") {
        return None;
    }
    let mut name = format!("{artist} - {title}");
    // Leave room for a collision suffix, extension and companion-file suffixes.
    while name.len() > 180 {
        name.pop();
    }
    Some(name.trim_end_matches([' ', '.']).to_owned())
}

fn canonical(current: &str, desired: &str) -> bool {
    current == desired
        || current
            .strip_prefix(desired)
            .and_then(|s| s.strip_prefix(" ("))
            .and_then(|s| s.strip_suffix(')'))
            .and_then(|s| s.parse::<u32>().ok())
            .is_some_and(|n| n >= 2)
}

// The library root itself may be a symlink, but files and subdirectories may not escape it.
pub(super) fn checked(storage: &Storage, relative: &str) -> anyhow::Result<PathBuf> {
    let path = storage.resolve(relative)?;
    let kind = relative.split('/').next().unwrap_or_default();
    if !matches!(kind, "music" | "library") {
        bail!("Not an audio storage path");
    }
    let root = storage.resolve(kind)?.canonicalize()?;
    let parent = path.parent().context("Missing parent directory")?.canonicalize()?;
    if !parent.starts_with(root) {
        bail!("The file is outside its music root");
    }
    match fs::symlink_metadata(&path) {
        Ok(meta) if !meta.file_type().is_file() => bail!("Not a regular file"),
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error.into()),
        _ => {}
    }
    Ok(path)
}

// A same-stem companion has no way to identify which audio format owns it.
pub(super) fn ensure_unshared(storage: &Storage, source: &str) -> anyhow::Result<()> {
    let path = checked(storage, source)?;
    for entry in fs::read_dir(path.parent().context("Missing parent")?)? {
        let other = entry?.path();
        if other != path
            && other.file_stem() == path.file_stem()
            && other.file_name().and_then(|s| s.to_str()).and_then(media::formats::for_file_name).is_some()
        {
            bail!("Companion files are shared by multiple audio files");
        }
    }
    Ok(())
}

fn companions(storage: &Storage, source: &str) -> anyhow::Result<Vec<String>> {
    let path = checked(storage, source)?;
    let parent = path.parent().context("Missing parent")?;
    let old_stem = path.file_stem().and_then(|s| s.to_str()).context("Invalid audio name")?;
    let mut result = vec![source.to_owned()];
    for entry in fs::read_dir(parent)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(suffix) = name.strip_prefix(&format!("{old_stem}.")) else { continue };
        let ext = suffix.rsplit('.').next().unwrap_or_default().to_ascii_lowercase();
        if !SIDECARS.contains(&ext.as_str()) {
            continue;
        }
        ensure_unshared(storage, source)?;
        let relative =
            Path::new(source).with_file_name(name).to_str().context("Invalid companion name")?.replace('\\', "/");
        checked(storage, &relative)?;
        result.push(relative);
    }
    result.sort_by(|a, b| (a != source).cmp(&(b != source)).then(a.cmp(b)));
    Ok(result)
}

async fn plan(db: &PgPool, storage: &Storage, track: &Track, desired: &str) -> anyhow::Result<Option<Job>> {
    let source = Path::new(&track.file_path);
    let extension = source.extension().and_then(|s| s.to_str()).context("Missing audio extension")?;
    let old_stem = source.file_stem().and_then(|s| s.to_str()).context("Invalid file name")?;
    if canonical(old_stem, desired) {
        return Ok(None);
    }
    let sources = companions(storage, &track.file_path)?;
    for number in 1..=10_000 {
        let name = if number == 1 { desired.to_owned() } else { format!("{desired} ({number})") };
        let target = source.with_file_name(format!("{name}.{extension}"));
        let target = target.to_str().context("Invalid target")?.replace('\\', "/");
        let mut moves = Vec::new();
        let mut occupied = false;
        for from in &sources {
            let old_name = Path::new(from).file_name().and_then(|s| s.to_str()).context("Invalid source")?;
            let suffix = old_name.strip_prefix(old_stem).context("Invalid companion")?;
            let to = source.with_file_name(format!("{name}{suffix}"));
            let to = to.to_str().context("Invalid destination")?.replace('\\', "/");
            if fs::symlink_metadata(storage.resolve(&to)?).is_ok() {
                occupied = true;
                break;
            }
            checked(storage, &to)?;
            let path = checked(storage, from)?;
            let (_, hash) = tokio::task::spawn_blocking(move || storage::hash_file(&path)).await??;
            if from == &track.file_path && hash != track.content_hash {
                bail!("Audio changed since the last scan");
            }
            moves.push(Move { from: from.clone(), to, hash });
        }
        if occupied {
            continue;
        }
        let mut tx = db.begin().await?;
        // Reject catalog edits or replacements racing with preparation of the plan.
        let current: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tracks t JOIN artists a ON a.id=t.artist_id WHERE t.id=$1 AND t.file_path=$2 AND t.content_hash=$3 AND t.title=$4 AND a.name=$5)")
            .bind(track.id).bind(&track.file_path).bind(&track.content_hash).bind(&track.title).bind(&track.artist)
            .fetch_one(&mut *tx).await?;
        if !current {
            return Ok(None);
        }
        let occupied: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tracks WHERE file_path=$1) OR EXISTS(SELECT 1 FROM library_files WHERE path=$2)")
            .bind(&target).bind(target.strip_prefix("library/").unwrap_or(""))
            .fetch_one(&mut *tx).await?;
        if occupied {
            continue;
        }
        let id = Uuid::now_v7();
        sqlx::query("INSERT INTO file_renames(id,track_id,source_path,target_path,moves) VALUES($1,$2,$3,$4,$5)")
            .bind(id)
            .bind(track.id)
            .bind(&track.file_path)
            .bind(&target)
            .bind(sqlx::types::Json(&moves))
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        return Ok(Some(Job {
            id,
            track_id: track.id,
            source_path: track.file_path.clone(),
            target_path: target,
            moves: sqlx::types::Json(moves),
        }));
    }
    bail!("No free destination name");
}

fn reserve(storage: &Storage, moves: &[Move]) -> anyhow::Result<()> {
    // Reserve every destination without replacing anything, before unlinking a source.
    // Hard links keep bytes, mtimes and inode identity; no audio is rewritten.
    for item in moves {
        let from = checked(storage, &item.from)?;
        let to = checked(storage, &item.to)?;
        if !from.exists() {
            if storage::hash_file(&to)?.1 != item.hash {
                bail!("Destination content changed");
            }
            continue;
        }
        if storage::hash_file(&from)?.1 != item.hash {
            bail!("Source content changed");
        }
        if to.exists() {
            if !same_file::is_same_file(&from, &to)? {
                bail!("Destination already exists");
            }
        } else {
            fs::hard_link(&from, &to)
                .context("Cannot reserve destination (write permission and hard-link support required)")?;
        }
    }
    Ok(())
}

fn remove_sources(storage: &Storage, moves: &[Move]) -> anyhow::Result<()> {
    for item in moves {
        let from = checked(storage, &item.from)?;
        let to = checked(storage, &item.to)?;
        if from.exists() {
            if !same_file::is_same_file(&from, &to)? {
                bail!("Source changed during renaming");
            }
            fs::remove_file(from)?;
        }
    }
    Ok(())
}

fn undo_reservations(storage: &Storage, moves: &[Move]) -> anyhow::Result<bool> {
    // On an early failure leave every original intact. Never remove somebody else's file.
    for item in moves {
        let from = checked(storage, &item.from)?;
        if !from.exists() || storage::hash_file(&from)?.1 != item.hash {
            return Ok(false);
        }
    }
    for item in moves {
        let from = checked(storage, &item.from)?;
        let to = checked(storage, &item.to)?;
        if to.exists() && same_file::is_same_file(from, &to)? {
            fs::remove_file(to)?;
        }
    }
    Ok(true)
}

async fn finish(db: &PgPool, storage: &Storage, job: Job) -> anyhow::Result<()> {
    let mut tx = db.begin().await?;
    let current: Option<(String, String)> =
        sqlx::query_as("SELECT file_path,content_hash FROM tracks WHERE id=$1 FOR UPDATE")
            .bind(job.track_id)
            .fetch_optional(&mut *tx)
            .await?;
    let expected = &job.moves.first().context("Empty rename plan")?.hash;
    anyhow::ensure!(
        current
            .as_ref()
            .is_some_and(|(path, hash)| (path == &job.source_path || path == &job.target_path) && hash == expected),
        "Track content/path changed since this rename was planned; journal retained"
    );
    let fs_storage = storage.clone();
    let moves = job.moves.0.clone();
    let outcome = tokio::task::spawn_blocking(move || reserve(&fs_storage, &moves)).await?;
    if let Err(error) = outcome {
        tx.rollback().await?;
        let fs_storage = storage.clone();
        let moves = job.moves.0.clone();
        let still_at_source: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tracks WHERE id=$1 AND file_path=$2)")
                .bind(job.track_id)
                .bind(&job.source_path)
                .fetch_one(db)
                .await?;
        if still_at_source && tokio::task::spawn_blocking(move || undo_reservations(&fs_storage, &moves)).await?? {
            sqlx::query("DELETE FROM file_renames WHERE id=$1").bind(job.id).execute(db).await?;
        }
        return Err(error);
    }
    let updated = sqlx::query(
        "UPDATE tracks SET file_path=$3,original_file_name=$4 WHERE id=$1 AND (file_path=$2 OR file_path=$3)",
    )
    .bind(job.track_id)
    .bind(&job.source_path)
    .bind(&job.target_path)
    .bind(Path::new(&job.target_path).file_name().and_then(|s| s.to_str()).context("Invalid target")?)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() != 1 {
        bail!("Track path changed while renaming; journal retained");
    }
    if let (Some(from), Some(to)) = (job.source_path.strip_prefix("library/"), job.target_path.strip_prefix("library/"))
    {
        sqlx::query("UPDATE library_files SET path=$2,missing_since=NULL WHERE path=$1 AND track_id=$3")
            .bind(from)
            .bind(to)
            .bind(job.track_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    // Both paths exist until the catalog commit: in-flight playback never loses its source.
    let fs_storage = storage.clone();
    let moves = job.moves.0;
    tokio::task::spawn_blocking(move || remove_sources(&fs_storage, &moves)).await??;
    sqlx::query("UPDATE file_renames SET completed_at=now() WHERE id=$1").bind(job.id).execute(db).await?;
    tracing::info!("Renamed {} to {} (track {})", job.source_path, job.target_path, job.track_id);
    Ok(())
}

// Caller holds the shared scan/rename lock. Recovery must precede walking the folder.
pub(super) async fn recover(db: &PgPool, storage: &Storage) -> anyhow::Result<Report> {
    let jobs: Vec<Job> = sqlx::query_as("SELECT id,track_id,source_path,target_path,moves FROM file_renames WHERE completed_at IS NULL ORDER BY created_at")
        .fetch_all(db).await?;
    let mut report = Report::default();
    for job in jobs {
        let path = job.source_path.clone();
        match finish(db, storage, job).await {
            Ok(()) => report.renamed += 1,
            Err(error) => {
                tracing::warn!("Renaming {path} failed: {error:#}");
                report.problems.push(path);
            }
        }
    }
    Ok(report)
}

pub(super) async fn run(db: &PgPool, storage: &Storage, cancel: &CancellationToken) -> anyhow::Result<Report> {
    let Some(_lock) = lock(storage)? else {
        return Ok(Report::default());
    };
    anyhow::ensure!(
        crate::metadata_export::recover(db, storage).await?.problems.is_empty(),
        "Pending metadata exports must be recovered before renaming"
    );
    let mut report = recover(db, storage).await?;
    let tracks: Vec<Track> = sqlx::query_as("SELECT t.id,t.file_path,t.content_hash,t.title,a.name AS artist,t.file_name_verified FROM tracks t JOIN artists a ON a.id=t.artist_id WHERE NOT EXISTS(SELECT 1 FROM file_renames r WHERE r.track_id=t.id AND r.completed_at IS NULL) ORDER BY t.created_at,t.id")
        .fetch_all(db).await?;
    for track in tracks {
        if cancel.is_cancelled() {
            break;
        }
        let Some(desired) = stem(&track.artist, &track.title) else {
            continue;
        };
        let verified = match track.file_name_verified {
            Some(value) => value,
            None => {
                let path = match checked(storage, &track.file_path) {
                    Ok(path) if path.is_file() => path,
                    Ok(_) => continue,
                    Err(error) => {
                        tracing::warn!("Cannot verify {}: {error:#}", track.file_path);
                        report.problems.push(track.file_path);
                        continue;
                    }
                };
                let verified = tokio::task::spawn_blocking(move || {
                    media::tags::read(&path).is_some_and(|tags| {
                        tags.title.is_some_and(|s| !s.trim().is_empty())
                            && tags.artists.iter().chain(&tags.album_artists).any(|s| !s.trim().is_empty())
                    })
                })
                .await?;
                sqlx::query("UPDATE tracks SET file_name_verified=$2 WHERE id=$1 AND file_name_verified IS NULL")
                    .bind(track.id)
                    .bind(verified)
                    .execute(db)
                    .await?;
                verified
            }
        };
        if !verified {
            continue;
        }
        let result = async {
            if let Some(job) = plan(db, storage, &track, &desired).await? {
                finish(db, storage, job).await?;
                return Ok::<_, anyhow::Error>(true);
            }
            Ok(false)
        }
        .await;
        match result {
            Ok(true) => report.renamed += 1,
            Ok(false) => {}
            Err(error) => {
                tracing::warn!("Renaming {} failed: {error:#}", track.file_path);
                report.problems.push(track.file_path);
            }
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests;
