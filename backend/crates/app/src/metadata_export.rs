// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

//! Export portable artwork and lyric companions without invalidating audio analysis.
use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use anyhow::{Context, bail};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::catalog::lyrics::LyricLine;
use crate::storage::{self, CoverSize, Storage};

#[derive(Default)]
pub(super) struct Report {
    pub exported: u64,
    pub problems: Vec<String>,
}

#[derive(sqlx::FromRow)]
struct Track {
    id: Uuid,
    file_path: String,
    content_hash: String,
    title: String,
    artist: String,
    cover_path: Option<String>,
    plain: String,
    synced: sqlx::types::Json<Vec<LyricLine>>,
    exported_hash: Option<String>,
    cover_stamp: Option<String>,
    lyrics_hash: Option<String>,
    lyrics_extension: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Change {
    target: String,
    staged: Option<String>,
    backup: Option<String>,
    old_hash: Option<String>,
    new_hash: Option<String>,
}

#[derive(sqlx::FromRow)]
struct Job {
    id: Uuid,
    track_id: Uuid,
    source_path: String,
    old_hash: String,
    new_hash: String,
    files: sqlx::types::Json<Vec<Change>>,
    cover_stamp: Option<String>,
    lyrics_hash: Option<String>,
    lyrics_extension: Option<String>,
}

struct Prepared {
    backup_dir: PathBuf,
    stages: Vec<PathBuf>,
    journaled: bool,
}

impl Drop for Prepared {
    fn drop(&mut self) {
        if !self.journaled {
            for path in &self.stages {
                let _ = fs::remove_file(path);
            }
            let _ = fs::remove_dir_all(&self.backup_dir);
        }
    }
}

fn digest(bytes: &[u8]) -> String {
    crate::text::hex_lower(&Sha256::digest(bytes))
}

fn header(value: &str) -> String {
    value.replace(['\r', '\n', ']'], " ")
}

fn lyrics(track: &Track) -> Option<(&'static str, Vec<u8>)> {
    if !track.synced.is_empty() {
        let mut text = format!("[ar:{}]\r\n[ti:{}]\r\n", header(&track.artist), header(&track.title));
        let mut lines: Vec<_> = track.synced.iter().filter(|line| line.at >= 0).collect();
        lines.sort_by_key(|line| line.at);
        for line in lines {
            let cs = (i64::from(line.at) + 5) / 10;
            text.push_str(&format!(
                "[{:02}:{:02}.{:02}]{}\r\n",
                cs / 6000,
                cs / 100 % 60,
                cs % 100,
                line.text.replace(['\r', '\n'], " ")
            ));
        }
        Some(("lrc", text.into_bytes()))
    } else if !track.plain.trim().is_empty() {
        let text = track.plain.replace("\r\n", "\n").replace('\r', "\n");
        Some(("txt", (text.trim_end().replace('\n', "\r\n") + "\r\n").into_bytes()))
    } else {
        None
    }
}

fn sidecar(source: &str, ext: &str) -> anyhow::Result<String> {
    Ok(Path::new(source).with_extension(ext).to_str().context("Invalid lyric path")?.replace('\\', "/"))
}

fn cover(storage: &Storage, base: Option<&str>) -> anyhow::Result<Option<(PathBuf, String)>> {
    let Some(base) = base else {
        return Ok(None);
    };
    for size in [CoverSize::Large, CoverSize::Full, CoverSize::Thumb] {
        let relative = Storage::cover_variant(base, size);
        if let Some(path) = storage.existing(&relative) {
            let meta = fs::metadata(&path)?;
            let stamp = meta.modified()?.duration_since(UNIX_EPOCH)?.as_nanos();
            return Ok(Some((path, format!("{relative}:{stamp}:{}", meta.len()))));
        }
    }
    bail!("The catalog artwork file is missing");
}

fn stage_path(target: &str, id: Uuid, index: usize) -> anyhow::Result<String> {
    let extension = Path::new(target).extension().and_then(|s| s.to_str()).unwrap_or("tmp");
    Ok(Path::new(target)
        .with_file_name(format!(".caimack-export-{id}-{index}.{extension}"))
        .to_str()
        .context("Invalid staged path")?
        .replace('\\', "/"))
}

fn copy_new(from: &Path, to: &Path) -> anyhow::Result<()> {
    let mut source = File::open(from)?;
    let mut destination = OpenOptions::new().write(true).create_new(true).open(to)?;
    let copied = std::io::copy(&mut source, &mut destination).and_then(|_| destination.sync_all());
    if copied.is_err() {
        drop(destination);
        let _ = fs::remove_file(to);
    }
    Ok(copied?)
}

// The scanner detects audio changes separately. Avoid reading whole audio files
// every maintenance pass when catalog artwork and companion text are unchanged.
fn current(storage: &Storage, track: &Track) -> anyhow::Result<bool> {
    if track.exported_hash.as_ref() != Some(&track.content_hash) {
        return Ok(false);
    }
    let stamp = cover(storage, track.cover_path.as_deref())?.map(|(_, stamp)| stamp);
    let text = lyrics(track);
    let extension = text.as_ref().map(|(ext, _)| *ext);
    let hash = text.as_ref().map(|(_, bytes)| digest(bytes));
    if stamp != track.cover_stamp || extension != track.lyrics_extension.as_deref() || hash != track.lyrics_hash {
        return Ok(false);
    }
    if let Some((ext, _)) = text {
        return Ok(hash_if_exists(storage, &sidecar(&track.file_path, ext)?)? == hash);
    }
    Ok(true)
}

fn hash_if_exists(storage: &Storage, relative: &str) -> anyhow::Result<Option<String>> {
    let path = crate::file_names::checked(storage, relative)?;
    if path.exists() { Ok(Some(storage::hash_file(&path)?.1)) } else { Ok(None) }
}

fn backup(storage: &Storage, target: &str, id: Uuid, index: usize) -> anyhow::Result<String> {
    let relative = format!(".metadata-backups/{id}/{index}");
    let destination = storage.resolve(&relative)?;
    fs::create_dir_all(destination.parent().context("Missing backup directory")?)?;
    copy_new(&crate::file_names::checked(storage, target)?, &destination)?;
    Ok(relative)
}

fn prepare(storage: &Storage, track: &Track, id: Uuid) -> anyhow::Result<(Job, Prepared)> {
    if lyrics(track).is_some() || track.lyrics_extension.is_some() {
        crate::file_names::ensure_unshared(storage, &track.file_path)?;
    }
    let audio = crate::file_names::checked(storage, &track.file_path)?;
    let actual = storage::hash_file(&audio)?.1;
    if actual != track.content_hash {
        bail!("Audio file changed since the last scan");
    }
    let mut guard =
        Prepared { backup_dir: storage.resolve(&format!(".metadata-backups/{id}"))?, stages: vec![], journaled: false };
    let artwork = cover(storage, track.cover_path.as_deref())?;
    let stamp = artwork.as_ref().map(|(_, stamp)| stamp.clone());
    let mut files = Vec::new();
    let mut new_hash = actual.clone();
    if artwork.is_some() && (track.cover_stamp != stamp || track.exported_hash.as_ref() != Some(&actual)) {
        let (image, _) = artwork.as_ref().context("Missing artwork")?;
        let jpeg = media::images::cover_jpeg(&fs::read(image)?)?;
        let staged = stage_path(&track.file_path, id, files.len())?;
        let staged_path = crate::file_names::checked(storage, &staged)?;
        copy_new(&audio, &staged_path)?;
        guard.stages.push(staged_path.clone());
        if media::tags::write_front_cover(&staged_path, &jpeg)? {
            new_hash = storage::hash_file(&staged_path)?.1;
            let saved = backup(storage, &track.file_path, id, files.len())?;
            fs::set_permissions(&staged_path, fs::metadata(&audio)?.permissions())?;
            File::open(&staged_path)?.sync_all()?;
            files.push(Change {
                target: track.file_path.clone(),
                staged: Some(staged),
                backup: Some(saved),
                old_hash: Some(actual.clone()),
                new_hash: Some(new_hash.clone()),
            });
        } else {
            fs::remove_file(staged_path)?;
        }
    }
    let text = lyrics(track);
    let lyrics_extension = text.as_ref().map(|(ext, _)| (*ext).to_owned());
    let lyrics_hash = text.as_ref().map(|(_, bytes)| digest(bytes));
    if let Some((ext, bytes)) = text {
        let target = sidecar(&track.file_path, ext)?;
        let old_hash = hash_if_exists(storage, &target)?;
        let new_text_hash = digest(&bytes);
        if old_hash.as_ref() != Some(&new_text_hash) {
            let staged = stage_path(&target, id, files.len())?;
            let path = crate::file_names::checked(storage, &staged)?;
            let mut file = OpenOptions::new().create_new(true).write(true).open(&path)?;
            guard.stages.push(path);
            std::io::Write::write_all(&mut file, &bytes)?;
            file.sync_all()?;
            let saved = if old_hash.is_some() { Some(backup(storage, &target, id, files.len())?) } else { None };
            files.push(Change { target, staged: Some(staged), backup: saved, old_hash, new_hash: Some(new_text_hash) });
        }
    }
    // Remove only an obsolete companion that we exported and that has not been edited.
    if let Some(ext) = track.lyrics_extension.as_deref().filter(|ext| Some(*ext) != lyrics_extension.as_deref())
        && matches!(ext, "lrc" | "txt")
    {
        let target = sidecar(&track.file_path, ext)?;
        let old_hash = hash_if_exists(storage, &target)?;
        if old_hash.is_some() && old_hash == track.lyrics_hash {
            let saved = backup(storage, &target, id, files.len())?;
            files.push(Change { target, staged: None, backup: Some(saved), old_hash, new_hash: None });
        }
    }
    Ok((
        Job {
            id,
            track_id: track.id,
            source_path: track.file_path.clone(),
            old_hash: actual,
            new_hash,
            files: sqlx::types::Json(files),
            cover_stamp: stamp,
            lyrics_hash,
            lyrics_extension,
        },
        guard,
    ))
}

fn install(storage: &Storage, files: &[Change]) -> anyhow::Result<()> {
    for change in files {
        let current = hash_if_exists(storage, &change.target)?;
        if current == change.new_hash {
            continue;
        }
        if current != change.old_hash {
            bail!("{} was modified after the export was prepared", change.target);
        }
        if let Some(old_hash) = &change.old_hash {
            let saved = storage.resolve(change.backup.as_deref().context("Missing original backup")?)?;
            if storage::hash_file(&saved)?.1 != *old_hash {
                bail!("Export backup does not match its journal");
            }
        }
        let target = crate::file_names::checked(storage, &change.target)?;
        if let Some(staged) = &change.staged {
            let staged = crate::file_names::checked(storage, staged)?;
            if Some(storage::hash_file(&staged)?.1) != change.new_hash {
                bail!("Staged export data is damaged");
            }
            fs::rename(staged, target)?;
        } else if target.exists() {
            fs::remove_file(target)?;
        }
    }
    Ok(())
}

async fn save_state(db: &mut sqlx::PgConnection, job: &Job) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO file_metadata_state(track_id,source_hash,cover_stamp,lyrics_hash,lyrics_extension) VALUES($1,$2,$3,$4,$5) ON CONFLICT(track_id) DO UPDATE SET source_hash=EXCLUDED.source_hash,cover_stamp=EXCLUDED.cover_stamp,lyrics_hash=EXCLUDED.lyrics_hash,lyrics_extension=EXCLUDED.lyrics_extension")
        .bind(job.track_id).bind(&job.new_hash).bind(&job.cover_stamp).bind(&job.lyrics_hash).bind(&job.lyrics_extension)
        .execute(db).await?;
    Ok(())
}

async fn finish(db: &PgPool, storage: &Storage, job: &Job) -> anyhow::Result<()> {
    let mut tx = db.begin().await?;
    let current: Option<(String, String)> =
        sqlx::query_as("SELECT file_path,content_hash FROM tracks WHERE id=$1 FOR UPDATE")
            .bind(job.track_id)
            .fetch_optional(&mut *tx)
            .await?;
    anyhow::ensure!(
        current
            .as_ref()
            .is_some_and(|(path, hash)| path == &job.source_path && (hash == &job.old_hash || hash == &job.new_hash)),
        "Track changed after metadata export was planned"
    );
    let fs_storage = storage.clone();
    let files = job.files.0.clone();
    tokio::task::spawn_blocking(move || install(&fs_storage, &files)).await??;
    let audio = crate::file_names::checked(storage, &job.source_path)?;
    let meta = fs::metadata(&audio)?;
    anyhow::ensure!(storage::hash_file(&audio)?.1 == job.new_hash, "Exported file hash differs from its journal");
    if job.old_hash != job.new_hash {
        sqlx::query(
            "UPDATE tracks SET media_cache_hash=COALESCE(media_cache_hash,$2),content_hash=$3,file_size=$4 WHERE id=$1",
        )
        .bind(job.track_id)
        .bind(&job.old_hash)
        .bind(&job.new_hash)
        .bind(i64::try_from(meta.len())?)
        .execute(&mut *tx)
        .await?;
        for query in [
            "UPDATE track_embeddings SET source_hash=$3 WHERE track_id=$1 AND source_hash=$2",
            "UPDATE track_cues SET source_hash=$3 WHERE track_id=$1 AND source_hash=$2",
            "UPDATE sync_audio_payloads SET source_hash=$3 WHERE track_id=$1 AND source_hash=$2 AND audio_hash NOT LIKE 'opaque:%'",
        ] {
            sqlx::query(query).bind(job.track_id).bind(&job.old_hash).bind(&job.new_hash).execute(&mut *tx).await?;
        }
    }
    let modified = chrono::DateTime::<chrono::Utc>::from(meta.modified()?);
    sqlx::query("UPDATE library_files SET size_bytes=$2,modified_at=$3,content_hash=$4 WHERE track_id=$1 AND status=1")
        .bind(job.track_id)
        .bind(i64::try_from(meta.len())?)
        .bind(modified)
        .bind(&job.new_hash)
        .execute(&mut *tx)
        .await?;
    save_state(&mut tx, job).await?;
    sqlx::query("UPDATE file_metadata_exports SET completed_at=now() WHERE id=$1")
        .bind(job.id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    tracing::info!("Exported artwork/lyrics beside {} (track {})", job.source_path, job.track_id);
    Ok(())
}

// Caller holds the scan/rename lock. Complete before hashing or renaming any source.
pub(super) async fn recover(db: &PgPool, storage: &Storage) -> anyhow::Result<Report> {
    let jobs: Vec<Job> = sqlx::query_as("SELECT id,track_id,source_path,old_hash,new_hash,files,cover_stamp,lyrics_hash,lyrics_extension FROM file_metadata_exports WHERE completed_at IS NULL ORDER BY created_at")
        .fetch_all(db).await?;
    let mut report = Report::default();
    for job in jobs {
        match finish(db, storage, &job).await {
            Ok(()) => report.exported += 1,
            Err(error) => {
                tracing::warn!("Recovering metadata export for {} failed: {error:#}", job.source_path);
                report.problems.push(job.source_path);
            }
        }
    }
    Ok(report)
}

async fn journal(db: &PgPool, job: &Job) -> anyhow::Result<()> {
    let duplicate: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tracks WHERE content_hash=$1 AND id<>$2)")
        .bind(&job.new_hash)
        .bind(job.track_id)
        .fetch_one(db)
        .await?;
    anyhow::ensure!(!duplicate, "The exported file would duplicate another track");
    sqlx::query("INSERT INTO file_metadata_exports(id,track_id,source_path,old_hash,new_hash,files,cover_stamp,lyrics_hash,lyrics_extension) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)")
        .bind(job.id).bind(job.track_id).bind(&job.source_path).bind(&job.old_hash).bind(&job.new_hash)
        .bind(&job.files).bind(&job.cover_stamp).bind(&job.lyrics_hash).bind(&job.lyrics_extension).execute(db).await?;
    Ok(())
}

pub(super) async fn run(db: &PgPool, storage: &Storage, cancel: &CancellationToken) -> anyhow::Result<Report> {
    let Some(_lock) = crate::file_names::lock(storage)? else {
        return Ok(Report::default());
    };
    let mut report = recover(db, storage).await?;
    anyhow::ensure!(
        crate::file_names::recover(db, storage).await?.problems.is_empty(),
        "Pending file names must be recovered first"
    );
    let tracks: Vec<Track> = sqlx::query_as("SELECT t.id,t.file_path,t.content_hash,t.title,a.name AS artist,al.cover_path,COALESCE(l.plain,'') AS plain,COALESCE(l.synced,'[]'::jsonb) AS synced,s.source_hash AS exported_hash,s.cover_stamp,s.lyrics_hash,s.lyrics_extension FROM tracks t JOIN artists a ON a.id=t.artist_id LEFT JOIN albums al ON al.id=t.album_id LEFT JOIN track_lyrics l ON l.track_id=t.id LEFT JOIN file_metadata_state s ON s.track_id=t.id WHERE NOT EXISTS(SELECT 1 FROM file_metadata_exports j WHERE j.track_id=t.id AND j.completed_at IS NULL) ORDER BY t.created_at,t.id")
        .fetch_all(db).await?;
    for track in tracks {
        if cancel.is_cancelled() {
            break;
        }
        let path = track.file_path.clone();
        let fs_storage = storage.clone();
        let prepared = tokio::task::spawn_blocking(move || {
            if current(&fs_storage, &track)? {
                Ok(None)
            } else {
                prepare(&fs_storage, &track, Uuid::now_v7()).map(Some)
            }
        })
        .await?;
        let result = async {
            let Some((job, mut guard)) = prepared? else {
                return Ok::<_, anyhow::Error>(false);
            };
            if job.files.is_empty() {
                let mut tx = db.begin().await?;
                save_state(&mut tx, &job).await?;
                tx.commit().await?;
                return Ok::<_, anyhow::Error>(false);
            }
            journal(db, &job).await?;
            guard.journaled = true;
            finish(db, storage, &job).await?;
            Ok(true)
        }
        .await;
        match result {
            Ok(true) => report.exported += 1,
            Ok(false) => {}
            Err(error) => {
                tracing::warn!("Metadata export for {path} failed: {error:#}");
                report.problems.push(path);
            }
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests;
