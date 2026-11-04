// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use reco::session::{Action, Event};
use sqlx::PgPool;
use uuid::Uuid;

use super::listener::BROWSED_SOURCES;

// Bounded by user and time using ix_playback_events_user_id_occurred_at.
// Older clients without a session ID follow the latest device's session.
pub(super) async fn load(db: &PgPool, user: Uuid, session: Option<Uuid>) -> sqlx::Result<Vec<Event>> {
    let rows = sqlx::query!(
        r#"SELECT track_id AS "track_id!", type AS kind, occurred_at, listened_seconds, duration_seconds, source
    FROM playback_events
    WHERE user_id = $1 AND track_id IS NOT NULL
      AND occurred_at >= now() - interval '45 minutes'
      AND session_id = COALESCE($2, (
          SELECT session_id FROM playback_events WHERE user_id = $1
          ORDER BY occurred_at DESC, id DESC LIMIT 1))
      AND type IN (1, 2, 3, 4, 6, 7, 8, 11)
    ORDER BY occurred_at DESC, id DESC LIMIT 200"#,
        user,
        session,
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .rev()
        .filter_map(|row| {
            let action = match row.kind {
                1 => Action::Started,
                2 => Action::Progress,
                3 => Action::Completed,
                4 => Action::Skipped,
                6 => Action::Replayed,
                7 => Action::Liked,
                8 => Action::Unliked,
                11 => Action::Queued,
                _ => return None,
            };
            Some(Event {
                track: row.track_id,
                action,
                at: row.occurred_at.timestamp(),
                listened: row.listened_seconds,
                duration: row.duration_seconds,
                chosen: row
                    .source
                    .as_deref()
                    .is_some_and(|source| BROWSED_SOURCES.contains(&source) || source == "queue"),
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[sqlx::test(migrations = "../../../db/migrations")]
    #[ignore = "requires a local PostgreSQL DATABASE_URL with CREATE DATABASE permission"]
    async fn sessions_are_ordered_and_isolated_between_users_and_devices(db: PgPool) -> crate::AppResult<()> {
        assert!(load(&db, Uuid::now_v7(), None).await?.is_empty());
        let (user, other_user, device, other_device, track, artist) =
            (Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7());
        for id in [user, other_user] {
            sqlx::query("INSERT INTO users(id,username,password_hash,created_at) VALUES ($1,$2,'test',now())")
                .bind(id)
                .bind(id.to_string())
                .execute(&db)
                .await?;
        }
        sqlx::query("INSERT INTO artists(id,name,normalized_name,created_at) VALUES ($1,'Test','test',now())")
            .bind(artist)
            .execute(&db)
            .await?;
        sqlx::query(
            "INSERT INTO tracks(id,title,normalized_title,artist_id,duration_seconds,file_path,
            original_file_name,mime_type,file_size,content_hash,created_at)
            VALUES ($1,'Song','song',$2,200,'test.mp3','test.mp3','audio/mpeg',1,'test',now())",
        )
        .bind(track)
        .bind(artist)
        .execute(&db)
        .await?;
        for (owner, session, kind, seconds) in [
            (user, device, 1, 40),
            (user, device, 3, 20),
            (user, other_device, 7, 10),
            (other_user, device, 4, 5),
            (user, device, 1, 3600),
        ] {
            sqlx::query(
                "INSERT INTO playback_events(id,user_id,track_id,type,occurred_at,position_seconds,
                listened_seconds,duration_seconds,session_id,source)
                VALUES ($1,$2,$3,$4,now()-make_interval(secs => $5),10,10,200,$6,'radio')",
            )
            .bind(Uuid::now_v7())
            .bind(owner)
            .bind(track)
            .bind(kind)
            .bind(f64::from(seconds))
            .bind(session)
            .execute(&db)
            .await?;
        }
        let events = load(&db, user, Some(device)).await?;
        assert_eq!(events.iter().map(|event| event.action).collect::<Vec<_>>(), [Action::Started, Action::Completed]);
        assert_eq!(load(&db, user, None).await?[0].action, Action::Liked);
        assert_eq!(load(&db, other_user, Some(device)).await?.len(), 1);
        let listener = super::super::listener::load(&db, other_user, Utc::now()).await?;
        assert!(!listener.tracks[&track].rejected(), "one early skip must not ban a song");
        Ok(())
    }
}
