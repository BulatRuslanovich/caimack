// SPDX-License-Identifier: AGPL-3.0-only

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use reco::map::{self, MapLayout};
use reco::snapshot::Snapshot;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, types::Json};

use super::super::{compute::ComputePool, index::Library};
use super::MapProjection;
use crate::{AppResult, text::hex_lower};

// Bump the corresponding version when projection semantics or the saved representation change.
const LAYOUT_VERSION_2D: u32 = 1;
const LAYOUT_VERSION_3D: u32 = 1;

#[derive(Serialize, Deserialize)]
struct SavedMap {
    layout: MapLayout,
    vectors: Vec<String>,
}

impl SavedMap {
    fn valid(&self, projection: MapProjection) -> bool {
        let count = self.layout.len();
        let expected_depths = match projection {
            MapProjection::TwoD => 0,
            MapProjection::ThreeD => count,
        };
        count == self.layout.x.len()
            && count == self.layout.y.len()
            && expected_depths == self.layout.z.len()
            && count == self.vectors.len()
            && self.layout.tracks.iter().collect::<HashSet<_>>().len() == count
            && [&self.layout.x, &self.layout.y, &self.layout.z]
                .into_iter()
                .flatten()
                .all(|v| v.is_finite() && (0.0..=1.0).contains(v))
    }

    fn anchors(&self, snapshot: &Snapshot, vectors: &[String]) -> MapLayout {
        let current: HashMap<_, _> = snapshot.metas().iter().zip(vectors).map(|(m, v)| (m.track_id, v)).collect();
        let mut anchors = MapLayout::default();
        for (row, id) in self.layout.tracks.iter().enumerate() {
            if current.get(id).is_some_and(|&hash| hash == &self.vectors[row]) {
                anchors.tracks.push(*id);
                anchors.x.push(self.layout.x[row]);
                anchors.y.push(self.layout.y[row]);
                if let Some(&z) = self.layout.z.get(row) {
                    anchors.z.push(z);
                }
            }
        }
        anchors
    }
}

fn fingerprints(snapshot: &Snapshot) -> Vec<String> {
    (0..snapshot.len())
        .map(|row| {
            let mut hash = Sha256::new();
            for value in snapshot.vector(row) {
                hash.update(value.to_le_bytes());
            }
            hex_lower(&hash.finalize())
        })
        .collect()
}

pub(super) async fn build(
    db: &PgPool,
    pool: &ComputePool,
    library: Arc<Library>,
    projection: MapProjection,
) -> AppResult<Arc<MapLayout>> {
    let started = std::time::Instant::now();
    let (library, vectors) = pool
        .run(move || {
            let vectors = fingerprints(&library.snapshot);
            (library, vectors)
        })
        .await?;
    let version = match projection {
        MapProjection::TwoD => LAYOUT_VERSION_2D.to_string(),
        MapProjection::ThreeD => format!("3d:{LAYOUT_VERSION_3D}"),
    };
    let key = format!("{version}:{}:{}", media::mert::MODEL_ID, media::mert::windows::STRATEGY);
    let mut tx = db.begin().await?;
    // Coordinate concurrent builders, including when the cache row does not exist yet.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 13))").bind(&key).execute(&mut *tx).await?;
    let saved: Option<Json<serde_json::Value>> =
        sqlx::query_scalar("SELECT payload FROM library_map_cache WHERE cache_key = $1")
            .bind(&key)
            .fetch_optional(&mut *tx)
            .await?;
    let saved = saved.and_then(|Json(value)| match serde_json::from_value::<SavedMap>(value) {
        Ok(saved) if saved.valid(projection) => Some(saved),
        _ => {
            tracing::warn!("Ignoring invalid persisted music map; rebuilding layout");
            None
        }
    });
    let (saved, changed) = pool
        .run(move || {
            let project = match projection {
                MapProjection::TwoD => map::layout,
                MapProjection::ThreeD => map::layout_3d,
            };
            if let Some(saved) = saved {
                if saved.vectors == vectors
                    && saved.layout.tracks.iter().copied().eq(library.snapshot.metas().iter().map(|m| m.track_id))
                {
                    return (saved, false);
                }
                let anchors = saved.anchors(&library.snapshot, &vectors);
                let layout = project(&library.snapshot, Some(&anchors));
                (SavedMap { layout, vectors }, true)
            } else {
                let layout = project(&library.snapshot, None);
                (SavedMap { layout, vectors }, true)
            }
        })
        .await?;
    if changed {
        sqlx::query(
            "INSERT INTO library_map_cache (cache_key, payload) VALUES ($1, $2)
             ON CONFLICT (cache_key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()",
        )
        .bind(&key)
        .bind(Json(&saved))
        .execute(&mut *tx)
        .await?;
        tracing::info!(
            ?projection,
            tracks = saved.layout.len(),
            elapsed_ms = started.elapsed().as_millis() as u64,
            "Music map layout built and saved"
        );
    }
    tx.commit().await?;
    Ok(Arc::new(saved.layout))
}
