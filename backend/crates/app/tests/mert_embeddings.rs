// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

#![cfg(feature = "integration-tests")]

use app::recommendations::index;
use media::mert;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrations = "../../../db/migrations")]
async fn index_excludes_previous_models_strategies_dimensions_and_stale_audio(db: PgPool) -> anyhow::Result<()> {
    let artist = Uuid::now_v7();
    sqlx::query("INSERT INTO artists(id,name,normalized_name,created_at) VALUES ($1,'Artist','artist',now())")
        .bind(artist)
        .execute(&db)
        .await?;
    let mut expected = None;
    for (model, strategy, dimension, hash, succeeded) in [
        ("laion/larger_clap_music_and_speech", "clap_body_v3", 512, "current", true),
        (mert::MODEL_ID, "previous_strategy", 1024, "current", true),
        (mert::MODEL_ID, mert::windows::STRATEGY, 512, "current", true),
        (mert::MODEL_ID, mert::windows::STRATEGY, 1024, "old_audio", true),
        (mert::MODEL_ID, mert::windows::STRATEGY, 1024, "current", false),
        (mert::MODEL_ID, mert::windows::STRATEGY, 1024, "current", true),
    ] {
        let track = Uuid::now_v7();
        let file = format!("{track}.mp3");
        sqlx::query("INSERT INTO tracks(id,title,normalized_title,artist_id,duration_seconds,file_path,original_file_name,mime_type,file_size,content_hash,created_at) VALUES ($1,'Song','song',$2,180,$3,$3,'audio/mpeg',1,$3,now())")
            .bind(track).bind(artist).bind(&file).execute(&db).await?;
        let mut vector = vec![0.0_f32; dimension as usize];
        vector[0] = 1.0;
        sqlx::query("INSERT INTO track_embeddings(track_id,vector,dimension,model_id,strategy,source_hash,succeeded,analyzed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())")
            .bind(track).bind(vector).bind(dimension).bind(model).bind(strategy)
            .bind(if hash == "current" { &file } else { hash }).bind(succeeded)
            .execute(&db).await?;
        expected = Some(track);
    }
    let snapshot = index::load(&db).await?;
    assert_eq!(snapshot.len(), 1);
    assert_eq!(snapshot.dimension(), mert::DIMENSION);
    assert_eq!(snapshot.meta(0).track_id, expected.unwrap());
    Ok(())
}
