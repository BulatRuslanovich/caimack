// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

pub mod actions;
pub mod tags;

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use crate::catalog::{albums, artists, tracks};
use crate::library::playlists;
use crate::storage::Storage;
use crate::{AppResult, text::hex_lower};

pub fn hash(bytes: &[u8]) -> String {
    hex_lower(&Sha256::digest(bytes))
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AudioFile {
    pub id: Uuid,
    pub audio_version: String,
    pub file_hash: String,
    pub size: i64,
    pub extension: String,
}

#[derive(Serialize)]
pub struct Asset {
    pub path: String,
    pub version: String,
}

/// Catalog reads share one MVCC snapshot. In particular, an incomplete or
/// independently paginated track listing must never be used as a deletion list.
pub async fn snapshot(db: &PgPool, storage: &Storage, user: Uuid) -> AppResult<Value> {
    tags::prepare_identities(db, storage).await?;
    let mut tx = db.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY").execute(&mut *tx).await?;
    let server: Uuid = sqlx::query_scalar("SELECT id FROM sync_identity").fetch_one(&mut *tx).await?;
    let username: String =
        sqlx::query_scalar("SELECT username FROM users WHERE id=$1").bind(user).fetch_one(&mut *tx).await?;
    let tracks = tracks::fetch(&mut *tx, tracks::select(user)).await?;
    let albums = albums::fetch(&mut *tx, albums::select()).await?;
    let artists = artists::fetch_where(&mut *tx, |_| {}, "a.name, a.id", i64::MAX).await?;
    let files: Vec<AudioFile> = sqlx::query_as(
        "SELECT t.id, COALESCE(s.audio_hash,t.media_cache_hash,t.content_hash) AS audio_version, content_hash AS file_hash,
         file_size AS size, CASE WHEN lower(file_path) LIKE '%.flac' THEN 'flac' ELSE 'mp3' END AS extension
         FROM tracks t LEFT JOIN sync_audio_payloads s ON s.track_id=t.id AND s.source_hash=t.content_hash ORDER BY t.id",
    )
    .fetch_all(&mut *tx)
    .await?;
    let saved_library = crate::library::collection::list(&mut *tx, user).await?;
    let library_folders = crate::library::folders::list(&mut *tx, user).await?;
    let mut pq = playlists::select();
    pq.push(" WHERE p.user_id=").push_bind(user).push(" OR p.is_public ORDER BY p.name,p.id");
    let playlist_summaries = playlists::fetch(&mut *tx, pq).await?;
    let ids: Vec<Uuid> = playlist_summaries.iter().map(|p| p.id).collect();
    let members: Vec<(Uuid, Uuid)> = sqlx::query_as(
        "SELECT playlist_id,track_id FROM playlist_tracks WHERE playlist_id=ANY($1) ORDER BY position,id",
    )
    .bind(&ids)
    .fetch_all(&mut *tx)
    .await?;
    let mut playlist_tracks: BTreeMap<Uuid, Vec<Uuid>> = BTreeMap::new();
    for (playlist, track) in members {
        playlist_tracks.entry(playlist).or_default().push(track);
    }
    let genres: Vec<sqlx::types::Json<Value>> = sqlx::query_scalar(
        "SELECT jsonb_build_object('id',g.id,'name',g.name,'trackCount',count(t.id),'coverAlbumIds',
          COALESCE(jsonb_agg(DISTINCT t.album_id) FILTER (WHERE t.album_id IS NOT NULL),'[]'))
         FROM genres g LEFT JOIN tracks t ON t.genre_id=g.id GROUP BY g.id ORDER BY g.name",
    )
    .fetch_all(&mut *tx)
    .await?;
    let mut lyrics = BTreeMap::<Uuid, Value>::new();
    for lyric in crate::catalog::lyrics::all(&mut tx).await? {
        lyrics.insert(lyric.track_id, serde_json::to_value(lyric).map_err(crate::AppError::internal)?);
    }
    let waveform_rows: Vec<(Uuid, Vec<u8>)> =
        sqlx::query_as("SELECT track_id,waveform FROM track_cues WHERE succeeded AND waveform IS NOT NULL")
            .fetch_all(&mut *tx)
            .await?;
    let waveforms: BTreeMap<_, _> = waveform_rows.into_iter().map(|(id, peaks)| (id, json!({"peaks":peaks}))).collect();
    let recent: Vec<Uuid> = sqlx::query_scalar(
        "SELECT track_id FROM listening_history WHERE user_id=$1 GROUP BY track_id ORDER BY max(played_at) DESC LIMIT 1000"
    ).bind(user).fetch_all(&mut *tx).await?;
    let vector_revision: String = sqlx::query_scalar(
        "SELECT COALESCE(string_agg(track_id::text || source_hash || analyzed_at::text, ',' ORDER BY track_id),'')
         FROM track_embeddings WHERE succeeded",
    )
    .fetch_one(&mut *tx)
    .await?;
    let assets: Vec<(String, String)> = sqlx::query_as(
        "SELECT 'api/albums/'||id||'/cover',cover_path FROM albums WHERE cover_path IS NOT NULL
         UNION ALL SELECT 'api/artists/'||id||'/image',image_path FROM artists WHERE image_path IS NOT NULL
         UNION ALL SELECT 'api/playlists/'||id||'/cover',cover_path FROM playlists
          WHERE cover_path IS NOT NULL AND (user_id=$1 OR is_public)",
    )
    .bind(user)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    let mut asset_manifest = Vec::new();
    for (path, file) in assets {
        // Include mtime for administrative in-place image replacements, too.
        if let Some(file_path) = storage.existing(&file)
            && let Ok(meta) = tokio::fs::metadata(file_path).await
        {
            asset_manifest.push(Asset {
                path,
                version: hash(format!("{file}:{:?}:{}", meta.modified().ok(), meta.len()).as_bytes()),
            });
        }
    }
    Ok(json!({
        "protocol":1, "serverId":server, "user":{"id":user,"username":username},
        "generatedAt":chrono::Utc::now(), "tracks":tracks, "files":files, "albums":albums,"artists":artists,
        "savedLibrary":saved_library, "libraryFolders":library_folders, "genres":genres, "playlists":playlist_summaries, "playlistTracks":playlist_tracks,
        "lyrics":lyrics,"waveforms":waveforms,"recent":recent,"assets":asset_manifest,
        "vectorVersion":hash(vector_revision.as_bytes())
    }))
}

pub async fn vectors(db: &PgPool) -> AppResult<Value> {
    let rows: Vec<sqlx::types::Json<Value>> = sqlx::query_scalar(
        "SELECT jsonb_build_object('trackId',track_id,'modelId',model_id,'strategy',strategy,
         'dimension',dimension,'sourceHash',source_hash,'vector',vector) FROM track_embeddings WHERE succeeded ORDER BY track_id"
    ).fetch_all(db).await?;
    Ok(json!({"protocol":1,"items":rows}))
}
