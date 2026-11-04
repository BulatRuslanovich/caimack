// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use crate::snapshot::TrackMeta;

const TEMPO_TOLERANCE_OCTAVES: f64 = 0.1;
const LOUDNESS_TOLERANCE_LU: f64 = 8.0;
const NEIGHBOUR_KEY: f64 = 0.8;
const NEUTRAL: f64 = 0.5;

pub fn smoothness(from: &TrackMeta, to: &TrackMeta) -> f64 {
    let parts = [tempo(from.tempo_bpm, to.tempo_bpm), key(from.musical_key, to.musical_key), loudness(from, to)];
    let known: Vec<f64> = parts.into_iter().flatten().collect();
    if known.is_empty() { NEUTRAL } else { known.iter().sum::<f64>() / known.len() as f64 }
}

pub fn tempo(from: Option<f32>, to: Option<f32>) -> Option<f64> {
    let (from, to) = (f64::from(from?), f64::from(to?));
    if from <= 0.0 || to <= 0.0 {
        return None;
    }
    let octaves = (to / from).log2();
    let off = (octaves - octaves.round()).abs();
    Some((1.0 - off / TEMPO_TOLERANCE_OCTAVES).clamp(0.0, 1.0))
}

pub fn key(from: Option<u8>, to: Option<u8>) -> Option<f64> {
    let (from, to) = (camelot(from?)?, camelot(to?)?);
    let steps = (i16::from(from.0) - i16::from(to.0)).rem_euclid(12);
    let around = steps.min(12 - steps);
    Some(match (around, from.1 == to.1) {
        (0, true) => 1.0,
        (0, false) | (1, true) => NEIGHBOUR_KEY,
        _ => 0.0,
    })
}

fn loudness(from: &TrackMeta, to: &TrackMeta) -> Option<f64> {
    let difference = f64::from((from.loudness_lufs? - to.loudness_lufs?).abs());
    Some(1.0 - (difference / LOUDNESS_TOLERANCE_LU).min(1.0))
}

fn camelot(index: u8) -> Option<(u8, bool)> {
    if index >= 24 {
        return None;
    }
    let minor = index >= 12;
    let relative_major = if minor { (index + 3) % 12 } else { index };
    Some(((relative_major * 7 % 12 + 7) % 12 + 1, minor))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::tests::meta;

    #[test]
    fn tempo_matches_across_octaves() {
        assert_eq!(tempo(Some(120.0), Some(120.0)), Some(1.0));
        assert!(tempo(Some(86.0), Some(172.0)).is_some_and(|m| m > 0.99));
        assert!(tempo(Some(100.0), Some(150.0)).is_some_and(|m| m == 0.0));
        assert_eq!(tempo(None, Some(120.0)), None);
    }

    #[test]
    fn neighbours_on_the_camelot_wheel_mix_well() {
        let (c_major, a_minor, g_major, f_sharp_major) = (0, 21, 7, 6);
        assert_eq!(key(Some(c_major), Some(c_major)), Some(1.0));
        assert_eq!(key(Some(c_major), Some(a_minor)), Some(NEIGHBOUR_KEY));
        assert_eq!(key(Some(c_major), Some(g_major)), Some(NEIGHBOUR_KEY));
        assert_eq!(key(Some(c_major), Some(f_sharp_major)), Some(0.0));
        assert_eq!(key(Some(0), Some(11)), Some(0.0));
        let (b_major, e_major) = (11, 4);
        assert_eq!(key(Some(b_major), Some(e_major)), Some(NEIGHBOUR_KEY));
    }

    #[test]
    fn unknown_analysis_is_neutral() {
        let (a, b) = (meta(1, 1, "a"), meta(2, 2, "b"));
        assert_eq!(smoothness(&a, &b), NEUTRAL);

        let mut loud = meta(3, 3, "c");
        loud.loudness_lufs = Some(-6.0);
        let mut quiet = meta(4, 4, "d");
        quiet.loudness_lufs = Some(-14.0);
        assert_eq!(smoothness(&loud, &quiet), 0.0);
    }
}
