// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

const DEGENERATE_NORM: f32 = 1e-12;

pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

pub fn norm(vector: &[f32]) -> f32 {
    dot(vector, vector).sqrt()
}

pub fn normalize(vector: &mut [f32]) {
    let length = norm(vector);
    if length >= DEGENERATE_NORM {
        vector.iter_mut().for_each(|value| *value /= length);
    }
}

pub fn add_scaled(target: &mut [f32], source: &[f32], scale: f32) {
    target.iter_mut().zip(source).for_each(|(t, s)| *t += s * scale);
}

pub fn percentile_ranks(values: &[f32]) -> Vec<f32> {
    crate::calibration::relative_scores(values)
}

pub fn quantile(values: &[f32], q: f64) -> f32 {
    match values.len() {
        0 => 0.0,
        1 => values[0],
        count => {
            let mut sorted = values.to_vec();
            sorted.sort_by(f32::total_cmp);
            #[expect(clippy::cast_precision_loss, reason = "library sizes are far below 2^52")]
            let position = q.clamp(0.0, 1.0) * (count - 1) as f64;
            #[expect(clippy::cast_possible_truncation, clippy::cast_sign_loss, reason = "position is within 0..count")]
            let (lower, upper) = (position.floor() as usize, position.ceil() as usize);
            #[expect(clippy::cast_possible_truncation, reason = "a fraction in [0, 1)")]
            let fraction = (position - position.floor()) as f32;
            sorted[lower] + (sorted[upper] - sorted[lower]) * fraction
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranks_spread_from_zero_to_one() {
        assert_eq!(percentile_ranks(&[0.3, -1.0, 2.0]), [0.5, 0.0, 1.0]);
        assert_eq!(percentile_ranks(&[5.0]), [0.5]);
    }

    #[test]
    fn tied_evidence_is_neutral_and_does_not_depend_on_catalog_order() {
        assert_eq!(percentile_ranks(&[0.9, 0.9, 0.9]), [0.5, 0.5, 0.5]);
        assert_eq!(percentile_ranks(&[0.1, 0.5, 0.5, 0.9]), [0.0, 0.5, 0.5, 1.0]);
        assert_eq!(percentile_ranks(&[0.5, 0.9, 0.1, 0.5]), [0.5, 1.0, 0.0, 0.5]);
    }

    #[test]
    fn quantile_interpolates() {
        assert!((quantile(&[0.0, 10.0], 0.25) - 2.5).abs() < 1e-6);
        assert!((quantile(&[3.0, 1.0, 2.0], 0.5) - 2.0).abs() < 1e-6);
    }

    #[test]
    fn normalizing_keeps_zero_vectors() {
        let mut zero = [0.0, 0.0];
        normalize(&mut zero);
        assert_eq!(zero, [0.0, 0.0]);
        let mut v = [3.0, 4.0];
        normalize(&mut v);
        assert!((v[0] - 0.6).abs() < 1e-6 && (v[1] - 0.8).abs() < 1e-6);
    }
}
