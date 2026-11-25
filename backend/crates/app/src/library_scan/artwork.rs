// SPDX-License-Identifier: AGPL-3.0-only

use std::collections::HashSet;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use sqlx::PgPool;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::storage::Storage;
use crate::upload::cover::PreparedCover;

const MAX_COVER_BYTES: u64 = 20 * 1024 * 1024;
const COVER_NAMES: [&str; 3] = ["cover", "folder", "front"];

#[derive(sqlx::FromRow)]
struct AlbumFolder {
    id: Uuid,
    title: String,
    artist: String,
    folder: String,
    only_album: bool,
}

pub(super) fn folder_cover(directory: &Path) -> Option<Vec<u8>> {
    ranked_images(directory, None).iter().find_map(|path| read_image(path))
}

pub(super) async fn fill_missing(
    db: &PgPool,
    storage: &Storage,
    root: &Path,
    cancel: &CancellationToken,
) -> anyhow::Result<()> {
    let folders = sqlx::query_as::<_, AlbumFolder>(
        r#"WITH folders AS (
            SELECT DISTINCT t.album_id, regexp_replace(f.path, '(^|/)[^/]+$', '') AS folder
            FROM library_files f JOIN tracks t ON t.id = f.track_id AND t.file_path = 'library/' || f.path
            WHERE f.status = $1 AND f.missing_since IS NULL
        ), counted AS (
            SELECT album_id, folder, count(*) OVER (PARTITION BY folder) = 1 AS only_album FROM folders
        )
        SELECT a.id, a.title, ar.name AS artist, c.folder, c.only_album
        FROM counted c JOIN albums a ON a.id = c.album_id JOIN artists ar ON ar.id = a.artist_id
        WHERE a.cover_path IS NULL ORDER BY a.id, c.folder"#,
    )
    .bind(super::Status::Linked as i16)
    .fetch_all(db)
    .await?;

    let mut handled = HashSet::new();
    for album in folders {
        if cancel.is_cancelled() {
            break;
        }
        let id = album.id;
        if handled.contains(&id) {
            continue;
        }
        let directory = root.join(&album.folder);
        let set = tokio::task::spawn_blocking(move || {
            ranked_images(&directory, Some(&album))
                .iter()
                .filter_map(|path| read_image(path))
                .find_map(|bytes| media::images::folder_cover_set(&bytes).ok())
        })
        .await?;
        let Some(set) = set else { continue };
        let mut cover = PreparedCover::save(storage, &set).await?;
        let updated = sqlx::query("UPDATE albums SET cover_path = $2 WHERE id = $1 AND cover_path IS NULL")
            .bind(id)
            .bind(cover.path())
            .execute(db)
            .await?;
        if updated.rows_affected() > 0 {
            cover.persist();
            tracing::debug!(album_id = %id, "Album cover loaded from the music folder");
        }
        handled.insert(id);
    }
    Ok(())
}

fn ranked_images(directory: &Path, album: Option<&AlbumFolder>) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(directory) else { return Vec::new() };
    let images: Vec<_> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| matches!(ext.to_ascii_lowercase().as_str(), "jpg" | "jpeg" | "png" | "webp"))
                && path.file_stem().and_then(|stem| stem.to_str()).is_some_and(|stem| !stem.starts_with('.'))
                && path.is_file()
        })
        .collect();
    let album_keys = album.map(|album| (key(&album.title), key(&format!("{} {}", album.artist, album.title))));
    let sole_candidate = images.len() == 1 && album.is_some_and(|album| album.only_album && !album.folder.is_empty());

    let mut ranked: Vec<_> = images
        .into_iter()
        .filter_map(|path| {
            let stem = path.file_stem()?.to_str()?;
            let rank = if let Some(rank) = COVER_NAMES.iter().position(|name| name.eq_ignore_ascii_case(stem)) {
                rank
            } else if album_keys.as_ref().is_some_and(|(title, with_artist)| {
                let stem = key(stem);
                !stem.is_empty() && (stem == *title || stem == *with_artist)
            }) {
                COVER_NAMES.len()
            } else if sole_candidate && !is_secondary_art(stem) {
                COVER_NAMES.len() + 1
            } else {
                return None;
            };
            Some((rank, path))
        })
        .collect();
    ranked.sort_unstable();
    ranked.into_iter().map(|(_, path)| path).collect()
}

fn key(value: &str) -> String {
    value.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

fn is_secondary_art(stem: &str) -> bool {
    stem.split(|c: char| !c.is_alphanumeric()).any(|word| {
        matches!(word.to_ascii_lowercase().as_str(), "back" | "rear" | "booklet" | "tray" | "disc" | "disk" | "cd")
    })
}

fn read_image(path: &Path) -> Option<Vec<u8>> {
    let file = File::open(path).ok()?;
    if file.metadata().ok()?.len() > MAX_COVER_BYTES {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(MAX_COVER_BYTES + 1).read_to_end(&mut bytes).ok()?;
    (bytes.len() as u64 <= MAX_COVER_BYTES).then_some(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn album() -> AlbumFolder {
        AlbumFolder {
            id: Uuid::now_v7(),
            title: "Mercury - Act 2".into(),
            artist: "Imagine Dragons".into(),
            folder: "Imagine Dragons/Mercury - Act 2".into(),
            only_album: true,
        }
    }

    #[test]
    fn album_art_wins_over_other_images_without_overriding_explicit_names() -> anyhow::Result<()> {
        let album = album();
        let dir = std::env::temp_dir().join(album.id.simple().to_string());
        fs::create_dir(&dir)?;
        let named = dir.join("imagine_dragons_mercury_act2.jpg");
        let explicit = dir.join("front.png");
        fs::write(&named, b"album")?;
        fs::write(dir.join("booklet.jpg"), b"booklet")?;
        fs::write(&explicit, b"front")?;
        assert_eq!(ranked_images(&dir, Some(&album)), [explicit, named]);
        fs::remove_dir_all(dir)?;
        Ok(())
    }

    #[test]
    fn an_unmatched_image_is_used_only_for_an_unambiguous_album_folder() -> anyhow::Result<()> {
        let mut album = album();
        album.title = "Mercury - Act 1".into();
        let dir = std::env::temp_dir().join(album.id.simple().to_string());
        fs::create_dir(&dir)?;
        let front = dir.join("imagine_dragons_mercury.jpg");
        fs::write(&front, b"album")?;
        assert_eq!(ranked_images(&dir, Some(&album)), std::slice::from_ref(&front));
        album.only_album = false;
        assert!(ranked_images(&dir, Some(&album)).is_empty());
        album.only_album = true;
        let rear = dir.join("back.jpg");
        fs::write(&rear, b"back")?;
        assert!(ranked_images(&dir, Some(&album)).is_empty());
        fs::remove_file(front)?;
        assert!(ranked_images(&dir, Some(&album)).is_empty());
        fs::remove_dir_all(dir)?;
        Ok(())
    }

    #[cfg(feature = "integration-tests")]
    #[sqlx::test(migrations = "../../../db/migrations")]
    async fn backfills_existing_tracks_when_art_arrives_and_keeps_the_catalog_cover(db: PgPool) -> anyhow::Result<()> {
        let album = album();
        let dir = std::env::temp_dir().join(album.id.simple().to_string());
        let storage = Storage::open(&dir)?;
        let library = dir.join("library");
        let album_dir = library.join(&album.folder);
        fs::create_dir_all(&album_dir)?;
        let track = Uuid::now_v7();
        let artist = Uuid::now_v7();
        let path = format!("{}/Track.flac", album.folder);
        fs::write(library.join(&path), b"existing audio")?;
        sqlx::query("INSERT INTO artists(id,name,normalized_name,created_at) VALUES($1,'Imagine Dragons','imagine dragons',now())")
            .bind(artist).execute(&db).await?;
        sqlx::query("INSERT INTO albums(id,title,normalized_title,artist_id,created_at) VALUES($1,'Mercury - Act 2','mercury - act 2',$2,now())")
            .bind(album.id).bind(artist).execute(&db).await?;
        sqlx::query("INSERT INTO tracks(id,title,normalized_title,artist_id,album_id,duration_seconds,file_path,original_file_name,mime_type,file_size,content_hash,created_at) VALUES($1,'Track','track',$2,$3,2,$4,'Track.flac','audio/flac',14,'track-hash',now())")
            .bind(track).bind(artist).bind(album.id).bind(format!("library/{path}")).execute(&db).await?;
        sqlx::query("INSERT INTO library_files(path,size_bytes,modified_at,content_hash,track_id,status,scanned_at) VALUES($1,14,now(),'track-hash',$2,1,now())")
            .bind(path).bind(track).execute(&db).await?;
        let cover_path = || async {
            sqlx::query_scalar::<_, Option<String>>("SELECT cover_path FROM albums WHERE id=$1")
                .bind(album.id)
                .fetch_one(&db)
                .await
        };
        let cancel = CancellationToken::new();
        fill_missing(&db, &storage, &library, &cancel).await?;
        assert_eq!(cover_path().await?, None);

        let png = "89504e470d0a1a0a0000000d4948445200000002000000020802000000fdd49a730000001649444154789c63fccfc0c0c0c0c0c4c0c0c0c0c000000d1d01036ac29be90000000049454e44ae426082";
        let png: Vec<_> = png
            .as_bytes()
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect();
        fs::write(album_dir.join("imagine_dragons_mercury_act2.png"), &png)?;
        fill_missing(&db, &storage, &library, &cancel).await?;
        let saved = cover_path().await?.expect("cover for the existing album");
        assert!(storage.existing(&saved).is_some());
        fs::write(album_dir.join("cover.png"), &png)?;
        fill_missing(&db, &storage, &library, &cancel).await?;
        assert_eq!(cover_path().await?.as_deref(), Some(saved.as_str()));
        assert_eq!(fs::read(library.join(&album.folder).join("Track.flac"))?, b"existing audio");
        fs::remove_dir_all(dir)?;
        Ok(())
    }
}
