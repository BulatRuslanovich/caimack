// SPDX-License-Identifier: AGPL-3.0-only

use super::*;
use reco::snapshot::{Snapshot, TrackMeta};

fn library(count: u32, generation: u64) -> Arc<Library> {
    let rows = (0..count)
        .map(|i| {
            let meta = TrackMeta {
                track_id: Uuid::from_u128(u128::from(i) + 1),
                artists: vec![Uuid::from_u128(100)],
                album_id: None,
                genre_id: None,
                duration_seconds: 180,
                year: None,
                added_at: 0,
                popularity: 0.0,
                content_hash: format!("audio-{i}"),
                song_key: format!("artist|song-{i}"),
                tempo_bpm: None,
                musical_key: None,
                loudness_lufs: None,
            };
            let noise = i as f32 * 0.01;
            let vector = if i % 2 == 0 { vec![1.0, noise, 0.0, 0.0] } else { vec![0.0, 0.0, 1.0, noise] };
            (meta, vector)
        })
        .collect();
    Arc::new(Library { generation, snapshot: Snapshot::new(4, rows) })
}

fn assert_same(first: &MapLayout, second: &MapLayout) {
    assert_eq!(first.tracks, second.tracks);
    assert_eq!(first.x, second.x);
    assert_eq!(first.y, second.y);
    assert_eq!(first.z, second.z);
}

async fn build_2d(db: &PgPool, pool: &ComputePool, library: Arc<Library>) -> AppResult<Arc<MapLayout>> {
    persistence::build(db, pool, library, MapProjection::TwoD).await
}

#[test]
fn two_dimensional_points_omit_depth_from_the_response() -> anyhow::Result<()> {
    let mut point = MapPointDto {
        id: Uuid::nil(),
        x: 0.25,
        y: 0.75,
        z: None,
        title: "Track".to_owned(),
        artist: "Artist".to_owned(),
        album_id: None,
        has_cover: false,
        genre: None,
        plays: 0,
    };
    let flat = serde_json::to_value(&point)?;
    assert!(flat.get("z").is_none());
    point.z = Some(0.5);
    let spatial = serde_json::to_value(&point)?;
    assert_eq!(spatial["z"], 0.5);
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn the_3d_cache_keeps_unchanged_anchors_and_is_separate_from_2d(db: PgPool) -> AppResult<()> {
    let pool = ComputePool::default();
    let original = library(40, 1);
    let flat = build_2d(&db, &pool, Arc::clone(&original)).await?;
    let first = persistence::build(&db, &pool, Arc::clone(&original), MapProjection::ThreeD).await?;
    assert!(flat.z.is_empty());
    assert_eq!(first.z.len(), 40);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM library_map_cache").fetch_one(&db).await?;
    assert_eq!(count, 2);

    let rows = (0..40)
        .map(|row| {
            let noise = row as f32 * 0.01;
            let vector = if row == 0 {
                vec![0.0, 0.0, 1.0, 0.1]
            } else if row % 2 == 0 {
                vec![1.0, noise, 0.0, 0.0]
            } else {
                vec![0.0, 0.0, 1.0, noise]
            };
            (original.snapshot.meta(row).clone(), vector)
        })
        .collect();
    let changed = Arc::new(Library { generation: 2, snapshot: Snapshot::new(4, rows) });
    let updated = MapCache::new(MapProjection::ThreeD).layout(&db, &pool, &changed).await?.0;
    assert_eq!(&updated.x[1..], &first.x[1..]);
    assert_eq!(&updated.y[1..], &first.y[1..]);
    assert_eq!(&updated.z[1..], &first.z[1..]);
    assert_ne!([updated.x[0], updated.y[0], updated.z[0]], [first.x[0], first.y[0], first.z[0]]);
    let restored = MapCache::new(MapProjection::ThreeD).layout(&db, &pool, &changed).await?.0;
    assert_same(&updated, &restored);
    let flat_again = build_2d(&db, &pool, original).await?;
    assert_same(&flat, &flat_again);
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn a_new_cache_restores_saved_coordinates_without_rewriting_them(db: PgPool) -> AppResult<()> {
    let pool = ComputePool::default();
    let library = library(40, 1);
    MapCache::default().layout(&db, &pool, &library).await?;
    // Make saved coordinates differ from a fresh deterministic projection.
    sqlx::query("UPDATE library_map_cache SET payload = jsonb_set(payload, '{layout,x,0}', '0.1234')")
        .execute(&db)
        .await?;
    let saved: serde_json::Value = sqlx::query_scalar("SELECT payload FROM library_map_cache").fetch_one(&db).await?;
    let restored = MapCache::default().layout(&db, &pool, &library).await?.0;
    assert_eq!(restored.x[0], 0.1234);
    let after: serde_json::Value = sqlx::query_scalar("SELECT payload FROM library_map_cache").fetch_one(&db).await?;
    assert_eq!(saved, after);
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn metadata_changes_do_not_rebuild_the_map(db: PgPool) -> AppResult<()> {
    let pool = ComputePool::default();
    let before = library(40, 1);
    let first = build_2d(&db, &pool, Arc::clone(&before)).await?;
    let written: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT updated_at FROM library_map_cache").fetch_one(&db).await?;
    let rows = (0..before.snapshot.len())
        .map(|row| {
            let mut meta = before.snapshot.meta(row).clone();
            meta.popularity = 100.0;
            meta.genre_id = Some(Uuid::from_u128(200));
            // Reproduce index loading from the same original vectors, without normalizing twice.
            let i = row as f32 * 0.01;
            let vector = if row % 2 == 0 { vec![1.0, i, 0.0, 0.0] } else { vec![0.0, 0.0, 1.0, i] };
            (meta, vector)
        })
        .collect();
    let changed = Arc::new(Library { generation: 2, snapshot: Snapshot::new(4, rows) });
    let again = build_2d(&db, &pool, changed).await?;
    assert_same(&first, &again);
    let after: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT updated_at FROM library_map_cache").fetch_one(&db).await?;
    assert_eq!(written, after, "metadata must not cause a cache write or optimization");
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn adding_tracks_keeps_saved_anchors_after_a_restart(db: PgPool) -> AppResult<()> {
    let pool = ComputePool::default();
    let first = build_2d(&db, &pool, library(36, 1)).await?;
    let updated = build_2d(&db, &pool, library(40, 2)).await?;
    assert_eq!(&updated.x[..36], first.x);
    assert_eq!(&updated.y[..36], first.y);
    let restored = build_2d(&db, &pool, library(40, 1)).await?;
    assert_same(&updated, &restored);
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn changed_vectors_with_the_same_ids_invalidate_saved_positions(db: PgPool) -> AppResult<()> {
    let pool = ComputePool::default();
    let original = library(40, 1);
    build_2d(&db, &pool, Arc::clone(&original)).await?;
    let rows = (0..original.snapshot.len())
        .map(|row| {
            let vector = vec![1.0, row as f32 * 0.05, (row as f32).sin(), 0.3];
            (original.snapshot.meta(row).clone(), vector)
        })
        .collect();
    let changed = Arc::new(Library { generation: 2, snapshot: Snapshot::new(4, rows) });
    let expected = reco::map::layout(&changed.snapshot, None);
    let updated = build_2d(&db, &pool, changed).await?;
    assert_same(&expected, &updated);
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn changing_one_vector_keeps_all_other_anchors(db: PgPool) -> AppResult<()> {
    let pool = ComputePool::default();
    let original = library(40, 1);
    let first = build_2d(&db, &pool, Arc::clone(&original)).await?;
    let rows = (0..40)
        .map(|row| {
            let noise = row as f32 * 0.01;
            let vector = if row == 0 {
                vec![0.0, 0.0, 1.0, 0.1]
            } else if row % 2 == 0 {
                vec![1.0, noise, 0.0, 0.0]
            } else {
                vec![0.0, 0.0, 1.0, noise]
            };
            (original.snapshot.meta(row).clone(), vector)
        })
        .collect();
    let changed = Arc::new(Library { generation: 2, snapshot: Snapshot::new(4, rows) });
    let updated = build_2d(&db, &pool, changed).await?;
    assert_eq!(&updated.x[1..], &first.x[1..]);
    assert_eq!(&updated.y[1..], &first.y[1..]);
    assert!((updated.x[0] - first.x[0]).abs() + (updated.y[0] - first.y[0]).abs() > 0.01);
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn concurrent_builders_share_one_committed_layout(db: PgPool) -> AppResult<()> {
    let pool = ComputePool::default();
    let (first, second) =
        tokio::try_join!(build_2d(&db, &pool, library(40, 1)), build_2d(&db, &pool, library(40, 1)),)?;
    assert_same(&first, &second);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM library_map_cache").fetch_one(&db).await?;
    assert_eq!(count, 1);
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn a_corrupt_saved_map_is_rebuilt(db: PgPool) -> AppResult<()> {
    let pool = ComputePool::default();
    let first = build_2d(&db, &pool, library(40, 1)).await?;
    sqlx::query("UPDATE library_map_cache SET payload = jsonb_set(payload, '{layout,x}', '[]')").execute(&db).await?;
    let repaired = build_2d(&db, &pool, library(40, 1)).await?;
    assert_same(&first, &repaired);
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn an_uninitialized_index_does_not_erase_the_saved_map(db: PgPool) -> AppResult<()> {
    let pool = ComputePool::default();
    let first = build_2d(&db, &pool, library(40, 1)).await?;
    let cache = MapCache::default();
    let (empty, updating) = cache.layout(&db, &pool, &Arc::new(Library::default())).await?;
    assert!(empty.is_empty());
    assert!(updating);
    let restored = cache.layout(&db, &pool, &library(40, 1)).await?.0;
    assert_same(&first, &restored);
    Ok(())
}

#[sqlx::test(migrations = "../../../db/migrations")]
async fn a_background_rebuild_reports_when_the_new_layout_is_ready(db: PgPool) -> AppResult<()> {
    let pool = ComputePool::default();
    let cache = MapCache::default();
    let first = cache.layout(&db, &pool, &library(36, 1)).await?.0;
    let updated_library = library(40, 2);
    let (stale, updating) = cache.layout(&db, &pool, &updated_library).await?;
    assert!(updating);
    assert_same(&first, &stale);
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            if !cache.0.lock().await.building {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .map_err(crate::AppError::internal)?;
    let (updated, updating) = cache.layout(&db, &pool, &updated_library).await?;
    assert!(!updating);
    assert_eq!(updated.len(), 40);
    assert_eq!(&updated.x[..36], first.x);
    // A request captured before the rebuild must not roll the cache back.
    let (older, _) = cache.layout(&db, &pool, &library(36, 1)).await?;
    assert_same(&updated, &older);
    Ok(())
}
