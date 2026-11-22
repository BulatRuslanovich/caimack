// SPDX-License-Identifier: AGPL-3.0-only
#![cfg(feature = "integration-tests")]

use app::catalog::{edit, tracks};
use app::covers::{UploadedImage, change_track_cover};
use app::storage::{CoverSize, Storage};
use app::streaming::track_cover;
use base64::Engine;
use sqlx::PgPool;
use uuid::Uuid;

fn image() -> UploadedImage {
    UploadedImage {
        bytes: base64::engine::general_purpose::STANDARD
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP438AAAAQBAYDFKhhdAAAAAElFTkSuQmCC")
            .unwrap(),
        content_type: Some("image/png".into()),
        file_name: "art.png".into(),
    }
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn track_art_can_be_replaced_and_reset_independently_of_its_album(db: PgPool) -> anyhow::Result<()> {
    let [artist, album, song, sibling, user] = [(); 5].map(|_| Uuid::now_v7());
    let dir = std::env::temp_dir().join(format!("caimack-track-art-{song}"));
    let storage = Storage::open(&dir)?;
    sqlx::query("INSERT INTO artists(id,name,normalized_name,created_at) VALUES ($1,'Artist','artist',now())")
        .bind(artist)
        .execute(&db)
        .await?;
    sqlx::query("INSERT INTO albums(id,title,normalized_title,artist_id,cover_path,created_at) VALUES ($1,'Album','album',$2,'covers/album.webp',now())")
        .bind(album).bind(artist).execute(&db).await?;
    sqlx::query("INSERT INTO tracks(id,title,normalized_title,artist_id,duration_seconds,file_path,original_file_name,mime_type,file_size,content_hash,created_at)
        SELECT id,'Song','song',$1,12,id::text,id::text,'audio/mpeg',1,id::text,now() FROM unnest($2::uuid[]) id")
        .bind(artist).bind([song,sibling].to_vec()).execute(&db).await?;
    let album_file = storage.resolve("covers/album.webp")?;
    std::fs::write(&album_file, b"album")?;
    assert!(!tracks::get(&db, user, song).await?.has_cover);
    change_track_cover(&db, &storage, song, Some(image())).await?;
    let first = tracks::get(&db, user, song).await?;
    assert!(first.has_cover && first.cover_revision.is_some());
    let thumb = track_cover(&db, &storage, song, CoverSize::Thumb).await?.path;
    sqlx::query("UPDATE tracks SET album_id=$1").bind(album).execute(&db).await?;
    let invalid = UploadedImage { bytes: vec![0], ..image() };
    assert!(change_track_cover(&db, &storage, song, Some(invalid)).await.is_err());
    assert_eq!(track_cover(&db, &storage, song, CoverSize::Thumb).await?.path, thumb);
    change_track_cover(&db, &storage, song, Some(image())).await?;
    assert!(!thumb.exists());
    assert_ne!(tracks::get(&db, user, song).await?.cover_revision, first.cover_revision);
    assert_ne!(track_cover(&db, &storage, song, CoverSize::Large).await?.path, album_file);
    assert_eq!(track_cover(&db, &storage, sibling, CoverSize::Full).await?.path, album_file);
    change_track_cover(&db, &storage, song, None).await?;
    assert_eq!(track_cover(&db, &storage, song, CoverSize::Full).await?.path, album_file);
    assert!(tracks::get(&db, user, song).await?.cover_revision.is_none());
    change_track_cover(&db, &storage, song, Some(image())).await?;
    let full = track_cover(&db, &storage, song, CoverSize::Full).await?.path;
    edit::delete_track(&db, &storage, song).await?;
    assert!(!full.exists());
    assert!(album_file.exists());
    std::fs::remove_dir_all(dir)?;
    Ok(())
}
