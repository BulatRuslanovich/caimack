// SPDX-License-Identifier: AGPL-3.0-only

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::random::Rng;
use crate::snapshot::{Snapshot, top_k};
use crate::vector::{self, dot};

const NEIGHBOURS: usize = 15;
const NEGATIVE_SAMPLES: f32 = 5.0;

const CURVE_A: f32 = 1.577;
const CURVE_B: f32 = 0.895;
const GRADIENT_CLIP: f32 = 4.0;
const INITIAL_SPREAD: f32 = 10.0;
const SEED: u64 = 17;

const CLUSTER_RADIUS: f32 = 0.08;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MapLayout {
    pub tracks: Vec<Uuid>,
    pub x: Vec<f32>,
    pub y: Vec<f32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub z: Vec<f32>,
}

impl MapLayout {
    pub fn len(&self) -> usize {
        self.tracks.len()
    }

    pub fn is_empty(&self) -> bool {
        self.tracks.is_empty()
    }
}

/// Previous coordinates must belong to unchanged audio vectors in the same model space.
pub fn layout(snapshot: &Snapshot, previous: Option<&MapLayout>) -> MapLayout {
    project::<2>(snapshot, previous)
}

/// Previous coordinates must belong to unchanged audio vectors in the same 3D model space.
pub fn layout_3d(snapshot: &Snapshot, previous: Option<&MapLayout>) -> MapLayout {
    project::<3>(snapshot, previous)
}

fn project<const D: usize>(snapshot: &Snapshot, previous: Option<&MapLayout>) -> MapLayout {
    let count = snapshot.len();
    let tracks: Vec<Uuid> = snapshot.metas().iter().map(|meta| meta.track_id).collect();
    if count == 0 {
        return MapLayout::default();
    }
    let mut known = HashMap::new();
    if let Some(previous) = previous {
        for (row, (&id, (&x, &y))) in previous.tracks.iter().zip(previous.x.iter().zip(&previous.y)).enumerate() {
            let xyz = [x, y, previous.z.get(row).copied().unwrap_or_default()];
            if D == 2 || row < previous.z.len() {
                known.insert(id, std::array::from_fn(|axis| xyz[axis]));
            }
        }
    }
    let anchors: Vec<_> = tracks.iter().map(|id| known.get(id).copied()).collect();
    let reused = anchors.iter().filter(|point| point.is_some()).count();
    let points: Vec<[f32; D]> = if reused == count {
        anchors.into_iter().flatten().collect()
    } else if D == 2 && count < 4 {
        #[expect(clippy::cast_precision_loss, reason = "fewer than four tracks")]
        (0..count)
            .map(|row| std::array::from_fn(|axis| if axis == 0 { (row + 1) as f32 / (count + 1) as f32 } else { 0.5 }))
            .collect()
    } else if count < 4 {
        let mut points = principal_components(snapshot);
        normalize(&mut points);
        points
    } else {
        let neighbours = nearest_neighbours(snapshot, NEIGHBOURS.min(count - 1));
        let edges = fuzzy_graph(&neighbours);

        // Large changes start from the same PCA initialization as a fresh build.
        let incremental = reused * 5 >= count * 4;
        let mut points =
            if incremental { from_previous(&anchors, &neighbours) } else { principal_components(snapshot) };
        let fixed: Vec<_> = anchors.iter().map(|point| incremental && point.is_some()).collect();
        let epochs = if incremental {
            80
        } else if count <= 10_000 {
            400
        } else {
            200
        };
        optimize(&mut points, &edges, &fixed, epochs, if incremental { 0.3 } else { 1.0 });
        if incremental {
            for (point, anchor) in points.iter_mut().zip(anchors) {
                // Normalizing again would move every saved point.
                *point = anchor.unwrap_or_else(|| point.map(|v| (v / (2.0 * INITIAL_SPREAD) + 0.5).clamp(0.0, 1.0)));
            }
        } else {
            normalize(&mut points);
        }
        points
    };

    MapLayout {
        tracks,
        x: points.iter().map(|point| point[0]).collect(),
        y: points.iter().map(|point| point[1]).collect(),
        z: if D == 3 { points.iter().map(|point| point[2]).collect() } else { Vec::new() },
    }
}

type Neighbourhood = Vec<(usize, f32)>;

fn nearest_neighbours(snapshot: &Snapshot, k: usize) -> Vec<Neighbourhood> {
    let count = snapshot.len();
    let threads = std::thread::available_parallelism().map_or(1, std::num::NonZero::get).min(count);
    let chunk = count.div_ceil(threads.max(1));

    let neighbours_of = |row: usize| -> Neighbourhood {
        let query = snapshot.vector(row);
        let scores: Vec<f32> = (0..count).map(|other| dot(query, snapshot.vector(other))).collect();
        top_k(&scores, k, |other| other == row)
            .into_iter()
            .map(|hit| (hit.row, (2.0 - 2.0 * hit.score).max(0.0).sqrt()))
            .collect()
    };

    let mut result: Vec<Neighbourhood> = Vec::with_capacity(count);
    std::thread::scope(|scope| {
        let handles: Vec<_> = (0..count)
            .step_by(chunk.max(1))
            .map(|start| {
                let neighbours_of = &neighbours_of;
                scope.spawn(move || (start..(start + chunk).min(count)).map(neighbours_of).collect::<Vec<_>>())
            })
            .collect();
        for handle in handles {
            match handle.join() {
                Ok(part) => result.extend(part),
                Err(panic) => std::panic::resume_unwind(panic),
            }
        }
    });
    result
}

fn fuzzy_graph(neighbours: &[Neighbourhood]) -> Vec<(usize, usize, f32)> {
    let mut directed: HashMap<(usize, usize), f32> = HashMap::new();

    for (row, spans) in neighbours.iter().enumerate() {
        let Some(&(_, nearest)) = spans.first() else { continue };
        #[expect(clippy::cast_precision_loss, reason = "k is small")]
        let target = (spans.len() as f32).log2();
        let (mut low, mut high, mut sigma) = (0.0_f32, f32::INFINITY, 1.0_f32);

        for _ in 0..64 {
            let sum: f32 = spans.iter().map(|&(_, span)| (-(span - nearest).max(0.0) / sigma).exp()).sum();
            if (sum - target).abs() < 1e-5 {
                break;
            }
            if sum > target {
                high = sigma;
                sigma = (low + high) / 2.0;
            } else {
                low = sigma;
                sigma = if high.is_infinite() { sigma * 2.0 } else { (low + high) / 2.0 };
            }
        }

        for &(other, span) in spans {
            directed.insert((row, other), (-(span - nearest).max(0.0) / sigma.max(1e-6)).exp());
        }
    }

    let mut edges: Vec<(usize, usize, f32)> = directed
        .iter()
        .filter_map(|(&(from, to), &weight)| {
            let back = directed.get(&(to, from)).copied().unwrap_or(0.0);
            (back <= 0.0 || from < to).then_some((from, to, weight + back - weight * back))
        })
        .collect();

    edges.sort_by_key(|&(from, to, _)| (from, to));
    edges
}

fn principal_components<const D: usize>(snapshot: &Snapshot) -> Vec<[f32; D]> {
    let (count, dimension) = (snapshot.len(), snapshot.dimension());
    let mut mean = vec![0.0; dimension];
    for row in 0..count {
        vector::add_scaled(&mut mean, snapshot.vector(row), 1.0);
    }
    #[expect(clippy::cast_precision_loss, reason = "library sizes are far below 2^24")]
    mean.iter_mut().for_each(|value| *value /= count as f32);

    let mut axes = Vec::with_capacity(D);
    for _ in 0..D {
        axes.push(power_iteration(snapshot, &mean, &axes, D == 3));
    }
    let mut centred = vec![0.0; dimension];
    let mut points: Vec<[f32; D]> = (0..count)
        .map(|row| {
            centre(snapshot.vector(row), &mean, &mut centred);
            std::array::from_fn(|axis| dot(&centred, &axes[axis]))
        })
        .collect();
    let reach = points.iter().flatten().fold(0.0_f32, |reach, value| reach.max(value.abs()));
    if reach >= 1e-9 {
        points.iter_mut().flatten().for_each(|value| *value *= INITIAL_SPREAD / reach);
    }
    points
}

fn centre(source: &[f32], mean: &[f32], target: &mut [f32]) {
    target.iter_mut().zip(source.iter().zip(mean)).for_each(|(t, (s, m))| *t = s - m);
}

fn power_iteration(snapshot: &Snapshot, mean: &[f32], exclude: &[Vec<f32>], orthogonal_seed: bool) -> Vec<f32> {
    let dimension = snapshot.dimension();
    let shift = [0.0, 78.233, 156.466][exclude.len()];
    #[expect(clippy::cast_precision_loss, reason = "dimensions are small")]
    let mut vector: Vec<f32> = (0..dimension).map(|i| (i as f32 * 12.9898 + shift).sin()).collect();
    if orthogonal_seed {
        deflate(&mut vector, exclude);
    }
    vector::normalize(&mut vector);

    let mut centred = vec![0.0; dimension];
    for _ in 0..40 {
        let mut next = vec![0.0; dimension];
        for row in 0..snapshot.len() {
            centre(snapshot.vector(row), mean, &mut centred);
            vector::add_scaled(&mut next, &centred, dot(&centred, &vector));
        }
        deflate(&mut next, exclude);
        if vector::norm(&next) < 1e-12 {
            if orthogonal_seed {
                return vec![0.0; dimension];
            }
            break;
        }
        vector::normalize(&mut next);
        vector = next;
    }

    let strongest = vector.iter().copied().max_by(|a, b| a.abs().total_cmp(&b.abs())).unwrap_or(0.0);
    if strongest < 0.0 {
        vector.iter_mut().for_each(|value| *value = -*value);
    }
    vector
}

fn deflate(candidate: &mut [f32], exclude: &[Vec<f32>]) {
    for axis in exclude {
        let projection = dot(candidate, axis);
        vector::add_scaled(candidate, axis, -projection);
    }
}

fn from_previous<const D: usize>(anchors: &[Option<[f32; D]>], neighbours: &[Neighbourhood]) -> Vec<[f32; D]> {
    let mut points: Vec<_> = anchors
        .iter()
        .map(|anchor| anchor.map_or([0.0; D], |point| point.map(|v| (v - 0.5) * 2.0 * INITIAL_SPREAD)))
        .collect();
    let mut rng = Rng::new(SEED);
    let jitter = INITIAL_SPREAD * 0.02;
    for row in 0..anchors.len() {
        if anchors[row].is_some() {
            continue;
        }
        let around: Vec<_> =
            neighbours[row].iter().map(|&(other, _)| other).filter(|&other| anchors[other].is_some()).collect();
        #[expect(clippy::cast_precision_loss, reason = "k is small")]
        let divisor = around.len().max(1) as f32;
        #[expect(clippy::cast_possible_truncation, reason = "jitter is a small fraction")]
        let position = std::array::from_fn(|axis| {
            let centre = around.iter().map(|&other| points[other][axis]).sum::<f32>() / divisor;
            centre + (rng.next_f64() - 0.5) as f32 * jitter
        });
        points[row] = position;
    }
    points
}

fn delta<const D: usize>(from: [f32; D], to: [f32; D]) -> ([f32; D], f32) {
    let difference: [f32; D] = std::array::from_fn(|axis| from[axis] - to[axis]);
    let squared = difference.iter().map(|d| d * d).sum();
    (difference, squared)
}

fn optimize<const D: usize>(
    points: &mut [[f32; D]],
    edges: &[(usize, usize, f32)],
    fixed: &[bool],
    epochs: usize,
    learning_rate: f32,
) {
    if edges.is_empty() {
        return;
    }
    let count = points.len();
    let mut rng = Rng::new(SEED);
    let heaviest = edges.iter().map(|&(_, _, weight)| weight).fold(0.0_f32, f32::max);

    let every: Vec<f32> = edges.iter().map(|&(_, _, weight)| heaviest / weight.max(1e-6)).collect();
    let mut next_at = every.clone();
    let negative_every: Vec<f32> = every.iter().map(|value| value / NEGATIVE_SAMPLES).collect();
    let mut next_negative_at = negative_every.clone();

    for epoch in 1..=epochs {
        #[expect(clippy::cast_precision_loss, reason = "epochs are few")]
        let (epoch_f, alpha) = (epoch as f32, learning_rate * (1.0 - (epoch - 1) as f32 / epochs as f32));

        for (e, &(from, to, _)) in edges.iter().enumerate() {
            if (fixed[from] && fixed[to]) || next_at[e] > epoch_f {
                continue;
            }

            let (difference, squared) = delta(points[from], points[to]);
            if squared > 0.0 {
                let power = squared.powf(CURVE_B);
                let attract = -2.0 * CURVE_A * CURVE_B * power / squared / (CURVE_A * power + 1.0);
                let gradient = difference.map(|d| clip(attract * d) * alpha);
                if !fixed[from] {
                    for (coordinate, change) in points[from].iter_mut().zip(gradient) {
                        *coordinate += change;
                    }
                }
                if !fixed[to] {
                    for (coordinate, change) in points[to].iter_mut().zip(gradient) {
                        *coordinate -= change;
                    }
                }
            }
            next_at[e] += every[e];

            #[expect(clippy::cast_possible_truncation, clippy::cast_sign_loss, reason = "a small non-negative count")]
            let negatives = ((epoch_f - next_negative_at[e]) / negative_every[e]).max(0.0) as usize;
            let from = if fixed[from] { to } else { from };
            for _ in 0..negatives {
                let other = rng.below(count);
                if other == from {
                    continue;
                }
                let (difference, squared) = delta(points[from], points[other]);
                if squared > 0.0 {
                    let repel = 2.0 * CURVE_B / ((0.001 + squared) * (CURVE_A * squared.powf(CURVE_B) + 1.0));
                    for (coordinate, d) in points[from].iter_mut().zip(difference) {
                        *coordinate += clip(repel * d) * alpha;
                    }
                } else {
                    points[from][0] += GRADIENT_CLIP * alpha * 0.01;
                }
            }
            #[expect(clippy::cast_precision_loss, reason = "a small count")]
            {
                next_negative_at[e] += negatives as f32 * negative_every[e];
            }
        }
    }
}

fn clip(value: f32) -> f32 {
    value.clamp(-GRADIENT_CLIP, GRADIENT_CLIP)
}

fn normalize<const D: usize>(points: &mut [[f32; D]]) {
    const MARGIN: f32 = 0.04;
    let bounds: [(f32, f32); D] = std::array::from_fn(|axis| {
        let mut sorted: Vec<_> = points.iter().map(|point| point[axis]).collect();
        sorted.sort_by(f32::total_cmp);
        let length = sorted.len();
        (sorted[length * 5 / 1000], sorted[(length * 995 / 1000).min(length - 1)])
    });
    let span = bounds.iter().map(|(min, max)| max - min).fold(1e-6_f32, f32::max);
    let scale = (1.0 - 2.0 * MARGIN) / span;
    for (axis, (min, max)) in bounds.into_iter().enumerate() {
        let offset = MARGIN + ((1.0 - 2.0 * MARGIN) - (max - min) * scale) / 2.0;
        for point in &mut *points {
            point[axis] = (offset + (point[axis] - min) * scale).clamp(0.0, 1.0);
        }
    }
}

pub fn densest_spot(spots: &[(f32, f32, f32)]) -> Option<(f32, f32)> {
    let kernel = |a: &(f32, f32, f32), b: &(f32, f32, f32)| {
        let (dx, dy) = (a.0 - b.0, a.1 - b.1);
        (-(dx * dx + dy * dy) / (2.0 * CLUSTER_RADIUS * CLUSTER_RADIUS)).exp()
    };
    let best = spots.iter().max_by(|a, b| {
        let density = |spot| spots.iter().map(|other| other.2 * kernel(spot, other)).sum::<f32>();
        density(a).total_cmp(&density(b))
    })?;

    let (mut x, mut y, mut total) = (0.0, 0.0, 0.0);
    for other in spots {
        let weight = other.2 * kernel(best, other);
        x += other.0 * weight;
        y += other.1 * weight;
        total += weight;
    }
    Some(if total > 0.0 { (x / total, y / total) } else { (best.0, best.1) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::tests::meta;

    fn clusters() -> Snapshot {
        let mut rng = Rng::new(3);
        let mut rows = Vec::new();
        for i in 0..40u32 {
            let base = if i < 20 { [1.0, 0.0, 0.0, 0.0] } else { [0.0, 0.0, 1.0, 0.0] };
            #[expect(clippy::cast_possible_truncation, reason = "small noise")]
            let v: Vec<f32> = base.iter().map(|b| b + (rng.next_f64() as f32 - 0.5) * 0.2).collect();
            rows.push((meta(u128::from(i), 1, &format!("t{i}")), v));
        }
        Snapshot::new(4, rows)
    }

    #[test]
    fn similar_tracks_land_together() {
        let snapshot = clusters();
        let map = layout(&snapshot, None);
        assert_eq!(map.len(), 40);
        assert!(map.x.iter().chain(&map.y).all(|v| (0.0..=1.0).contains(v)));

        let distance = |a: usize, b: usize| ((map.x[a] - map.x[b]).powi(2) + (map.y[a] - map.y[b]).powi(2)).sqrt();
        let mut inside = 0.0;
        let mut across = 0.0;
        for a in 0..20 {
            inside += distance(a, (a + 1) % 20);
            across += distance(a, 20 + a);
        }
        assert!(inside * 2.0 < across, "inside {inside}, across {across}");
    }

    #[test]
    fn audio_clusters_have_depth_and_stay_close_in_3d() {
        let snapshot = clusters();
        let map = layout_3d(&snapshot, None);
        let distance =
            |a: usize, b: usize| delta([map.x[a], map.y[a], map.z[a]], [map.x[b], map.y[b], map.z[b]]).1.sqrt();
        let inside: f32 = (0..20).map(|a| distance(a, (a + 1) % 20)).sum();
        let across: f32 = (0..20).map(|a| distance(a, 20 + a)).sum();
        assert!(inside * 2.0 < across, "inside {inside}, across {across}");
        assert!(map.z.iter().any(|&z| (z - map.z[0]).abs() > 0.05));
        assert!(map.x.iter().chain(&map.y).chain(&map.z).all(|v| (0.0..=1.0).contains(v)));
    }

    #[test]
    fn tiny_3d_maps_have_finite_audio_positions() {
        let snapshot = clusters();
        for count in 0..=3 {
            let rows = (0..count).map(|row| (snapshot.meta(row).clone(), snapshot.vector(row).to_vec())).collect();
            let map = layout_3d(&Snapshot::new(4, rows), None);
            assert_eq!(map.len(), count);
            assert_eq!(map.z.len(), count);
            assert!(map.x.iter().chain(&map.y).chain(&map.z).all(|v| (0.0..=1.0).contains(v)));
            if count == 1 {
                assert_eq!([map.x[0], map.y[0], map.z[0]], [0.5; 3]);
            } else if count > 1 {
                assert!((map.x[0] - map.x[1]).abs() > 0.01);
            }
        }
    }

    #[test]
    fn a_rebuild_keeps_the_previous_map() {
        let snapshot = clusters();
        let first = layout(&snapshot, None);
        let again = layout(&snapshot, Some(&first));
        assert_eq!(first.x, again.x);
        assert_eq!(first.y, again.y);
    }

    #[test]
    fn adding_a_few_tracks_does_not_move_existing_tracks() {
        let snapshot = clusters();
        let mut first = layout(&snapshot, None);
        first.tracks.truncate(36);
        first.x.truncate(36);
        first.y.truncate(36);
        let updated = layout(&snapshot, Some(&first));
        assert_eq!(&updated.x[..36], first.x);
        assert_eq!(&updated.y[..36], first.y);
        assert!(updated.x.iter().chain(&updated.y).all(|v| v.is_finite() && (0.0..=1.0).contains(v)));
    }

    #[test]
    fn removing_tracks_preserves_coordinates_even_for_a_tiny_library() {
        let snapshot = clusters();
        let first = layout(&snapshot, None);
        let remaining = Snapshot::new(4, vec![(snapshot.meta(5).clone(), snapshot.vector(5).to_vec())]);
        let updated = layout(&remaining, Some(&first));
        assert_eq!(updated.x, [first.x[5]]);
        assert_eq!(updated.y, [first.y[5]]);
    }

    #[test]
    fn a_major_change_uses_the_same_layout_as_a_fresh_build() {
        let snapshot = clusters();
        let mut previous = layout(&snapshot, None);
        previous.tracks.truncate(10);
        previous.x.truncate(10);
        previous.y.truncate(10);
        let updated = layout(&snapshot, Some(&previous));
        let fresh = layout(&snapshot, None);
        assert_eq!(updated.x, fresh.x);
        assert_eq!(updated.y, fresh.y);
    }

    #[test]
    fn reordered_tracks_keep_coordinates_by_id() {
        let original = clusters();
        let first = layout(&original, None);
        let rows =
            (0..original.len()).rev().map(|row| (original.meta(row).clone(), original.vector(row).to_vec())).collect();
        let reordered = Snapshot::new(4, rows);
        let updated = layout(&reordered, Some(&first));
        assert!(updated.x.iter().eq(first.x.iter().rev()));
        assert!(updated.y.iter().eq(first.y.iter().rev()));
    }

    #[test]
    fn the_label_goes_to_the_dense_cluster() {
        let spots = [(0.1, 0.1, 1.0), (0.12, 0.1, 1.0), (0.1, 0.12, 1.0), (0.9, 0.9, 1.0)];
        let (x, y) = densest_spot(&spots).unwrap_or_default();
        assert!(x < 0.2 && y < 0.2);
    }
}
