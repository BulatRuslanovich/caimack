use super::*;
use crate::catalog::edit::{self, UpdateTrackRequest};
use crate::i18n::Lang;
use crate::integrations::enrichment::EnrichmentQueue;
use crate::library_scan::LibraryScanner;
use crate::streaming::HashCache;
use crate::transcode::TranscodeQueue;
use crate::upload::Uploads;

struct Folder(PathBuf);
impl Drop for Folder {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn folder() -> anyhow::Result<(Folder, Storage)> {
    let path = std::env::temp_dir().join(format!("caimack-names-{}", Uuid::now_v7()));
    let storage = Storage::open(&path)?;
    fs::create_dir_all(path.join("library"))?;
    Ok((Folder(path), storage))
}

fn put(storage: &Storage, path: &str, bytes: &[u8]) -> anyhow::Result<()> {
    fs::write(storage.resolve(path)?, bytes)?;
    Ok(())
}

async fn track(db: &PgPool, storage: &Storage, name: &str, title: &str) -> anyhow::Result<Track> {
    let artist = Uuid::now_v7();
    sqlx::query("INSERT INTO artists(id,name,normalized_name,created_at) VALUES($1,'Artist',$2,now())")
        .bind(artist)
        .bind(artist.to_string())
        .execute(db)
        .await?;
    let id = Uuid::now_v7();
    let path = format!("library/{name}");
    put(storage, &path, id.as_bytes())?;
    let (size, hash) = storage::hash_file(&storage.resolve(&path)?)?;
    sqlx::query("INSERT INTO tracks(id,title,normalized_title,artist_id,duration_seconds,file_path,original_file_name,mime_type,file_size,content_hash,created_at,file_name_verified) VALUES($1,$2,$2,$3,180,$4,$5,'audio/mpeg',$6,$7,now(),true)")
        .bind(id).bind(title).bind(artist).bind(&path).bind(name).bind(size).bind(&hash).execute(db).await?;
    let modified = chrono::DateTime::<chrono::Utc>::from(fs::metadata(storage.resolve(&path)?)?.modified()?);
    sqlx::query("INSERT INTO library_files(path,size_bytes,modified_at,content_hash,track_id,status,scanned_at) VALUES($1,$2,$3,$4,$5,1,now())")
        .bind(name).bind(size).bind(modified).bind(&hash).bind(id).execute(db).await?;
    sqlx::query("INSERT INTO track_embeddings(track_id,vector,dimension,model_id,strategy,source_hash,succeeded,analyzed_at) VALUES($1,ARRAY[1.0]::real[],1,'test','test',$2,true,now())")
        .bind(id).bind(&hash).execute(db).await?;
    sqlx::query(
        "INSERT INTO track_lyrics(track_id,plain,synced,source,updated_at) VALUES($1,'Words','[]'::jsonb,1,now())",
    )
    .bind(id)
    .execute(db)
    .await?;
    Ok(Track {
        id,
        file_path: path,
        content_hash: hash,
        title: title.into(),
        artist: "Artist".into(),
        file_name_verified: Some(true),
    })
}

async fn path(db: &PgPool, id: Uuid) -> sqlx::Result<String> {
    sqlx::query_scalar("SELECT file_path FROM tracks WHERE id=$1").bind(id).fetch_one(db).await
}

#[test]
fn names_are_portable_unicode_and_bounded() -> anyhow::Result<()> {
    assert_eq!(stem("Артист / Band", "Трек: \"Live\"?\n."), Some("Артист Band - Трек Live".into()));
    assert!(stem("Unknown Artist", "Track").is_none());
    assert!(stem("Band", "... / ").is_none());
    let name = stem(&"Я".repeat(200), "Title").context("name")?;
    assert!(name.len() <= 180);
    assert!(canonical("Artist - Track (2)", "Artist - Track"));
    assert!(!canonical("Artist - Track (Live)", "Artist - Track"));
    let (_folder, storage) = folder()?;
    let _guard = lock(&storage)?.context("lock")?;
    assert!(lock(&storage)?.is_none());
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
#[cfg_attr(not(feature = "integration-tests"), ignore = "requires PostgreSQL")]
async fn collisions_sidecars_and_rescans_keep_identity_and_embeddings(db: PgPool) -> anyhow::Result<()> {
    let (_folder, storage) = folder()?;
    let track = track(&db, &storage, "bad_123.mp3", "Song").await?;
    for suffix in ["lrc", "en.lrc", "txt", "srt", "jpg"] {
        put(&storage, &format!("library/bad_123.{suffix}"), suffix.as_bytes())?;
    }
    put(&storage, "library/cover.jpg", b"album")?;
    put(&storage, "library/Artist - Song.mp3", b"unrelated audio")?;
    put(&storage, "library/Artist - Song (2).lrc", b"unrelated lyrics")?;
    let before: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT analyzed_at FROM track_embeddings WHERE track_id=$1")
            .bind(track.id)
            .fetch_one(&db)
            .await?;
    let report = run(&db, &storage, &CancellationToken::new()).await?;
    assert_eq!(report.renamed, 1);
    assert!(report.problems.is_empty());
    let target = "library/Artist - Song (3).mp3";
    assert_eq!(path(&db, track.id).await?, target);
    assert!(!storage.resolve(&track.file_path)?.exists());
    assert_eq!(storage::hash_file(&storage.resolve(target)?)?.1, track.content_hash);
    for suffix in ["lrc", "en.lrc", "txt", "srt", "jpg"] {
        assert_eq!(fs::read(storage.resolve(&format!("library/Artist - Song (3).{suffix}"))?)?, suffix.as_bytes());
    }
    assert_eq!(fs::read(storage.resolve("library/Artist - Song.mp3")?)?, b"unrelated audio");
    assert_eq!(fs::read(storage.resolve("library/Artist - Song (2).lrc")?)?, b"unrelated lyrics");
    assert_eq!(fs::read(storage.resolve("library/cover.jpg")?)?, b"album");
    assert_eq!(run(&db, &storage, &CancellationToken::new()).await?.renamed, 0);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM track_lyrics WHERE track_id=$1")
            .bind(track.id)
            .fetch_one(&db)
            .await?,
        1
    );
    let after: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT analyzed_at FROM track_embeddings WHERE track_id=$1")
            .bind(track.id)
            .fetch_one(&db)
            .await?;
    assert_eq!(before, after);
    // The scan must find the renamed row, with unchanged size/mtime/hash, rather than reimport it.
    fs::remove_file(storage.resolve("library/Artist - Song.mp3")?)?;
    let (transcodes, _) = TranscodeQueue::new();
    let (enrichment, _) = EnrichmentQueue::new();
    let uploads =
        Uploads { db: db.clone(), storage: storage.clone(), transcodes, hashes: HashCache::default(), enrichment };
    let scanner = LibraryScanner::new(db.clone(), storage.clone(), uploads);
    let cancel = CancellationToken::new();
    scanner.request();
    let worker = scanner.clone().spawn(None, cancel.clone());
    for _ in 0..100 {
        if scanner.status(Lang::En).finished_at.is_some() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    cancel.cancel();
    worker.await?;
    let status = scanner.status(Lang::En);
    assert!(status.finished_at.is_some());
    assert_eq!((status.added, status.moved, status.updated, status.missing, status.failed), (0, 0, 0, 0, 0));
    assert_eq!(path(&db, track.id).await?, target);
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
#[cfg_attr(not(feature = "integration-tests"), ignore = "requires PostgreSQL")]
async fn recovery_finishes_each_interrupted_phase(db: PgPool) -> anyhow::Result<()> {
    let (_folder, storage) = folder()?;
    for phase in 0..3 {
        let track = track(&db, &storage, &format!("old{phase}.mp3"), &format!("Song {phase}")).await?;
        put(&storage, &format!("library/old{phase}.lrc"), b"words")?;
        let job = plan(&db, &storage, &track, &format!("Artist - Song {phase}")).await?.context("job")?;
        reserve(&storage, &job.moves)?;
        if phase == 1 {
            fs::remove_file(storage.resolve(&track.file_path)?)?;
        }
        if phase == 2 {
            sqlx::query("UPDATE tracks SET file_path=$2 WHERE id=$1")
                .bind(track.id)
                .bind(&job.target_path)
                .execute(&db)
                .await?;
        }
        let target = job.target_path.clone();
        let report = recover(&db, &storage).await?;
        assert!(report.problems.is_empty());
        assert_eq!(report.renamed, 1);
        assert_eq!(path(&db, track.id).await?, target);
        assert!(!storage.resolve(&track.file_path)?.exists());
        assert_eq!(fs::read(storage.resolve(&format!("library/Artist - Song {phase}.lrc"))?)?, b"words");
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM file_renames WHERE completed_at IS NULL")
            .fetch_one(&db)
            .await?,
        0
    );
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
#[cfg_attr(not(feature = "integration-tests"), ignore = "requires PostgreSQL")]
async fn racing_collision_never_replaces_files(db: PgPool) -> anyhow::Result<()> {
    let (_folder, storage) = folder()?;
    let track = track(&db, &storage, "old.mp3", "Song").await?;
    put(&storage, "library/old.lrc", b"words")?;
    let job = plan(&db, &storage, &track, "Artist - Song").await?.context("job")?;
    put(&storage, "library/Artist - Song.lrc", b"new owner")?;
    assert!(finish(&db, &storage, job).await.is_err());
    assert_eq!(path(&db, track.id).await?, track.file_path);
    assert!(!storage.resolve("library/Artist - Song.mp3")?.exists());
    assert_eq!(fs::read(storage.resolve("library/Artist - Song.lrc")?)?, b"new owner");
    assert_eq!(run(&db, &storage, &CancellationToken::new()).await?.renamed, 1);
    assert_eq!(path(&db, track.id).await?, "library/Artist - Song (2).mp3");
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
#[cfg_attr(not(feature = "integration-tests"), ignore = "requires PostgreSQL")]
async fn database_failure_keeps_original_and_journal_for_recovery(db: PgPool) -> anyhow::Result<()> {
    let (_folder, storage) = folder()?;
    let track = track(&db, &storage, "old.mp3", "Song").await?;
    let job = plan(&db, &storage, &track, "Artist - Song").await?.context("job")?;
    sqlx::raw_sql("CREATE FUNCTION reject_rename() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated failure'; END $$; CREATE TRIGGER reject_rename BEFORE UPDATE OF file_path ON tracks FOR EACH ROW EXECUTE FUNCTION reject_rename();")
        .execute(&db).await?;
    assert!(finish(&db, &storage, job).await.is_err());
    assert!(storage.resolve(&track.file_path)?.exists());
    assert_eq!(path(&db, track.id).await?, track.file_path);
    sqlx::query("DROP TRIGGER reject_rename ON tracks").execute(&db).await?;
    assert_eq!(recover(&db, &storage).await?.renamed, 1);
    assert_eq!(path(&db, track.id).await?, "library/Artist - Song.mp3");
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
#[cfg_attr(not(feature = "integration-tests"), ignore = "requires PostgreSQL")]
async fn filename_guesses_wait_for_explicit_metadata_edits(db: PgPool) -> anyhow::Result<()> {
    let (_folder, storage) = folder()?;
    let track = track(&db, &storage, "bad.mp3", "bad").await?;
    sqlx::query("UPDATE tracks SET file_name_verified=false WHERE id=$1").bind(track.id).execute(&db).await?;
    assert_eq!(run(&db, &storage, &CancellationToken::new()).await?.renamed, 0);
    edit::update_track(
        &db,
        &storage,
        Uuid::now_v7(),
        track.id,
        UpdateTrackRequest { title: Some("Actual title".into()), ..Default::default() },
    )
    .await?;
    assert_eq!(run(&db, &storage, &CancellationToken::new()).await?.renamed, 1);
    assert_eq!(path(&db, track.id).await?, "library/Artist - Actual title.mp3");
    Ok(())
}

#[cfg(unix)]
#[test]
fn symlinks_cannot_move_files_outside_the_music_root() -> anyhow::Result<()> {
    let (_folder, storage) = folder()?;
    let (outside, _) = folder()?;
    std::os::unix::fs::symlink(&outside.0, storage.resolve("library/escape")?)?;
    assert!(checked(&storage, "library/escape/song.mp3").is_err());
    fs::write(outside.0.join("song.mp3"), b"outside")?;
    std::os::unix::fs::symlink(outside.0.join("song.mp3"), storage.resolve("library/song.mp3")?)?;
    assert!(checked(&storage, "library/song.mp3").is_err());
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
#[cfg_attr(not(feature = "integration-tests"), ignore = "requires PostgreSQL")]
async fn managed_uploads_are_renamed_without_an_external_library(db: PgPool) -> anyhow::Result<()> {
    let (_folder, storage) = folder()?;
    let track = track(&db, &storage, "upload.mp3", "Upload").await?;
    let source = "music/internal.mp3";
    fs::rename(storage.resolve(&track.file_path)?, storage.resolve(source)?)?;
    fs::remove_dir(storage.resolve("library")?)?;
    sqlx::query("UPDATE tracks SET file_path=$2 WHERE id=$1").bind(track.id).bind(source).execute(&db).await?;
    sqlx::query("DELETE FROM library_files").execute(&db).await?;
    let (transcodes, _) = TranscodeQueue::new();
    let (enrichment, _) = EnrichmentQueue::new();
    let uploads =
        Uploads { db: db.clone(), storage: storage.clone(), transcodes, hashes: HashCache::default(), enrichment };
    let scanner = LibraryScanner::new(db.clone(), storage.clone(), uploads).with_file_renaming(true);
    let cancel = CancellationToken::new();
    scanner.request();
    let worker = scanner.clone().spawn(None, cancel.clone());
    for _ in 0..100 {
        if scanner.status(Lang::En).renamed == 1 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    cancel.cancel();
    worker.await?;
    assert_eq!(scanner.status(Lang::En).renamed, 1);
    assert_eq!(path(&db, track.id).await?, "music/Artist - Upload.mp3");
    assert_eq!(storage::hash_file(&storage.resolve("music/Artist - Upload.mp3")?)?.1, track.content_hash);
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
#[cfg_attr(not(feature = "integration-tests"), ignore = "requires PostgreSQL")]
async fn companions_shared_by_two_audio_formats_are_not_taken(db: PgPool) -> anyhow::Result<()> {
    let (_folder, storage) = folder()?;
    let track = track(&db, &storage, "song.mp3", "Song").await?;
    put(&storage, "library/song.fLaC", b"other format")?;
    put(&storage, "library/song.lrc", b"shared text")?;
    let report = run(&db, &storage, &CancellationToken::new()).await?;
    assert_eq!(report.renamed, 0);
    assert_eq!(report.problems.len(), 1);
    assert_eq!(path(&db, track.id).await?, track.file_path);
    assert_eq!(fs::read(storage.resolve("library/song.lrc")?)?, b"shared text");
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
#[cfg_attr(not(feature = "integration-tests"), ignore = "requires PostgreSQL and ffmpeg")]
async fn queued_hls_work_follows_the_track_after_its_old_name_is_reused(db: PgPool) -> anyhow::Result<()> {
    let (_folder, storage) = folder()?;
    let track = track(&db, &storage, "old.mp3", "Song").await?;
    let source = storage.resolve(&track.file_path)?;
    let result = std::process::Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=44100",
            "-t",
            "1.5",
            "-y",
        ])
        .arg(&source)
        .status()?;
    assert!(result.success());
    let (size, hash) = storage::hash_file(&source)?;
    sqlx::query("UPDATE tracks SET content_hash=$2,file_size=$3 WHERE id=$1")
        .bind(track.id)
        .bind(&hash)
        .bind(size)
        .execute(&db)
        .await?;
    assert_eq!(run(&db, &storage, &CancellationToken::new()).await?.renamed, 1);
    put(&storage, &track.file_path, b"a different recording now occupies the old name")?;
    let (queue, receivers) = TranscodeQueue::new();
    let cancel = CancellationToken::new();
    let workers = crate::transcode::spawn(db, storage.clone(), queue.clone(), receivers, cancel.clone());
    let quality = crate::library::settings::AudioQuality::Low;
    assert!(queue.try_enqueue_urgent(crate::transcode::TranscodeRequest {
        content_hash: hash.clone(),
        source: track.file_path,
        quality,
    }));
    for _ in 0..250 {
        if storage.hls_variant_ready(&hash, quality) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    cancel.cancel();
    for worker in workers {
        worker.await?;
    }
    assert!(storage.hls_variant_ready(&hash, quality));
    Ok(())
}
