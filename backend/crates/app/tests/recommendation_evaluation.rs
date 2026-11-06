// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

#![cfg(feature = "integration-tests")]

use app::recommendations::evaluation;
use media::mert;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrations = "../../../db/migrations")]
async fn evaluation_reads_current_vectors_and_does_not_generate_feedback(db: PgPool) -> anyhow::Result<()> {
    let user = Uuid::now_v7();
    sqlx::query("INSERT INTO users(id,username,password_hash,created_at) VALUES ($1,'listener','test',now())")
        .bind(user)
        .execute(&db)
        .await?;
    let mut tracks = Vec::new();
    for index in 0..4 {
        let artist = Uuid::now_v7();
        let track = Uuid::now_v7();
        let title = format!("Song {index}");
        sqlx::query("INSERT INTO artists(id,name,normalized_name,created_at) VALUES ($1,$2,$2,now())")
            .bind(artist)
            .bind(format!("Artist {index}"))
            .execute(&db)
            .await?;
        sqlx::query("INSERT INTO tracks(id,title,normalized_title,artist_id,duration_seconds,file_path,original_file_name,mime_type,file_size,content_hash,created_at) VALUES ($1,$2,$2,$3,180,$2,$2,'audio/mpeg',1,$2,now())")
            .bind(track).bind(&title).bind(artist).execute(&db).await?;
        let mut vector = vec![0.0_f32; mert::DIMENSION];
        vector[index] = 1.0;
        sqlx::query("INSERT INTO track_embeddings(track_id,vector,dimension,model_id,strategy,source_hash,succeeded,analyzed_at) VALUES ($1,$2,$3,$4,$5,$6,true,now())")
            .bind(track).bind(vector).bind(mert::DIMENSION as i32).bind(mert::MODEL_ID)
            .bind(mert::windows::STRATEGY).bind(&title).execute(&db).await?;
        tracks.push(track);
    }
    // Read-only connections also fail the test if exporting ever starts writing.
    let options = db.connect_options();
    let readonly = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .after_connect(|connection, _| {
            Box::pin(async move {
                sqlx::query("SET default_transaction_read_only = on").execute(connection).await?;
                Ok(())
            })
        })
        .connect_with((*options).clone())
        .await?;
    let report = evaluation::report(&readonly, "listener", &tracks[..1]).await?;
    assert_eq!(report.track_count, 4);
    assert_eq!(report.cases.len(), 1);
    assert_eq!(report.cases[0].similarity.count, 3);
    assert_eq!(report.tracks.len(), 4);
    assert!(report.cases[0].variants.iter().all(|v| v.picks.len() == 3));
    let events: i64 = sqlx::query_scalar("SELECT count(*) FROM playback_events").fetch_one(&db).await?;
    let impressions: i64 = sqlx::query_scalar("SELECT count(*) FROM recommendation_impressions").fetch_one(&db).await?;
    assert_eq!((events, impressions), (0, 0));
    assert!(evaluation::report(&readonly, "missing", &[]).await.is_err());
    assert!(evaluation::report(&readonly, "listener", &[tracks[0], tracks[0]]).await.is_err());
    assert!(evaluation::report(&readonly, "listener", &[Uuid::now_v7()]).await.is_err());
    readonly.close().await;
    Ok(())
}
