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
    let count = snapshot.len();
    let tracks: Vec<Uuid> = snapshot.metas().iter().map(|meta| meta.track_id).collect();
    if count == 0 {
        return MapLayout::default();
    }
    let known: HashMap<_, _> = previous
        .into_iter()
        .flat_map(|p| p.tracks.iter().zip(p.x.iter().zip(&p.y)))
        .map(|(&id, (&x, &y))| (id, (x, y)))
        .collect();
    let anchors: Vec<_> = tracks.iter().map(|id| known.get(id).copied()).collect();
    let reused = anchors.iter().filter(|point| point.is_some()).count();
    if reused == count {
        let (x, y) = anchors.into_iter().flatten().unzip();
        return MapLayout { tracks, x, y };
    }
    if count < 4 {
        #[expect(clippy::cast_precision_loss, reason = "fewer than four tracks")]
        let x = (0..count).map(|row| (row + 1) as f32 / (count + 1) as f32).collect();
        return MapLayout { tracks, x, y: vec![0.5; count] };
    }

    let neighbours = nearest_neighbours(snapshot, NEIGHBOURS.min(count - 1));
    let edges = fuzzy_graph(&neighbours);

    // Large changes start from the same PCA initialization as a fresh build.
    let incremental = reused * 5 >= count * 4;
    let (mut x, mut y) =
        if incremental { from_previous(&anchors, &neighbours) } else { principal_components(snapshot) };
    let fixed: Vec<_> = anchors.iter().map(|point| incremental && point.is_some()).collect();
    let epochs = if incremental {
        80
    } else if count <= 10_000 {
        400
    } else {
        200
    };
    optimize(&mut x, &mut y, &edges, &fixed, epochs, if incremental { 0.3 } else { 1.0 });
    if incremental {
        for (row, anchor) in anchors.into_iter().enumerate() {
            // Never normalize the whole map again: that would move every saved point.
            let point = anchor.unwrap_or_else(|| {
                (
                    (x[row] / (2.0 * INITIAL_SPREAD) + 0.5).clamp(0.0, 1.0),
                    (y[row] / (2.0 * INITIAL_SPREAD) + 0.5).clamp(0.0, 1.0),
                )
            });
            (x[row], y[row]) = point;
        }
    } else {
        normalize(&mut x, &mut y);
    }
    MapLayout { tracks, x, y }
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

fn principal_components(snapshot: &Snapshot) -> (Vec<f32>, Vec<f32>) {
    let (count, dimension) = (snapshot.len(), snapshot.dimension());
    let mut mean = vec![0.0; dimension];
    for row in 0..count {
        vector::add_scaled(&mut mean, snapshot.vector(row), 1.0);
    }
    #[expect(clippy::cast_precision_loss, reason = "library sizes are far below 2^24")]
    mean.iter_mut().for_each(|value| *value /= count as f32);

    let first = power_iteration(snapshot, &mean, None);
    let second = power_iteration(snapshot, &mean, Some(&first));

    let mut centred = vec![0.0; dimension];
    let (mut x, mut y) = (Vec::with_capacity(count), Vec::with_capacity(count));
    for row in 0..count {
        centre(snapshot.vector(row), &mean, &mut centred);
        x.push(dot(&centred, &first));
        y.push(dot(&centred, &second));
    }
    rescale(&mut x, &mut y, INITIAL_SPREAD);
    (x, y)
}

fn centre(source: &[f32], mean: &[f32], target: &mut [f32]) {
    target.iter_mut().zip(source.iter().zip(mean)).for_each(|(t, (s, m))| *t = s - m);
}

fn power_iteration(snapshot: &Snapshot, mean: &[f32], exclude: Option<&[f32]>) -> Vec<f32> {
    let dimension = snapshot.dimension();
    let shift = if exclude.is_some() { 78.233 } else { 0.0 };
    #[expect(clippy::cast_precision_loss, reason = "dimensions are small")]
    let mut vector: Vec<f32> = (0..dimension).map(|i| (i as f32 * 12.9898 + shift).sin()).collect();
    vector::normalize(&mut vector);

    let mut centred = vec![0.0; dimension];
    for _ in 0..40 {
        let mut next = vec![0.0; dimension];
        for row in 0..snapshot.len() {
            centre(snapshot.vector(row), mean, &mut centred);
            vector::add_scaled(&mut next, &centred, dot(&centred, &vector));
        }
        if let Some(exclude) = exclude {
            let projection = dot(&next, exclude);
            vector::add_scaled(&mut next, exclude, -projection);
        }
        if vector::norm(&next) < 1e-12 {
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

fn from_previous(anchors: &[Option<(f32, f32)>], neighbours: &[Neighbourhood]) -> (Vec<f32>, Vec<f32>) {
    let count = anchors.len();
    let (mut x, mut y) = (vec![0.0; count], vec![0.0; count]);

    for (row, anchor) in anchors.iter().enumerate() {
        if let Some((px, py)) = anchor {
            x[row] = (px - 0.5) * 2.0 * INITIAL_SPREAD;
            y[row] = (py - 0.5) * 2.0 * INITIAL_SPREAD;
        }
    }

    let mut rng = Rng::new(SEED);
    let jitter = INITIAL_SPREAD * 0.02;
    for row in 0..count {
        if anchors[row].is_some() {
            continue;
        }
        let around: Vec<usize> =
            neighbours[row].iter().map(|&(other, _)| other).filter(|&other| anchors[other].is_some()).collect();
        #[expect(clippy::cast_precision_loss, reason = "k is small")]
        let (cx, cy) = if around.is_empty() {
            (0.0, 0.0)
        } else {
            let n = around.len() as f32;
            (around.iter().map(|&o| x[o]).sum::<f32>() / n, around.iter().map(|&o| y[o]).sum::<f32>() / n)
        };
        #[expect(clippy::cast_possible_truncation, reason = "jitter is a small fraction")]
        {
            x[row] = cx + (rng.next_f64() - 0.5) as f32 * jitter;
            y[row] = cy + (rng.next_f64() - 0.5) as f32 * jitter;
        }
    }
    (x, y)
}

fn optimize(
    x: &mut [f32],
    y: &mut [f32],
    edges: &[(usize, usize, f32)],
    fixed: &[bool],
    epochs: usize,
    learning_rate: f32,
) {
    if edges.is_empty() {
        return;
    }
    let count = x.len();
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

            let (dx, dy) = (x[from] - x[to], y[from] - y[to]);
            let squared = dx * dx + dy * dy;
            if squared > 0.0 {
                let power = squared.powf(CURVE_B);
                let attract = -2.0 * CURVE_A * CURVE_B * power / squared / (CURVE_A * power + 1.0);
                let (gx, gy) = (clip(attract * dx) * alpha, clip(attract * dy) * alpha);
                if !fixed[from] {
                    x[from] += gx;
                    y[from] += gy;
                }
                if !fixed[to] {
                    x[to] -= gx;
                    y[to] -= gy;
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
                let (dx, dy) = (x[from] - x[other], y[from] - y[other]);
                let squared = dx * dx + dy * dy;
                if squared > 0.0 {
                    let repel = 2.0 * CURVE_B / ((0.001 + squared) * (CURVE_A * squared.powf(CURVE_B) + 1.0));
                    x[from] += clip(repel * dx) * alpha;
                    y[from] += clip(repel * dy) * alpha;
                } else {
                    x[from] += GRADIENT_CLIP * alpha * 0.01;
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

fn rescale(x: &mut [f32], y: &mut [f32], spread: f32) {
    let reach = x.iter().chain(y.iter()).fold(0.0_f32, |reach, value| reach.max(value.abs()));
    if reach >= 1e-9 {
        x.iter_mut().chain(y.iter_mut()).for_each(|value| *value *= spread / reach);
    }
}

fn normalize(x: &mut [f32], y: &mut [f32]) {
    const MARGIN: f32 = 0.04;
    let ((min_x, max_x), (min_y, max_y)) = (bounds(x), bounds(y));
    let span = (max_x - min_x).max(max_y - min_y).max(1e-6);
    let scale = (1.0 - 2.0 * MARGIN) / span;
    let offset_x = MARGIN + ((1.0 - 2.0 * MARGIN) - (max_x - min_x) * scale) / 2.0;
    let offset_y = MARGIN + ((1.0 - 2.0 * MARGIN) - (max_y - min_y) * scale) / 2.0;
    x.iter_mut().for_each(|value| *value = (offset_x + (*value - min_x) * scale).clamp(0.0, 1.0));
    y.iter_mut().for_each(|value| *value = (offset_y + (*value - min_y) * scale).clamp(0.0, 1.0));
}

fn bounds(values: &[f32]) -> (f32, f32) {
    let mut sorted = values.to_vec();
    sorted.sort_by(f32::total_cmp);
    let length = sorted.len();
    (sorted[length * 5 / 1000], sorted[(length * 995 / 1000).min(length - 1)])
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
