// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

#![cfg(feature = "integration-tests")]

use app::AppResult;
use app::catalog::tracks::{self, TrackFilter, TrackSort};
use app::paging::PageRequest;
use media::key::MusicalKey;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrations = "../../../db/migrations")]
async fn shuffle_applies_the_same_search_tempo_and_key_filters_as_the_track_list(db: PgPool) -> AppResult<()> {
    let user = Uuid::now_v7();
    let artist = Uuid::now_v7();
    sqlx::query("INSERT INTO artists(id,name,normalized_name,created_at) VALUES ($1,'Artist','artist',now())")
        .bind(artist)
        .execute(&db)
        .await?;
    for (index, (title, bpm, key)) in [
        ("slow matching", Some(80.0), Some(0_i16)),
        ("slow too fast", Some(150.0), Some(0)),
        ("slow other key", Some(80.0), Some(1)),
        ("unrelated", Some(80.0), Some(0)),
        ("slow unknown analysis", None, None),
    ]
    .into_iter()
    .enumerate()
    {
        let track = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO tracks(id,title,normalized_title,artist_id,duration_seconds,file_path,
            original_file_name,mime_type,file_size,content_hash,created_at)
            VALUES ($1,$2,$2,$3,180,$4,$4,'audio/mpeg',1,$4,now())",
        )
        .bind(track)
        .bind(title)
        .bind(artist)
        .bind(format!("track-{index}.mp3"))
        .execute(&db)
        .await?;
        sqlx::query(
            "INSERT INTO track_cues(track_id,source_hash,version,succeeded,audio_start_seconds,audio_end_seconds,
            outro_start_seconds,tempo_bpm,musical_key,analyzed_at) VALUES ($1,'test',1,true,0,180,175,$2,$3,now())",
        )
        .bind(track)
        .bind(bpm)
        .bind(key)
        .execute(&db)
        .await?;
    }
    let filter =
        TrackFilter { bpm_min: Some(70.0), bpm_max: Some(90.0), keys: vec![MusicalKey { index: 0, confidence: 1.0 }] };
    let listed = tracks::list(&db, user, PageRequest::default(), TrackSort::Title, Some("slow"), &filter).await?;
    let shuffled = tracks::shuffle(&db, user, None, Some("slow"), &filter).await?;
    assert_eq!(listed.total, 1);
    assert_eq!(
        shuffled.iter().map(|t| t.id).collect::<Vec<_>>(),
        listed.items.iter().map(|t| t.id).collect::<Vec<_>>()
    );
    Ok(())
}
