// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use media::{images, tags};
use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;
use uuid::{Builder, Uuid};

use super::names::{self, BookName};
use super::{Artwork, Book, Chapter, ChapterFile, Snapshot};

const COVER_NAMES: &[&str] = &["cover", "folder", "front", "albumart", "albumartsmall"];

#[derive(Debug, PartialEq, Eq)]
pub(super) struct SourceFile {
    path: PathBuf,
    size_bytes: i64,
    modified: Option<SystemTime>,
}

#[derive(Default)]
struct BookFiles {
    chapters: Vec<SourceFile>,
    covers: Vec<SourceFile>,
}

pub(super) fn read(root: &Path, previous: &Snapshot, cancel: &CancellationToken) -> anyhow::Result<Snapshot> {
    let root = match root.canonicalize() {
        Ok(root) => root,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Snapshot::default()),
        Err(error) => return Err(error.into()),
    };
    let mut groups = BTreeMap::<PathBuf, BookFiles>::new();
    let walk = walkdir::WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| entry.depth() == 0 || !entry.file_name().to_string_lossy().starts_with('.'));
    let mut root_images = Vec::new();
    for entry in walk {
        if cancel.is_cancelled() {
            return Ok(Snapshot::default());
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) if error.depth() == 0 => return Err(error.into()),
            Err(error) => {
                tracing::warn!(%error, "Could not read an audiobook folder entry");
                continue;
            }
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let relative = entry.path().strip_prefix(&root)?;
        let Some(key) = relative.iter().next().filter(|name| name.to_str().is_some()) else { continue };
        let is_audio = mime_type(relative).is_some();
        if !is_audio && !is_image(relative) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else { continue };
        let source = SourceFile {
            path: relative.to_path_buf(),
            size_bytes: i64::try_from(metadata.len())?,
            modified: metadata.modified().ok(),
        };
        if is_audio {
            groups.entry(PathBuf::from(key)).or_default().chapters.push(source);
        } else if entry.depth() == 1 {
            root_images.push(source);
        } else if entry.depth() == 2 {
            groups.entry(PathBuf::from(key)).or_default().covers.push(source);
        }
    }

    for cover in root_images {
        let Some(stem) = cover.path.file_stem() else { continue };
        for (name, files) in groups.iter_mut().filter(|(path, _)| path.file_stem() == Some(stem)) {
            if files.chapters.first().is_some_and(|chapter| chapter.path == *name) {
                files.covers.push(SourceFile { path: cover.path.clone(), ..cover });
            }
        }
    }

    let mut books = HashMap::new();
    for (name, mut files) in groups {
        if files.chapters.is_empty() || cancel.is_cancelled() {
            continue;
        }
        files.chapters.sort_by(|a, b| compare_paths(&a.path, &b.path));
        files.covers.sort_by_key(|file| (cover_rank(&file.path), file.path.clone()));
        let id = path_id("audiobook", &name);
        let mut fingerprint = files.chapters;
        let chapter_count = fingerprint.len();
        fingerprint.extend(files.covers);
        let book = previous.books.get(&id).filter(|book| previous.root == root && book.fingerprint == fingerprint);
        if let Some(book) = book {
            books.insert(id, Arc::clone(book));
        } else if let Some(book) = read_book(&root, &name, id, fingerprint, chapter_count, cancel) {
            books.insert(id, Arc::new(book));
        }
    }
    Ok(Snapshot { root, books })
}

fn read_book(
    root: &Path,
    name: &Path,
    id: Uuid,
    fingerprint: Vec<SourceFile>,
    chapter_count: usize,
    cancel: &CancellationToken,
) -> Option<Book> {
    let (audio, images) = fingerprint.split_at(chapter_count);
    let standalone = audio.first()?.path == name;
    let mut art = images
        .iter()
        .filter(|file| standalone || cover_rank(&file.path).is_some())
        .find_map(|file| read_artwork(root, file));
    let label = if standalone { name.file_stem()? } else { name.as_os_str() };
    let BookName { title: named_title, mut author, mut narrator, release } = names::book(&label.to_string_lossy());
    let mut title = author.as_ref().filter(|_| !release).map(|_| named_title.clone());
    let mut duration_ms: i64 = 0;
    let mut chapters = Vec::new();
    for file in audio {
        if cancel.is_cancelled() {
            return None;
        }
        let Some(metadata) = tags::read_audiobook(&root.join(&file.path), art.is_none()) else {
            tracing::warn!("Ignoring unreadable audiobook file {}", file.path.display());
            continue;
        };
        if art.is_none() {
            art = metadata.cover.and_then(artwork);
        }
        if title.is_none() {
            title = metadata
                .album
                .as_deref()
                .or(if standalone { metadata.title.as_deref() } else { None })
                .map(names::display_label);
        }
        if author.is_none() {
            author = metadata.author;
        }
        if narrator.is_none() {
            narrator = metadata.narrator;
        }
        duration_ms = duration_ms.saturating_add(metadata.duration_ms);
        let chapter_id = path_id("audiobook-chapter", &file.path);
        let stem = file.path.file_stem().unwrap_or_default();
        let chapter_title = if stem == label && metadata.title.as_deref().is_none_or(|tag| tag == stem) {
            named_title.clone()
        } else {
            names::chapter_title(
                metadata.title.as_deref(),
                &stem.to_string_lossy(),
                metadata.album.as_deref().unwrap_or(&named_title),
                author.as_deref(),
                narrator.as_deref(),
            )
        };
        chapters.push(ChapterFile {
            data: Chapter {
                id: chapter_id,
                title: chapter_title,
                duration_ms: metadata.duration_ms,
                size_bytes: file.size_bytes,
                stream_url: format!("/api/audiobooks/{id}/chapters/{chapter_id}/stream"),
            },
            path: file.path.clone(),
        });
    }
    if art.is_none() && !standalone {
        let mut unnamed = images.iter().filter(|file| cover_rank(&file.path).is_none());
        if let Some(file) = unnamed.next()
            && unnamed.next().is_none()
        {
            art = read_artwork(root, file);
        }
    }

    (!chapters.is_empty()).then(|| Book {
        id,
        title: title.unwrap_or(named_title),
        author,
        narrator,
        duration_ms,
        chapters,
        cover: art,
        fingerprint,
    })
}

pub(super) fn mime_type(path: &Path) -> Option<&'static str> {
    media::formats::for_file_name(path.file_name()?.to_str()?).map(|format| format.mime_type).or_else(|| {
        match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
            "m4a" | "m4b" => Some("audio/mp4"),
            "ogg" | "oga" | "opus" => Some("audio/ogg"),
            "wav" => Some("audio/wav"),
            _ => None,
        }
    })
}

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| matches!(extension.to_ascii_lowercase().as_str(), "jpg" | "jpeg" | "png" | "webp"))
}

fn cover_rank(path: &Path) -> Option<usize> {
    let name = path.file_stem()?.to_str()?.to_ascii_lowercase();
    COVER_NAMES.iter().position(|stem| *stem == name)
}

fn read_artwork(root: &Path, file: &SourceFile) -> Option<Artwork> {
    if file.size_bytes > crate::covers::MAX_IMAGE_BYTES {
        return None;
    }
    artwork(std::fs::read(root.join(&file.path)).ok()?)
}

fn artwork(bytes: Vec<u8>) -> Option<Artwork> {
    if bytes.len() > usize::try_from(crate::covers::MAX_IMAGE_BYTES).ok()? {
        return None;
    }
    let webp = images::square_webp_set(&bytes, &[images::FULL_EDGE]).ok()?.pop()?.webp;
    let etag = format!("\"{}\"", crate::text::hex_lower(&Sha256::digest(&webp)));
    Some(Artwork { etag, webp: webp.into() })
}

fn path_id(kind: &str, path: &Path) -> Uuid {
    let mut hash = Sha256::new();
    hash.update(kind);
    for part in path {
        hash.update([0]);
        hash.update(part.as_encoded_bytes());
    }
    let digest = hash.finalize();
    let mut bytes = [0; 16];
    bytes.copy_from_slice(&digest[..16]);
    Builder::from_custom_bytes(bytes).into_uuid()
}

fn compare_paths(a: &Path, b: &Path) -> Ordering {
    for (a, b) in a.iter().zip(b) {
        let a = a.to_string_lossy();
        let b = b.to_string_lossy();
        let ordering = natural_cmp(a.as_bytes(), b.as_bytes());
        if ordering != Ordering::Equal {
            return ordering;
        }
    }
    a.components().count().cmp(&b.components().count()).then_with(|| a.cmp(b))
}

fn natural_cmp(mut a: &[u8], mut b: &[u8]) -> Ordering {
    while let (Some(&left), Some(&right)) = (a.first(), b.first()) {
        if left.is_ascii_digit() && right.is_ascii_digit() {
            let (left_digits, left_rest) = a.split_at(a.iter().take_while(|byte| byte.is_ascii_digit()).count());
            let (right_digits, right_rest) = b.split_at(b.iter().take_while(|byte| byte.is_ascii_digit()).count());
            let left = significant_digits(left_digits);
            let right = significant_digits(right_digits);
            let ordering = left.len().cmp(&right.len()).then_with(|| left.cmp(right));
            if ordering != Ordering::Equal {
                return ordering;
            }
            a = left_rest;
            b = right_rest;
        } else {
            let ordering = left.to_ascii_lowercase().cmp(&right.to_ascii_lowercase());
            if ordering != Ordering::Equal {
                return ordering;
            }
            a = &a[1..];
            b = &b[1..];
        }
    }
    a.len().cmp(&b.len())
}

fn significant_digits(digits: &[u8]) -> &[u8] {
    &digits[digits.iter().take_while(|&&byte| byte == b'0').count()..]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numeric_chapters_and_disc_directories_are_ordered() {
        let mut chapters = ["Disc 10/01.mp3", "Disc 1/2.mp3", "Disc 2/1.mp3", "Disc 1/11.mp3", "Disc 1/001.mp3"];
        chapters.sort_by(|a, b| compare_paths(Path::new(a), Path::new(b)));
        assert_eq!(chapters, ["Disc 1/001.mp3", "Disc 1/2.mp3", "Disc 1/11.mp3", "Disc 2/1.mp3", "Disc 10/01.mp3"]);
    }
}
