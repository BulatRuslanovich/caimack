use super::*;
use crate::catalog::lyrics;
use crate::library::settings::AudioQuality;
use crate::streaming::{self, HashCache};
use crate::transcode::TranscodeQueue;

struct Folder(PathBuf);
impl Drop for Folder {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn fixture(ext: &str) -> anyhow::Result<(Folder, Storage, PathBuf)> {
    let root = std::env::temp_dir().join(format!("caimack-export-{}", Uuid::now_v7()));
    let storage = Storage::open(&root)?;
    fs::create_dir_all(root.join("library"))?;
    let audio = root.join(format!("library/Artist - Song.{ext}"));
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
            "-metadata",
            "title=Song",
            "-metadata",
            "artist=Artist",
            "-metadata",
            "comment=keep this comment",
            "-y",
        ])
        .arg(&audio)
        .status()?;
    assert!(result.success());
    let image = root.join("blue.png");
    assert!(
        std::process::Command::new("ffmpeg")
            .args([
                "-nostdin",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=64x64",
                "-frames:v",
                "1",
                "-threads",
                "1",
                "-y"
            ])
            .arg(&image)
            .status()?
            .success()
    );
    let cover = media::images::square_webp_set(&fs::read(image)?, &[640])?;
    fs::write(storage.resolve("covers/art.webp")?, &cover[0].webp)?;
    Ok((Folder(root), storage, audio))
}

fn packets(path: &Path) -> anyhow::Result<Vec<u8>> {
    let result = std::process::Command::new("ffmpeg")
        .args(["-nostdin", "-v", "error", "-i"])
        .arg(path)
        .args(["-map", "0:a:0", "-c:a", "copy", "-f", "hash", "-hash", "sha256", "-"])
        .output()?;
    anyhow::ensure!(result.status.success(), "ffmpeg packet hash failed");
    Ok(result.stdout)
}

async fn seed(db: &PgPool, storage: &Storage, audio: &Path) -> anyhow::Result<(Uuid, String)> {
    let id = Uuid::now_v7();
    let artist = Uuid::now_v7();
    let album = Uuid::now_v7();
    let (size, hash) = storage::hash_file(audio)?;
    let leaf = audio.file_name().and_then(|s| s.to_str()).context("filename")?;
    let relative = format!("library/{leaf}");
    sqlx::query("INSERT INTO artists(id,name,normalized_name,created_at) VALUES($1,'Artist',$2,now())")
        .bind(artist)
        .bind(artist.to_string())
        .execute(db)
        .await?;
    sqlx::query("INSERT INTO albums(id,title,normalized_title,artist_id,cover_path,created_at) VALUES($1,'Album',$2,$3,'covers/art.webp',now())")
        .bind(album).bind(album.to_string()).bind(artist).execute(db).await?;
    sqlx::query("INSERT INTO tracks(id,title,normalized_title,artist_id,album_id,duration_seconds,file_path,original_file_name,mime_type,file_size,content_hash,codec,bitrate_kbps,created_at,file_name_verified) VALUES($1,'Song','song',$2,$3,2,$4,$5,'audio/mpeg',$6,$7,'mp3',128,now(),true)")
        .bind(id).bind(artist).bind(album).bind(&relative).bind(leaf).bind(size).bind(&hash).execute(db).await?;
    sqlx::query("INSERT INTO library_files(path,size_bytes,modified_at,content_hash,track_id,status,scanned_at) VALUES($1,$2,now(),$3,$4,1,now())")
        .bind(leaf).bind(size).bind(&hash).bind(id).execute(db).await?;
    sqlx::query(
        "INSERT INTO track_lyrics(track_id,plain,synced,source,updated_at) VALUES($1,'First\nNext',$2,2,now())",
    )
    .bind(id)
    .bind(sqlx::types::Json(vec![
        LyricLine::new(1234, "First".into()),
        LyricLine::new(2345, "Next".into()),
    ]))
    .execute(db)
    .await?;
    sqlx::query("INSERT INTO track_embeddings(track_id,vector,dimension,model_id,strategy,source_hash,succeeded,analyzed_at) VALUES($1,ARRAY[1.0]::real[],1,'model','strategy',$2,true,'2020-01-01T00:00Z')")
        .bind(id).bind(&hash).execute(db).await?;
    sqlx::query("INSERT INTO track_cues(track_id,source_hash,version,succeeded,analyzed_at) VALUES($1,$2,1,true,'2020-01-01T00:00Z')")
        .bind(id).bind(&hash).execute(db).await?;
    let cache = storage.hls_variant_dir(&hash, AudioQuality::Low)?;
    fs::create_dir_all(&cache)?;
    fs::write(cache.join(media::ffmpeg::HLS_INDEX), "#EXTM3U\n")?;
    fs::write(cache.join(media::ffmpeg::HLS_MEDIA), b"cached audio")?;
    Ok((id, hash))
}

async fn get_track(db: &PgPool, id: Uuid) -> sqlx::Result<Track> {
    sqlx::query_as("SELECT t.id,t.file_path,t.content_hash,t.title,a.name AS artist,al.cover_path,COALESCE(l.plain,'') AS plain,COALESCE(l.synced,'[]'::jsonb) AS synced,s.source_hash AS exported_hash,s.cover_stamp,s.lyrics_hash,s.lyrics_extension FROM tracks t JOIN artists a ON a.id=t.artist_id LEFT JOIN albums al ON al.id=t.album_id LEFT JOIN track_lyrics l ON l.track_id=t.id LEFT JOIN file_metadata_state s ON s.track_id=t.id WHERE t.id=$1")
        .bind(id).fetch_one(db).await
}

#[sqlx::test(migrations = "../../../db/migrations")]
#[cfg_attr(not(feature = "integration-tests"), ignore = "requires PostgreSQL and ffmpeg")]
async fn artwork_lrc_and_cache_survive_without_reencoding_or_reanalysing(db: PgPool) -> anyhow::Result<()> {
    for ext in ["mp3", "flac"] {
        let (_folder, storage, audio) = fixture(ext)?;
        let (id, old_hash) = seed(&db, &storage, &audio).await?;
        let before = packets(&audio)?;
        let report = run(&db, &storage, &CancellationToken::new()).await?;
        assert_eq!(report.exported, 1);
        assert!(report.problems.is_empty(), "{:?}", report.problems);
        assert_eq!(packets(&audio)?, before);
        let metadata = media::tags::read(&audio).context("tags")?;
        assert_eq!(metadata.title.as_deref(), Some("Song"));
        assert_eq!(metadata.artists, ["Artist"]);
        assert!(metadata.cover.context("embedded art")?.starts_with(&[0xff, 0xd8]));
        let text = fs::read_to_string(audio.with_extension("lrc"))?;
        assert!(text.contains("[00:01.23]First\r\n"));
        assert_eq!(lyrics::parse(Some(&text)).lines.len(), 2);
        let current = get_track(&db, id).await?;
        assert_ne!(current.content_hash, old_hash);
        assert_eq!(current.content_hash, storage::hash_file(&audio)?.1);
        let retained:(String,String,Vec<f32>,chrono::DateTime<chrono::Utc>)=sqlx::query_as("SELECT t.media_cache_hash,e.source_hash,e.vector,e.analyzed_at FROM tracks t JOIN track_embeddings e ON e.track_id=t.id WHERE t.id=$1")
            .bind(id).fetch_one(&db).await?;
        assert_eq!(retained.0, old_hash);
        assert_eq!(retained.1, current.content_hash);
        assert_eq!(retained.2, [1.0]);
        assert_eq!(retained.3.timestamp(), 1_577_836_800);
        let (queue, _) = TranscodeQueue::new();
        let master = streaming::hls_master(&db, &storage, &queue, id, AudioQuality::Low).await?;
        assert!(master.playlist.is_some());
        let segment =
            streaming::hls_asset(&db, &storage, &HashCache::default(), id, AudioQuality::Low, media::ffmpeg::HLS_MEDIA)
                .await?;
        assert_eq!(fs::read(segment.path)?, b"cached audio");
        let modified = fs::metadata(&audio)?.modified()?;
        assert_eq!(run(&db, &storage, &CancellationToken::new()).await?.exported, 0);
        assert_eq!(fs::metadata(&audio)?.modified()?, modified);
        // Only the track belonging to this filesystem participates in the next iteration.
        sqlx::query("DELETE FROM tracks WHERE id=$1").bind(id).execute(&db).await?;
    }
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
#[cfg_attr(not(feature = "integration-tests"), ignore = "requires PostgreSQL and ffmpeg")]
async fn recovery_after_file_replacement_and_database_failure(db: PgPool) -> anyhow::Result<()> {
    let (_folder, storage, audio) = fixture("mp3")?;
    let (id, old_hash) = seed(&db, &storage, &audio).await?;
    let before = packets(&audio)?;
    let track = get_track(&db, id).await?;
    let (job, mut guard) = prepare(&storage, &track, Uuid::now_v7())?;
    journal(&db, &job).await?;
    guard.journaled = true;
    sqlx::raw_sql("CREATE FUNCTION reject_export() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated database failure'; END $$; CREATE TRIGGER reject_export BEFORE UPDATE OF content_hash ON tracks FOR EACH ROW EXECUTE FUNCTION reject_export();")
        .execute(&db).await?;
    assert!(finish(&db, &storage, &job).await.is_err());
    assert_ne!(storage::hash_file(&audio)?.1, old_hash);
    assert_eq!(get_track(&db, id).await?.content_hash, old_hash);
    sqlx::query("DROP TRIGGER reject_export ON tracks").execute(&db).await?;
    assert_eq!(recover(&db, &storage).await?.exported, 1);
    assert_eq!(packets(&audio)?, before);
    assert_eq!(get_track(&db, id).await?.content_hash, job.new_hash);
    let original = job.files[0].backup.as_deref().context("backup")?;
    assert_eq!(storage::hash_file(&storage.resolve(original)?)?.1, old_hash);
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
#[cfg_attr(not(feature = "integration-tests"), ignore = "requires PostgreSQL and ffmpeg")]
async fn plain_text_updates_and_user_companions_have_backups(db: PgPool) -> anyhow::Result<()> {
    let (_folder, storage, audio) = fixture("mp3")?;
    let (id, _) = seed(&db, &storage, &audio).await?;
    fs::write(audio.with_extension("lrc"), "user text")?;
    assert_eq!(run(&db, &storage, &CancellationToken::new()).await?.exported, 1);
    let json: sqlx::types::Json<Vec<Change>> =
        sqlx::query_scalar("SELECT files FROM file_metadata_exports WHERE track_id=$1").bind(id).fetch_one(&db).await?;
    let change = json.iter().find(|change| change.target.ends_with(".lrc")).context("lyric change")?;
    assert_eq!(fs::read_to_string(storage.resolve(change.backup.as_deref().context("backup")?)?)?, "user text");
    sqlx::query("UPDATE track_lyrics SET synced='[]'::jsonb,plain='Обычный текст' WHERE track_id=$1")
        .bind(id)
        .execute(&db)
        .await?;
    assert_eq!(run(&db, &storage, &CancellationToken::new()).await?.exported, 1);
    assert!(!audio.with_extension("lrc").exists());
    assert_eq!(fs::read_to_string(audio.with_extension("txt"))?, "Обычный текст\r\n");
    sqlx::query("DELETE FROM track_lyrics WHERE track_id=$1").bind(id).execute(&db).await?;
    fs::write(audio.with_extension("txt"), "user edited our export")?;
    run(&db, &storage, &CancellationToken::new()).await?;
    assert_eq!(fs::read_to_string(audio.with_extension("txt"))?, "user edited our export");
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
#[cfg_attr(not(feature = "integration-tests"), ignore = "requires PostgreSQL and ffmpeg")]
async fn shared_companions_are_never_overwritten(db: PgPool) -> anyhow::Result<()> {
    let (_folder, storage, audio) = fixture("mp3")?;
    let (_, hash) = seed(&db, &storage, &audio).await?;
    fs::write(audio.with_extension("fLaC"), b"other recording")?;
    fs::write(audio.with_extension("lrc"), b"shared lyrics")?;
    let report = run(&db, &storage, &CancellationToken::new()).await?;
    assert_eq!(report.exported, 0);
    assert_eq!(report.problems.len(), 1);
    assert_eq!(fs::read(audio.with_extension("lrc"))?, b"shared lyrics");
    assert_eq!(storage::hash_file(&audio)?.1, hash);
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT count(*) FROM file_metadata_exports").fetch_one(&db).await?, 0);
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
#[cfg_attr(not(feature = "integration-tests"), ignore = "requires PostgreSQL and ffmpeg")]
async fn tag_exports_preserve_lookup_progress_but_audio_replacements_reset_it(db: PgPool) -> anyhow::Result<()> {
    let (_folder, storage, audio) = fixture("mp3")?;
    let (id, _) = seed(&db, &storage, &audio).await?;
    sqlx::query(
        "UPDATE enrichment_jobs SET last_outcome='not_found',next_attempt_at=now()+interval '7 days' WHERE track_id=$1",
    )
    .bind(id)
    .execute(&db)
    .await?;
    assert_eq!(run(&db, &storage, &CancellationToken::new()).await?.exported, 1);
    let outcomes: Vec<Option<String>> =
        sqlx::query_scalar("SELECT last_outcome FROM enrichment_jobs WHERE track_id=$1")
            .bind(id)
            .fetch_all(&db)
            .await?;
    assert_eq!(outcomes, vec![Some("not_found".into()), Some("not_found".into())]);
    sqlx::query("UPDATE tracks SET content_hash='different-audio',media_cache_hash=NULL WHERE id=$1")
        .bind(id)
        .execute(&db)
        .await?;
    let outcomes: Vec<Option<String>> =
        sqlx::query_scalar("SELECT last_outcome FROM enrichment_jobs WHERE track_id=$1")
            .bind(id)
            .fetch_all(&db)
            .await?;
    assert_eq!(outcomes, vec![None, None]);
    Ok(())
}
