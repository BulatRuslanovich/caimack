// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::sync::Arc;

use realfft::{RealFftPlanner, RealToComplex};

use crate::cues;

pub const SAMPLE_RATE: u32 = cues::SAMPLE_RATE;

const FRAME_LENGTH: usize = 8192;
const LOWEST_HZ: f64 = 65.4;
const HIGHEST_HZ: f64 = 2093.0;

const QUIET_FRAME_RMS: f64 = 0.003;
const MINIMUM_FRAMES: usize = 8;

const MINIMUM_CONFIDENCE: f64 = 0.5;

const MAJOR_PROFILE: [f64; 12] = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE: [f64; 12] = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const TONICS: [&str; 12] = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MusicalKey {
    pub index: u8,
    pub confidence: f32,
}

impl MusicalKey {
    pub fn from_index(index: i16) -> Option<Self> {
        u8::try_from(index).ok().filter(|index| *index < 24).map(|index| Self { index, confidence: 1.0 })
    }

    pub fn tonic(self) -> &'static str {
        TONICS[usize::from(self.index % 12)]
    }

    pub fn is_minor(self) -> bool {
        self.index >= 12
    }

    pub fn camelot_number(self) -> u8 {
        let relative_major = if self.is_minor() { (self.index + 3) % 12 } else { self.index };
        let fifths = relative_major * 7 % 12;
        (fifths + 7) % 12 + 1
    }

    pub fn camelot(self) -> String {
        format!("{}{}", self.camelot_number(), if self.is_minor() { 'A' } else { 'B' })
    }

    pub fn from_camelot(code: &str) -> Option<Self> {
        let code = code.trim();
        let letter = code.chars().last()?;
        let number: u8 = code[..code.len() - letter.len_utf8()].parse().ok().filter(|n| (1..=12).contains(n))?;
        let minor = match letter.to_ascii_uppercase() {
            'A' => true,
            'B' => false,
            _ => return None,
        };
        (0..24)
            .map(|index| Self { index, confidence: 1.0 })
            .find(|key| key.is_minor() == minor && key.camelot_number() == number)
    }
}

pub struct KeyDetector {
    fft: Arc<dyn RealToComplex<f64>>,
    window: Vec<f64>,
    pitch_class: Vec<Option<usize>>,
    buffer: Vec<f32>,
    input: Vec<f64>,
    spectrum: Vec<realfft::num_complex::Complex<f64>>,
    chroma: [f64; 12],
    frames: usize,
}

impl Default for KeyDetector {
    fn default() -> Self {
        let fft = RealFftPlanner::<f64>::new().plan_fft_forward(FRAME_LENGTH);
        let window = (0..FRAME_LENGTH)
            .map(|i| 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / FRAME_LENGTH as f64).cos())
            .collect();
        let pitch_class = (0..=FRAME_LENGTH / 2)
            .map(|bin| {
                let hz = bin as f64 * f64::from(SAMPLE_RATE) / FRAME_LENGTH as f64;
                (LOWEST_HZ..=HIGHEST_HZ).contains(&hz).then(|| {
                    let midi = (69.0 + 12.0 * (hz / 440.0).log2()).round() as i64;
                    midi.rem_euclid(12) as usize
                })
            })
            .collect();
        Self {
            input: fft.make_input_vec(),
            spectrum: fft.make_output_vec(),
            fft,
            window,
            pitch_class,
            buffer: Vec::with_capacity(FRAME_LENGTH),
            chroma: [0.0; 12],
            frames: 0,
        }
    }
}

impl KeyDetector {
    pub fn feed(&mut self, samples: &[f32]) {
        let mut rest = samples;
        while !rest.is_empty() {
            let take = (FRAME_LENGTH - self.buffer.len()).min(rest.len());
            self.buffer.extend_from_slice(&rest[..take]);
            rest = &rest[take..];
            if self.buffer.len() == FRAME_LENGTH {
                self.frame();
                self.buffer.clear();
            }
        }
    }

    pub fn complete(self) -> Option<MusicalKey> {
        if self.frames < MINIMUM_FRAMES {
            return None;
        }
        let (index, confidence) = (0..24u8)
            .map(|index| {
                let profile = if index >= 12 { &MINOR_PROFILE } else { &MAJOR_PROFILE };
                let tonic = usize::from(index % 12);
                let rotated: [f64; 12] = std::array::from_fn(|pc| profile[(pc + 12 - tonic) % 12]);
                (index, correlation(&self.chroma, &rotated))
            })
            .max_by(|a, b| a.1.total_cmp(&b.1))?;
        (confidence >= MINIMUM_CONFIDENCE).then_some(MusicalKey { index, confidence: confidence as f32 })
    }

    fn frame(&mut self) {
        let energy: f64 = self.buffer.iter().map(|&s| f64::from(s) * f64::from(s)).sum();
        if (energy / FRAME_LENGTH as f64).sqrt() < QUIET_FRAME_RMS {
            return;
        }
        for ((input, &sample), &weight) in self.input.iter_mut().zip(&self.buffer).zip(&self.window) {
            *input = f64::from(sample) * weight;
        }
        if self.fft.process(&mut self.input, &mut self.spectrum).is_err() {
            return;
        }

        let mut chroma = [0.0f64; 12];
        for (value, pitch_class) in self.spectrum.iter().zip(&self.pitch_class) {
            if let Some(pc) = pitch_class {
                chroma[*pc] += value.norm();
            }
        }
        let loudest = chroma.iter().copied().fold(0.0, f64::max);
        if loudest <= f64::EPSILON {
            return;
        }
        for (total, value) in self.chroma.iter_mut().zip(chroma) {
            *total += value / loudest;
        }
        self.frames += 1;
    }
}

fn correlation(a: &[f64; 12], b: &[f64; 12]) -> f64 {
    let mean_a = a.iter().sum::<f64>() / 12.0;
    let mean_b = b.iter().sum::<f64>() / 12.0;
    let (mut covariance, mut variance_a, mut variance_b) = (0.0, 0.0, 0.0);
    for (x, y) in a.iter().zip(b) {
        covariance += (x - mean_a) * (y - mean_b);
        variance_a += (x - mean_a).powi(2);
        variance_b += (y - mean_b).powi(2);
    }
    let scale = (variance_a * variance_b).sqrt();
    if scale <= f64::EPSILON { 0.0 } else { covariance / scale }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hz(midi: i32) -> f64 {
        440.0 * 2f64.powf(f64::from(midi - 69) / 12.0)
    }

    fn progression(chords: &[&[i32]]) -> Vec<f32> {
        let rate = f64::from(SAMPLE_RATE);
        let per_chord = (2.0 * rate) as usize;
        let mut samples = Vec::new();
        for chord in chords {
            for i in 0..per_chord {
                let t = i as f64 / rate;
                let value: f64 = chord
                    .iter()
                    .flat_map(|&note| (1..=3).map(move |harmonic| (note, harmonic)))
                    .map(|(note, harmonic)| {
                        (std::f64::consts::TAU * hz(note) * f64::from(harmonic) * t).sin() / f64::from(harmonic)
                    })
                    .sum();
                samples.push((value * 0.1) as f32);
            }
        }
        samples
    }

    fn detect(samples: &[f32]) -> Option<MusicalKey> {
        let mut detector = KeyDetector::default();
        for chunk in samples.chunks(1000) {
            detector.feed(chunk);
        }
        detector.complete()
    }

    #[test]
    fn major_cadence_is_c_major() {
        let (c, f, g) = (&[48, 52, 55, 60][..], &[53, 57, 60, 65][..], &[55, 59, 62, 67][..]);
        let key = detect(&progression(&[c, f, g, c, f, g, c]));
        assert_eq!(key.map(|k| (k.tonic(), k.is_minor())), Some(("C", false)));
    }

    #[test]
    fn harmonic_minor_cadence_is_a_minor() {
        let (am, dm, e) = (&[45, 57, 60, 64][..], &[50, 57, 62, 65][..], &[52, 56, 59, 64][..]);
        let key = detect(&progression(&[am, dm, e, am, dm, e, am]));
        assert_eq!(key.map(|k| (k.tonic(), k.is_minor())), Some(("A", true)));
    }

    #[test]
    fn silence_and_noise_have_no_key() {
        assert_eq!(detect(&vec![0.0; SAMPLE_RATE as usize * 10]), None);

        let mut state = 0x2545_f491_u32;
        let noise: Vec<f32> = (0..SAMPLE_RATE * 10)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                (state as f32 / u32::MAX as f32 - 0.5) * 0.5
            })
            .collect();
        assert_eq!(detect(&noise), None);
    }

    #[test]
    fn camelot_wheel_matches_the_chart() {
        let named = |index: i16| MusicalKey::from_index(index).map(|key| (key.tonic(), key.camelot()));
        assert_eq!(named(0), Some(("C", "8B".to_owned())));
        assert_eq!(named(7), Some(("G", "9B".to_owned())));
        assert_eq!(named(5), Some(("F", "7B".to_owned())));
        assert_eq!(named(12 + 9), Some(("A", "8A".to_owned())));
        assert_eq!(named(12 + 4), Some(("E", "9A".to_owned())));
        assert_eq!(named(12 + 8), Some(("Ab", "1A".to_owned())));
        assert_eq!(named(24), None);
    }

    #[test]
    fn camelot_codes_round_trip() {
        for index in 0..24 {
            let key = MusicalKey::from_index(index).map(MusicalKey::camelot);
            let back = key.as_deref().and_then(MusicalKey::from_camelot).map(|k| i16::from(k.index));
            assert_eq!(back, Some(index));
        }
        assert_eq!(MusicalKey::from_camelot("13A"), None);
        assert_eq!(MusicalKey::from_camelot("8C"), None);
        assert_eq!(MusicalKey::from_camelot("8А"), None);
        assert_eq!(MusicalKey::from_camelot(""), None);
    }
}
