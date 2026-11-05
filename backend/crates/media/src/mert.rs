// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

pub const MODEL_ID: &str = "m-a-p/MERT-v1-330M";
pub const REVISION: &str = "5240c2708a5acaee1007f43fb9735c7dcd0b78c9";
pub const DIMENSION: usize = 1024;
pub const SAMPLE_RATE: u32 = 24_000;
pub const WINDOW_SAMPLES: usize = SAMPLE_RATE as usize * 5;

pub mod windows {
    // Final hidden layer, temporal mean, normalize each fragment, mean and normalize.
    // Change this identifier whenever preprocessing, weights or pooling changes.
    pub const STRATEGY: &str = "mert_5240c270_5s_final_mean_v1";
    const _: () = assert!(STRATEGY.len() <= 32);
    pub const MAX_WINDOWS: usize = 8;

    pub fn plan(duration: f64) -> Vec<f64> {
        if !duration.is_finite() || duration <= 0.0 {
            return Vec::new();
        }
        if duration <= 5.05 {
            return vec![0.0];
        }
        let count = ((duration / 30.0).round_ties_even() as usize).clamp(3, MAX_WINDOWS);
        let edge = (duration * 0.05).min(15.0);
        let (first, last) =
            if duration - 5.0 - edge > edge { (edge, duration - 5.0 - edge) } else { (0.0, duration - 5.0) };
        let mut offsets: Vec<f64> = Vec::with_capacity(count);
        for index in 0..count {
            let offset = first + (last - first) * index as f64 / (count - 1) as f64;
            if offsets.iter().all(|kept| (offset - kept).abs() >= 0.5) {
                offsets.push(offset);
            }
        }
        offsets
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn windows_stay_inside_track_and_cover_its_body() {
            for duration in [0.1, 4.0, 5.1, 6.0, 30.0, 180.0, 3600.0] {
                let offsets = plan(duration);
                assert!(!offsets.is_empty() && offsets.len() <= MAX_WINDOWS);
                assert!(offsets.iter().all(|&offset| offset >= 0.0 && offset + 5.0 <= duration.max(5.0)));
                assert!(offsets.windows(2).all(|pair| pair[1] - pair[0] >= 0.5));
            }
            assert!(plan(f64::NAN).is_empty());
            assert!(plan(f64::INFINITY).is_empty());
            assert_eq!(plan(180.0).len(), 6);
            assert_eq!(plan(180.0)[0], 9.0);
        }
    }
}
