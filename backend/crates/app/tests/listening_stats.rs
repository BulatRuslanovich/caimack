// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich
#![cfg(feature = "integration-tests")]

use app::library::listening;
use chrono::{Duration, Utc};
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrations = "../../../db/migrations")]
async fn stats_isolate_users_deduplicate_reports_and_include_unfinished_listening(db: PgPool) -> anyhow::Result<()> {
    let user = Uuid::new_v4();
    let other = Uuid::new_v4();
    for id in [user, other] {
        sqlx::query("INSERT INTO users(id,username,password_hash,created_at) VALUES($1,$2,'test',now())")
            .bind(id)
            .bind(id.to_string())
            .execute(&db)
            .await?;
    }
    sqlx::query(
        "INSERT INTO user_settings(user_id,quality,time_zone,updated_at) VALUES($1,0,'Pacific/Kiritimati',now())",
    )
    .bind(user)
    .execute(&db)
    .await?;
    let artist = Uuid::new_v4();
    let track = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO artists(id,name,normalized_name,created_at) VALUES($1,'Stats artist','stats artist',now())",
    )
    .bind(artist)
    .execute(&db)
    .await?;
    sqlx::query("INSERT INTO tracks(id,title,normalized_title,artist_id,year,duration_seconds,file_path,original_file_name,mime_type,file_size,content_hash,created_at)
        VALUES($1,'Stats song','stats song',$2,2014,180,'stats.mp3','stats.mp3','audio/mpeg',1,'stats',now())")
        .bind(track).bind(artist).execute(&db).await?;
    let session = Uuid::new_v4();
    let at = Utc::now() - Duration::minutes(2);
    for (owner, kind, seconds, offset) in
        [(user, 1, 0, 0), (user, 2, 30, 30), (user, 2, 30, 30), (user, 2, 45, 45), (other, 3, 180, 50)]
    {
        sqlx::query("INSERT INTO playback_events(id,user_id,track_id,type,occurred_at,position_seconds,listened_seconds,duration_seconds,session_id)
            VALUES($1,$2,$3,$4,$5,$6,$6,180,$7)")
            .bind(Uuid::now_v7()).bind(owner).bind(track).bind(kind).bind(at + Duration::seconds(offset)).bind(seconds).bind(session).execute(&db).await?;
    }
    let stats = listening::overview(&db, user).await?;
    assert_eq!(stats.time_zone, "Pacific/Kiritimati");
    assert_eq!(stats.weeks.len(), 25);
    assert_eq!(stats.weeks.iter().map(|w| w.listened_seconds).sum::<i64>(), 45);
    let week = stats.weeks.iter().find(|w| w.listened_seconds > 0).ok_or_else(|| anyhow::anyhow!("missing week"))?;
    assert_eq!((week.plays, week.distinct_tracks, week.distinct_artists), (1, 1, 1));
    assert_eq!(week.decade, Some(2010));
    assert_eq!(week.decade_share, Some(100));
    assert_eq!(week.artist_share, Some(100));
    assert_eq!(week.top_tracks[0].plays, 1);
    assert_eq!(week.top_artists[0].listened_seconds, 45);
    assert_eq!(week.top_tracks[0].weeks_in_top5, 1);

    let second = Uuid::new_v4();
    sqlx::query("INSERT INTO tracks(id,title,normalized_title,artist_id,duration_seconds,file_path,original_file_name,mime_type,file_size,content_hash,created_at)
        VALUES($1,'Second song','second song',$2,180,'second.mp3','second.mp3','audio/mpeg',1,'second',now())")
        .bind(second).bind(artist).execute(&db).await?;
    // Reverse last week's ranking and count repeat attempts independently.
    let past = at - Duration::days(7);
    for (song, kind, seconds, timestamp) in [
        (second, 1, 0, past),
        (second, 3, 40, past + Duration::seconds(40)),
        (second, 1, 0, past + Duration::seconds(50)),
        (second, 3, 40, past + Duration::seconds(90)),
        (track, 1, 0, past + Duration::seconds(100)),
        (track, 3, 45, past + Duration::seconds(145)),
        (second, 1, 0, at + Duration::seconds(60)),
        (second, 2, 40, at + Duration::seconds(100)),
    ] {
        sqlx::query("INSERT INTO playback_events(id,user_id,track_id,type,occurred_at,position_seconds,listened_seconds,duration_seconds,session_id)
            VALUES($1,$2,$3,$4,$5,$6,$6,180,$7)")
            .bind(Uuid::now_v7()).bind(user).bind(song).bind(kind).bind(timestamp).bind(seconds).bind(session).execute(&db).await?;
    }
    let stats = listening::overview(&db, user).await?;
    let recent = stats
        .weeks
        .iter()
        .find(|week| week.top_tracks.first().is_some_and(|row| row.track.id == track))
        .ok_or_else(|| anyhow::anyhow!("missing ranked week"))?;
    assert_eq!(recent.top_tracks[0].previous_rank, Some(2));
    assert_eq!(recent.top_tracks[0].weeks_in_top5, 2);
    assert_eq!(recent.previous_listened_seconds, Some(125));

    let empty = listening::overview(&db, Uuid::new_v4()).await?;
    assert!(empty.weeks.iter().all(|w| w.listened_seconds == 0 && w.top_tracks.is_empty()));
    Ok(())
}
