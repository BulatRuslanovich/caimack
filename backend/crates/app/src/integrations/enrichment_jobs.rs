// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use sqlx::PgPool;
use uuid::Uuid;

#[derive(sqlx::FromRow)]
pub(super) struct Job {
    pub entity_id: Uuid,
    pub attempts: i32,
    pub lease: Uuid,
}

// These runtime queries deliberately live beside an additive migration: existing
// SQLx metadata for the baseline schema remains usable in offline builds.
pub(super) async fn seed(db: &PgPool, kind: &str) -> sqlx::Result<u64> {
    let query = if kind == "artist" {
        "INSERT INTO enrichment_jobs(kind,entity_id,artist_id)
         SELECT $1,a.id,a.id FROM artists a
         WHERE NOT EXISTS (SELECT 1 FROM enrichment_jobs j WHERE j.kind=$1 AND j.entity_id=a.id)
         ORDER BY a.id LIMIT 500 ON CONFLICT DO NOTHING"
    } else {
        "INSERT INTO enrichment_jobs(kind,entity_id,track_id)
         SELECT $1,t.id,t.id FROM tracks t
         WHERE NOT EXISTS (SELECT 1 FROM enrichment_jobs j WHERE j.kind=$1 AND j.entity_id=t.id)
         ORDER BY t.id LIMIT 500 ON CONFLICT DO NOTHING"
    };
    Ok(sqlx::query(query).bind(kind).execute(db).await?.rows_affected())
}

pub(super) async fn claim(db: &PgPool, kind: &str) -> sqlx::Result<Option<Job>> {
    sqlx::query_as(
        "WITH candidate AS (
            SELECT entity_id FROM enrichment_jobs
            WHERE kind=$1 AND next_attempt_at<=now() AND (locked_until IS NULL OR locked_until<now())
            ORDER BY priority,next_attempt_at,entity_id FOR UPDATE SKIP LOCKED LIMIT 1
         ) UPDATE enrichment_jobs j SET locked_until=now()+interval '10 minutes', lease=$2,
             attempts=j.attempts+1, updated_at=now()
         FROM candidate c WHERE j.kind=$1 AND j.entity_id=c.entity_id
         RETURNING j.entity_id,j.attempts,j.lease",
    )
    .bind(kind)
    .bind(Uuid::now_v7())
    .fetch_optional(db)
    .await
}

pub(super) fn retry_seconds(attempts: i32, id: Uuid) -> i64 {
    let exponent = u32::try_from(attempts.saturating_sub(1)).unwrap_or(0).min(9);
    (60_i64 * 2_i64.pow(exponent)).min(21_600) + i64::from(id.as_bytes()[15] % 30)
}

pub(super) async fn finish(
    db: &PgPool,
    kind: &str,
    job: &Job,
    outcome: &str,
    error: Option<String>,
) -> sqlx::Result<()> {
    let seconds = match outcome {
        "failed" => retry_seconds(job.attempts, job.entity_id),
        "not_found" | "instrumental" => 7 * 86_400,
        _ => 86_400,
    };
    sqlx::query(
        "UPDATE enrichment_jobs SET locked_until=NULL,lease=NULL,last_outcome=$4,last_error=$5,
        next_attempt_at=now()+make_interval(secs=>$6::double precision),
        attempts=CASE WHEN $4='failed' THEN attempts ELSE 0 END,priority=10,updated_at=now()
        WHERE kind=$1 AND entity_id=$2 AND lease=$3",
    )
    .bind(kind)
    .bind(job.entity_id)
    .bind(job.lease)
    .bind(outcome)
    .bind(error)
    .bind(seconds as f64)
    .execute(db)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transient_failures_back_off_and_are_bounded() {
        let id = Uuid::nil();
        assert_eq!(retry_seconds(1, id), 60);
        assert_eq!(retry_seconds(2, id), 120);
        assert_eq!(retry_seconds(i32::MAX, id), 21_600);
    }

    #[sqlx::test(migrations = "../../../db/migrations")]
    #[ignore = "requires a local PostgreSQL DATABASE_URL with CREATE DATABASE permission"]
    async fn durable_jobs_recover_leases_deduplicate_and_reject_stale_completion(db: PgPool) -> sqlx::Result<()> {
        let artist = Uuid::now_v7();
        sqlx::query("INSERT INTO artists(id,name,normalized_name,created_at) VALUES ($1,'Test','test',now())")
            .bind(artist)
            .execute(&db)
            .await?;
        assert_eq!(seed(&db, "artist").await?, 0);
        let job = claim(&db, "artist").await?.unwrap();
        assert_eq!(job.entity_id, artist);
        assert!(claim(&db, "artist").await?.is_none());
        // Simulate a process dying after claim. Another worker can reclaim the lease.
        sqlx::query("UPDATE enrichment_jobs SET locked_until=now()-interval '1 second'").execute(&db).await?;
        let replacement = claim(&db, "artist").await?.unwrap();
        finish(&db, "artist", &job, "saved", None).await?;
        let lease: Option<Uuid> = sqlx::query_scalar("SELECT lease FROM enrichment_jobs WHERE entity_id=$1")
            .bind(artist)
            .fetch_one(&db)
            .await?;
        assert_eq!(lease, Some(replacement.lease));
        finish(&db, "artist", &replacement, "not_found", None).await?;
        assert!(claim(&db, "artist").await?.is_none());
        // Editing metadata revives a cooled-down task atomically with the edit.
        sqlx::query("UPDATE artists SET name='Renamed' WHERE id=$1").bind(artist).execute(&db).await?;
        assert!(claim(&db, "artist").await?.is_some());
        sqlx::query("DELETE FROM artists WHERE id=$1").bind(artist).execute(&db).await?;
        let remaining: i64 = sqlx::query_scalar("SELECT count(*) FROM enrichment_jobs").fetch_one(&db).await?;
        assert_eq!(remaining, 0);
        Ok(())
    }

    #[sqlx::test(migrations = "../../../db/migrations")]
    #[ignore = "requires a local PostgreSQL DATABASE_URL with CREATE DATABASE permission"]
    async fn historical_tracks_are_discovered_without_reimporting_audio(db: PgPool) -> sqlx::Result<()> {
        let artist = Uuid::now_v7();
        let track = Uuid::now_v7();
        sqlx::query("INSERT INTO artists(id,name,normalized_name,created_at) VALUES ($1,'Test','test',now())")
            .bind(artist)
            .execute(&db)
            .await?;
        sqlx::query("INSERT INTO tracks(id,title,normalized_title,artist_id,duration_seconds,file_path,original_file_name,mime_type,file_size,content_hash,created_at)
            VALUES ($1,'Song','song',$2,180,'music/test.mp3','test.mp3','audio/mpeg',100,'hash',now())")
            .bind(track).bind(artist).execute(&db).await?;
        sqlx::query("DELETE FROM enrichment_jobs WHERE track_id=$1").bind(track).execute(&db).await?;
        assert_eq!(seed(&db, "cover").await?, 1);
        assert_eq!(seed(&db, "cover").await?, 0);
        let job = claim(&db, "cover").await?.unwrap();
        finish(&db, "cover", &job, "failed", Some("timeout".into())).await?;
        assert!(claim(&db, "cover").await?.is_none());
        let revision: i64 = sqlx::query_scalar("SELECT last_value FROM catalog_revision").fetch_one(&db).await?;
        sqlx::query("UPDATE tracks SET genre_id=NULL WHERE id=$1").bind(track).execute(&db).await?;
        let changed: i64 = sqlx::query_scalar("SELECT last_value FROM catalog_revision").fetch_one(&db).await?;
        assert!(changed > revision);
        Ok(())
    }
}
