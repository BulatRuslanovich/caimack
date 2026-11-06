// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

//! Relative evidence within a candidate pool, rather than an assumed cosine range.

/// Returns empirical ranks in [0, 1]. Ties receive their midpoint rank; missing
/// values and pools without enough evidence remain neutral. Tiny floating-point
/// differences must not turn identical sounding vectors into strong preferences.
pub fn relative_scores(values: &[f32]) -> Vec<f32> {
    let mut order: Vec<usize> = (0..values.len()).filter(|&i| values[i].is_finite()).collect();
    order.sort_by(|&a, &b| values[a].total_cmp(&values[b]).then(a.cmp(&b)));
    let mut scores = vec![0.5; values.len()];
    if order.len() < 2 {
        return scores;
    }
    let mut start = 0;
    while start < order.len() {
        let mut end = start + 1;
        while end < order.len() && values[order[end]] - values[order[start]] <= 1e-6 {
            end += 1;
        }
        #[expect(clippy::cast_precision_loss, reason = "candidate pools are far smaller than 2^24")]
        let rank = (start as f32 + (end - 1) as f32) / (2.0 * (order.len() - 1) as f32);
        for &row in &order[start..end] {
            scores[row] = rank;
        }
        start = end;
    }
    scores
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compressed_cosines_keep_the_same_relative_evidence() {
        assert_eq!(relative_scores(&[0.91, 0.92, 0.95]), relative_scores(&[0.1, 0.2, 0.5]));
    }

    #[test]
    fn ties_and_rounding_noise_do_not_manufacture_preferences() {
        assert_eq!(relative_scores(&[0.9, 0.900_000_1, 0.9]), vec![0.5; 3]);
        assert_eq!(relative_scores(&[0.1, 0.5, 0.5, 0.9]), vec![0.0, 0.5, 0.5, 1.0]);
    }

    #[test]
    fn empty_missing_and_singleton_pools_are_neutral() {
        assert!(relative_scores(&[]).is_empty());
        assert_eq!(relative_scores(&[f32::NAN, 0.9, f32::INFINITY]), vec![0.5; 3]);
    }
}
