// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

#![cfg(feature = "integration-tests")]

use app::recommendations::{listener, quality};
use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;
use uuid::Uuid;

async fn catalog(db: &PgPool) -> anyhow::Result<(Uuid, Uuid, Uuid)> {
    let (user, artist, track) = (Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7());
    sqlx::query("INSERT INTO users(id,username,password_hash,created_at) VALUES ($1,$2,'test',now())")
        .bind(user)
        .bind(user.to_string())
        .execute(db)
        .await?;
    sqlx::query("INSERT INTO artists(id,name,normalized_name,created_at) VALUES ($1,$2,$2,now())")
        .bind(artist)
        .bind(artist.to_string())
        .execute(db)
        .await?;
    add_track(db, artist, track).await?;
    Ok((user, artist, track))
}

async fn add_track(db: &PgPool, artist: Uuid, track: Uuid) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO tracks(id,title,normalized_title,artist_id,duration_seconds,file_path,original_file_name,mime_type,file_size,content_hash,created_at) VALUES ($1,'Song','song',$2,200,$3,$3,'audio/mpeg',1,$3,now())")
        .bind(track).bind(artist).bind(track.to_string()).execute(db).await?;
    Ok(())
}

#[derive(Clone)]
struct Event {
    track: Uuid,
    session: Uuid,
    source: &'static str,
    kind: i32,
    heard: i32,
    duration: i32,
    at: DateTime<Utc>,
}

async fn event(db: &PgPool, user: Uuid, event: &Event) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO playback_events(id,user_id,track_id,type,occurred_at,position_seconds,listened_seconds,duration_seconds,session_id,source) VALUES ($1,$2,$3,$4,$5,199,$6,$7,$8,$9)")
        .bind(Uuid::now_v7()).bind(user).bind(event.track).bind(event.kind).bind(event.at)
        .bind(event.heard).bind(event.duration).bind(event.session).bind(event.source).execute(db).await?;
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn automatic_grades_are_per_attempt_device_and_user_without_invented_dislikes(db: PgPool) -> anyhow::Result<()> {
    let (user, _, track) = catalog(&db).await?;
    let base = Utc::now() - Duration::hours(1);
    for (index, (kind, heard, duration)) in [
        (4, 5, 200),
        (4, 100, 200),
        (3, 160, 200),
        (4, 180, 200),
        (3, 1, 200),
        (4, 60, 200),
        (4, 30, 1000),
        (4, 10, 20),
        (0, 0, 200),
    ]
    .into_iter()
    .enumerate()
    {
        let start = Event {
            track,
            session: Uuid::now_v7(),
            source: "radio",
            kind: 1,
            heard: 0,
            duration,
            at: base + Duration::minutes(index as i64),
        };
        event(&db, user, &start).await?;
        if kind != 0 {
            let end = Event { kind, heard, at: start.at + Duration::seconds(20), ..start.clone() };
            event(&db, user, &end).await?;
            if index == 0 {
                event(&db, user, &end).await?;
            }
        }
    }
    let isolated = Event {
        track,
        session: Uuid::now_v7(),
        source: "radio",
        kind: 1,
        heard: 0,
        duration: 200,
        at: base + Duration::minutes(10),
    };
    event(&db, user, &isolated).await?;
    event(
        &db,
        user,
        &Event {
            session: Uuid::now_v7(),
            kind: 3,
            heard: 200,
            at: isolated.at + Duration::seconds(20),
            ..isolated.clone()
        },
    )
    .await?;
    let (other, _, _) = catalog(&db).await?;
    event(&db, other, &Event { kind: 3, heard: 200, at: isolated.at + Duration::seconds(30), ..isolated.clone() })
        .await?;

    let first = Event { session: Uuid::now_v7(), at: base + Duration::minutes(12), ..isolated.clone() };
    event(&db, user, &first).await?;
    let second = Event { at: base + Duration::minutes(13), ..first.clone() };
    event(&db, user, &second).await?;
    event(&db, user, &Event { kind: 3, heard: 200, at: second.at + Duration::seconds(20), ..second }).await?;
    let manual = Event { source: "album", session: Uuid::now_v7(), ..isolated };
    event(&db, user, &manual).await?;
    event(&db, user, &Event { kind: 3, heard: 200, at: manual.at + Duration::seconds(20), ..manual }).await?;

    let rows = quality::load(&db, user, base - Duration::seconds(1)).await?;
    assert_eq!(rows.len(), 1);
    assert_eq!((rows[0].early_skips, rows[0].partial, rows[0].near_complete, rows[0].unrated), (1, 2, 3, 6));
    assert!(quality::load(&db, Uuid::now_v7(), base).await?.is_empty());
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn taste_uses_listened_fraction_instead_of_completion_flag(db: PgPool) -> anyhow::Result<()> {
    let (user, artist, first) = catalog(&db).await?;
    let now = Utc::now();
    let mut ids = Vec::new();
    for (index, (kind, heard)) in [(3, 1), (4, 180), (3, 100), (4, 5)].into_iter().enumerate() {
        let track = if index == 0 { first } else { Uuid::now_v7() };
        if index != 0 {
            add_track(&db, artist, track).await?;
        }
        let end = Event { track, session: Uuid::now_v7(), source: "radio", kind, heard, duration: 200, at: now };
        event(&db, user, &end).await?;
        ids.push(track);
    }
    let listener = listener::load(&db, user, now).await?;
    assert_eq!(listener.tracks[&ids[0]].score, 0.0);
    assert_eq!(listener.tracks[&ids[1]].score, 1.0);
    assert_eq!(listener.tracks[&ids[2]].score, 0.3);
    assert!(listener.tracks[&ids[3]].score < 0.0);
    Ok(())
}
