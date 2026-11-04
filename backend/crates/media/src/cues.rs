// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::sync::Arc;

use realfft::{RealFftPlanner, RealToComplex};

pub const SAMPLE_RATE: u32 = 11_025;

pub const VERSION: i32 = 3;

const FRAME_LENGTH: usize = 1024;
const HOP_LENGTH: usize = 256;
const BINS: usize = FRAME_LENGTH / 2;
pub const HOP_SECONDS: f64 = HOP_LENGTH as f64 / SAMPLE_RATE as f64;
const FRAME_SECONDS: f64 = FRAME_LENGTH as f64 / SAMPLE_RATE as f64;

pub const WAVEFORM_BARS: usize = 240;

const WAVEFORM_CURVE: f64 = 0.7;

const SILENCE_FLOOR_DB: f64 = -60.0;
const SILENCE_BELOW_PEAK_DB: f64 = 45.0;

const OUTRO_DROP_DB: f64 = 10.0;
const LOUDNESS_WINDOW_SECONDS: f64 = 3.0;
const MAXIMUM_OUTRO_SECONDS: f64 = 30.0;

const MINIMUM_BPM: f64 = 60.0;
const MAXIMUM_BPM: f64 = 200.0;
const PREFERRED_BPM: f64 = 120.0;
const PRIOR_OCTAVES: f64 = 1.0;
const TEMPO_HARMONICS: usize = 4;

const MINIMUM_TEMPO_CONFIDENCE: f64 = 2.5;

#[derive(Debug, Clone, PartialEq)]
pub struct TrackCuePoints {
    pub audio_start_seconds: f64,
    pub audio_end_seconds: f64,
    pub outro_start_seconds: f64,
    pub tempo_bpm: Option<f64>,
    pub waveform: Vec<u8>,
}

pub struct CueDetector {
    window: Vec<f64>,
    fft: Arc<dyn RealToComplex<f64>>,
    buffer: Vec<f32>,
    filled: usize,
    input: Vec<f64>,
    spectrum: Vec<realfft::num_complex::Complex<f64>>,
    previous_magnitudes: Vec<f32>,
    has_previous: bool,
    energy: Vec<f64>,
    flux: Vec<f32>,
}

impl Default for CueDetector {
    fn default() -> Self {
        let fft = RealFftPlanner::<f64>::new().plan_fft_forward(FRAME_LENGTH);
        Self {
            window: (0..FRAME_LENGTH)
                .map(|i| 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / FRAME_LENGTH as f64).cos())
                .collect(),
            input: fft.make_input_vec(),
            spectrum: fft.make_output_vec(),
            fft,
            buffer: vec![0.0; FRAME_LENGTH],
            filled: 0,
            previous_magnitudes: vec![0.0; BINS],
            has_previous: false,
            energy: Vec::new(),
            flux: Vec::new(),
        }
    }
}

impl CueDetector {
    pub fn feed(&mut self, samples: &[f32]) {
        for &sample in samples {
            self.buffer[self.filled] = sample;
            self.filled += 1;
            if self.filled < FRAME_LENGTH {
                continue;
            }
            self.process_frame();
            self.buffer.copy_within(HOP_LENGTH.., 0);
            self.filled = FRAME_LENGTH - HOP_LENGTH;
        }
    }

    pub fn complete(mut self) -> Option<TrackCuePoints> {
        if self.filled > FRAME_LENGTH - HOP_LENGTH || self.energy.is_empty() {
            self.buffer[self.filled..].fill(0.0);
            self.process_frame();
        }
        analyze(&self.energy, &self.flux)
    }

    fn process_frame(&mut self) {
        let mut sum_squares = 0.0f64;
        for i in 0..FRAME_LENGTH {
            let sample = f64::from(self.buffer[i]);
            sum_squares += sample * sample;
            self.input[i] = f64::from(self.buffer[i]) * self.window[i];
        }
        self.energy.push(sum_squares / FRAME_LENGTH as f64);

        if self.fft.process(&mut self.input, &mut self.spectrum).is_err() {
            self.flux.push(0.0);
            return;
        }

        let mut flux = 0.0f64;
        for bin in 1..BINS {
            let magnitude = (1.0 + 100.0 * self.spectrum[bin].norm()).ln() as f32;
            if self.has_previous {
                flux += f64::from((magnitude - self.previous_magnitudes[bin]).max(0.0));
            }
            self.previous_magnitudes[bin] = magnitude;
        }
        self.has_previous = true;
        self.flux.push(flux as f32);
    }
}

pub fn analyze(energy: &[f64], flux: &[f32]) -> Option<TrackCuePoints> {
    if energy.is_empty() {
        return None;
    }

    let decibels: Vec<f64> = energy.iter().map(|e| 10.0 * (e + 1e-12).log10()).collect();
    let peak = decibels.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let threshold = SILENCE_FLOOR_DB.max(peak - SILENCE_BELOW_PEAK_DB);

    let first = decibels.iter().position(|&db| db > threshold)?;
    let last = decibels.iter().rposition(|&db| db > threshold)?;

    let audio_start = first as f64 * HOP_SECONDS;
    let audio_end = (last as f64 * HOP_SECONDS + FRAME_SECONDS).min(energy.len() as f64 * HOP_SECONDS + FRAME_SECONDS);

    let outro_start = outro_start(energy, &decibels, first, last, threshold, audio_start, audio_end);
    let tempo = tempo(flux, first, last);

    Some(TrackCuePoints {
        audio_start_seconds: audio_start,
        audio_end_seconds: audio_end,
        outro_start_seconds: outro_start,
        tempo_bpm: tempo,
        waveform: waveform(energy),
    })
}

fn waveform(energy: &[f64]) -> Vec<u8> {
    let count = energy.len();
    let mut bars = [0.0f64; WAVEFORM_BARS];
    for (bar, value) in bars.iter_mut().enumerate() {
        let from = bar * count / WAVEFORM_BARS;
        let to = (from + 1).max((bar + 1) * count / WAVEFORM_BARS);
        for frame_energy in &energy[from..to.min(count)] {
            *value = value.max(frame_energy.sqrt());
        }
    }

    let loudest = bars.iter().copied().fold(0.0, f64::max);
    if loudest <= 0.0 {
        return vec![0; WAVEFORM_BARS];
    }
    bars.iter().map(|bar| (255.0 * (bar / loudest).powf(WAVEFORM_CURVE)).round_ties_even() as u8).collect()
}

fn outro_start(
    energy: &[f64],
    decibels: &[f64],
    first: usize,
    last: usize,
    threshold: f64,
    audio_start: f64,
    audio_end: f64,
) -> f64 {
    let mut loud: Vec<f64> = decibels[first..=last].iter().copied().filter(|&db| db > threshold).collect();
    loud.sort_by(f64::total_cmp);
    let typical = loud[(loud.len() as f64 * 0.75) as usize];

    let mut prefix = vec![0.0f64; energy.len() + 1];
    for (i, e) in energy.iter().enumerate() {
        prefix[i + 1] = prefix[i] + e;
    }

    let half = (LOUDNESS_WINDOW_SECONDS / 2.0 / HOP_SECONDS) as usize;
    let loudness = |frame: usize| {
        let from = frame.saturating_sub(half);
        let to = energy.len().min(frame + half + 1);
        10.0 * ((prefix[to] - prefix[from]) / (to - from) as f64 + 1e-12).log10()
    };

    let mut frame = last;
    while frame > first && loudness(frame) < typical - OUTRO_DROP_DB {
        frame -= 1;
    }

    let outro = audio_end.min((frame + 1) as f64 * HOP_SECONDS);

    let earliest = (audio_start + (audio_end - audio_start) / 2.0).max(audio_end - MAXIMUM_OUTRO_SECONDS);
    outro.max(earliest)
}

fn tempo(flux: &[f32], first: usize, last: usize) -> Option<f64> {
    let length = last - first + 1;
    let max_lag = (60.0 / MINIMUM_BPM / HOP_SECONDS * TEMPO_HARMONICS as f64).ceil() as usize + 2;
    if length < max_lag * 2 {
        return None;
    }

    let smoothing = (1.0 / HOP_SECONDS) as usize;
    let mut envelope = vec![0.0f64; length];
    let mut running = 0.0f64;
    for i in 0..length {
        running += f64::from(flux[first + i]);
        if i >= smoothing {
            running -= f64::from(flux[first + i - smoothing]);
        }
        let local_mean = running / (i + 1).min(smoothing) as f64;
        envelope[i] = (f64::from(flux[first + i]) - local_mean).max(0.0);
    }

    let mut correlation = vec![0.0f64; max_lag + 1];
    for lag in 1..=max_lag {
        let sum: f64 = (0..length - lag).map(|i| envelope[i] * envelope[i + lag]).sum();
        correlation[lag] = sum / (length - lag) as f64;
    }

    let at = |lag: f64| {
        let below = lag.floor() as i64;
        if below < 1 || below + 1 > max_lag as i64 {
            return 0.0;
        }
        let fraction = lag - below as f64;
        let below = below as usize;
        correlation[below] * (1.0 - fraction) + correlation[below + 1] * fraction
    };
    let score = |bpm: f64| {
        let period = 60.0 / bpm / HOP_SECONDS;
        let sum: f64 = (1..=TEMPO_HARMONICS).map(|harmonic| at(period * harmonic as f64)).sum();
        let octaves = (bpm / PREFERRED_BPM).log2() / PRIOR_OCTAVES;
        sum * (-0.5 * octaves * octaves).exp()
    };

    let mut scores = Vec::new();
    let mut best = MINIMUM_BPM;
    let mut best_score = f64::NEG_INFINITY;
    let mut bpm = MINIMUM_BPM;
    while bpm <= MAXIMUM_BPM {
        let value = score(bpm);
        scores.push(value);
        if value > best_score {
            best_score = value;
            best = bpm;
        }
        bpm += 0.5;
    }

    let mean = scores.iter().sum::<f64>() / scores.len() as f64;
    let deviation = (scores.iter().map(|s| (s - mean) * (s - mean)).sum::<f64>() / scores.len() as f64).sqrt();
    if deviation <= 0.0 || (best_score - mean) / deviation < MINIMUM_TEMPO_CONFIDENCE {
        return None;
    }

    let mut bpm = best - 0.5;
    while bpm <= best + 0.5 {
        let value = score(bpm);
        if value > best_score {
            best_score = value;
            best = bpm;
        }
        bpm += 0.05;
    }
    Some((best * 10.0).round_ties_even() / 10.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_has_no_cues() {
        let mut detector = CueDetector::default();
        detector.feed(&vec![0.0; SAMPLE_RATE as usize * 5]);
        assert_eq!(detector.complete(), None);
    }
}
