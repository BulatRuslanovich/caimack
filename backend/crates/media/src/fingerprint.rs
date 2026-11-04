// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use rusty_chromaprint::{Configuration, Fingerprinter};

use crate::cues;

pub const SAMPLE_RATE: u32 = cues::SAMPLE_RATE;

pub const SECONDS: u32 = 120;

const MINIMUM_ITEMS: usize = 16;

pub struct FingerprintBuilder {
    fingerprinter: Fingerprinter,
    remaining: usize,
    samples: Vec<i16>,
    ready: bool,
}

impl Default for FingerprintBuilder {
    fn default() -> Self {
        let mut fingerprinter = Fingerprinter::new(&Configuration::preset_test2());
        let ready = fingerprinter.start(SAMPLE_RATE, 1).is_ok();
        Self { fingerprinter, remaining: (SECONDS * SAMPLE_RATE) as usize, samples: Vec::new(), ready }
    }
}

impl FingerprintBuilder {
    pub fn feed(&mut self, mono: &[f32]) {
        if !self.ready || self.remaining == 0 {
            return;
        }
        let take = mono.len().min(self.remaining);
        self.remaining -= take;
        self.samples.clear();
        self.samples.extend(mono[..take].iter().map(|&sample| (sample.clamp(-1.0, 1.0) * f32::from(i16::MAX)) as i16));
        self.fingerprinter.consume(&self.samples);
    }

    pub fn complete(mut self) -> Option<Vec<u32>> {
        if !self.ready {
            return None;
        }
        self.fingerprinter.finish();
        let fingerprint = self.fingerprinter.fingerprint();
        (fingerprint.len() >= MINIMUM_ITEMS).then(|| fingerprint.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chirps(seconds: u32) -> Vec<f32> {
        let rate = SAMPLE_RATE as f32;
        (0..seconds * SAMPLE_RATE)
            .map(|i| {
                let t = i as f32 / rate;
                let note = 220.0 * 2f32.powf((t * 2.0).floor() % 12.0 / 12.0);
                0.3 * (std::f32::consts::TAU * note * t).sin()
            })
            .collect()
    }

    fn fingerprint(samples: &[f32]) -> Option<Vec<u32>> {
        let mut builder = FingerprintBuilder::default();
        for chunk in samples.chunks(4000) {
            builder.feed(chunk);
        }
        builder.complete()
    }

    #[test]
    fn same_audio_gives_the_same_fingerprint() {
        let audio = chirps(20);
        let first = fingerprint(&audio);
        assert!(first.is_some());
        assert_eq!(first, fingerprint(&audio));
    }

    #[test]
    fn only_the_first_two_minutes_count() {
        let long = fingerprint(&chirps(SECONDS + 30)).map(|f| f.len());
        let exact = fingerprint(&chirps(SECONDS)).map(|f| f.len());
        assert_eq!(long, exact);
    }

    #[test]
    fn a_blip_is_too_short_to_fingerprint() {
        assert_eq!(fingerprint(&chirps(1)), None);
    }
}
