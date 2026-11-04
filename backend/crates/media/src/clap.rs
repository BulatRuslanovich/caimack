// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::path::Path;
use std::sync::{Arc, Mutex};

use anyhow::{Context, bail};
use ort::session::Session;
use ort::session::builder::GraphOptimizationLevel;
use ort::value::Tensor;
use realfft::{RealFftPlanner, RealToComplex};

pub const MODEL_PATH: &str = "models/clap/audio.onnx";
pub const MEL_FILTERS_PATH: &str = "models/clap/mel_filters_64x513.f32";
pub const MODEL_ID: &str = "laion/larger_clap_music_and_speech";
pub const DIMENSION: usize = 512;

pub const SAMPLE_RATE: u32 = 48_000;
const FRAME_LENGTH: usize = 1024;
const HOP_LENGTH: usize = 480;
pub const MEL_BANDS: usize = 64;
pub const FREQUENCY_BINS: usize = FRAME_LENGTH / 2 + 1;
pub const WINDOW_SAMPLES: usize = SAMPLE_RATE as usize * 10;
pub const FRAMES: usize = WINDOW_SAMPLES / HOP_LENGTH + 1;
const FLOOR: f64 = 1e-10;

const INPUT_NAME: &str = "input_features";

const INFERENCE_BATCH: usize = 4;
const DEGENERATE_NORM: f32 = 1e-12;

pub mod windows {
    pub const WINDOW_SECONDS: f64 = 10.0;

    pub const STRATEGY: &str = "clap_body_v3";

    const MINIMUM_WINDOWS: i64 = 3;
    const MAXIMUM_WINDOWS: i64 = 8;
    const SECONDS_PER_WINDOW: f64 = 30.0;
    const EDGE_SHARE: f64 = 0.05;
    const MAXIMUM_EDGE_SECONDS: f64 = 15.0;
    const MINIMUM_SEPARATION_SECONDS: f64 = 0.5;
    const SHORT_TRACK_SLACK_SECONDS: f64 = 0.05;

    pub fn plan(duration_seconds: f64) -> Vec<f64> {
        if duration_seconds <= 0.0 {
            return Vec::new();
        }
        if duration_seconds <= WINDOW_SECONDS + SHORT_TRACK_SLACK_SECONDS {
            return vec![0.0];
        }

        let count =
            ((duration_seconds / SECONDS_PER_WINDOW).round_ties_even() as i64).clamp(MINIMUM_WINDOWS, MAXIMUM_WINDOWS);
        let edge = (duration_seconds * EDGE_SHARE).min(MAXIMUM_EDGE_SECONDS);
        let (mut first, mut last) = (edge, duration_seconds - WINDOW_SECONDS - edge);

        if last <= first {
            first = 0.0;
            last = duration_seconds - WINDOW_SECONDS;
        }

        let mut offsets: Vec<f64> = Vec::with_capacity(count as usize);
        for index in 0..count {
            let offset = first + (last - first) * index as f64 / (count - 1) as f64;
            if offsets.iter().all(|kept| (offset - kept).abs() >= MINIMUM_SEPARATION_SECONDS) {
                offsets.push(offset);
            }
        }
        offsets
    }
}

pub struct MelSpectrogram {
    window: Vec<f64>,
    fft: Arc<dyn RealToComplex<f64>>,
    filters: Vec<f32>,
}

impl MelSpectrogram {
    pub fn new(filters: Vec<f32>) -> anyhow::Result<Self> {
        if filters.len() != FREQUENCY_BINS * MEL_BANDS {
            bail!("The mel filter bank holds {} floats, expected {}", filters.len(), FREQUENCY_BINS * MEL_BANDS);
        }
        Ok(Self {
            window: (0..FRAME_LENGTH)
                .map(|i| 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / FRAME_LENGTH as f64).cos())
                .collect(),
            fft: RealFftPlanner::<f64>::new().plan_fft_forward(FRAME_LENGTH),
            filters,
        })
    }

    pub fn compute(&self, samples: &[f32]) -> Vec<f32> {
        let mut waveform = vec![0.0f32; WINDOW_SAMPLES];
        if samples.len() >= WINDOW_SAMPLES {
            waveform.copy_from_slice(&samples[..WINDOW_SAMPLES]);
        } else if !samples.is_empty() {
            let mut offset = 0;
            while offset + samples.len() <= WINDOW_SAMPLES {
                waveform[offset..offset + samples.len()].copy_from_slice(samples);
                offset += samples.len();
            }
        }

        const PAD: usize = FRAME_LENGTH / 2;
        let mut padded = vec![0.0f32; WINDOW_SAMPLES + PAD * 2];
        padded[PAD..PAD + WINDOW_SAMPLES].copy_from_slice(&waveform);
        for i in 0..PAD {
            padded[PAD - 1 - i] = waveform[(i + 1).min(WINDOW_SAMPLES - 1)];
            padded[PAD + WINDOW_SAMPLES + i] = waveform[(WINDOW_SAMPLES as i64 - 2 - i as i64).max(0) as usize];
        }

        let mut input = self.fft.make_input_vec();
        let mut spectrum = self.fft.make_output_vec();
        let mut power = vec![0.0f64; FREQUENCY_BINS];
        let mut result = vec![0.0f32; FRAMES * MEL_BANDS];

        for frame in 0..FRAMES {
            let start = frame * HOP_LENGTH;
            for i in 0..FRAME_LENGTH {
                input[i] = f64::from(padded[start + i]) * self.window[i];
            }
            if self.fft.process(&mut input, &mut spectrum).is_err() {
                continue;
            }
            for (bin, value) in spectrum.iter().enumerate() {
                let real = f64::from(value.re as f32);
                let imaginary = f64::from(value.im as f32);
                power[bin] = real * real + imaginary * imaginary;
            }

            for band in 0..MEL_BANDS {
                let sum: f64 = self
                    .filters
                    .iter()
                    .skip(band)
                    .step_by(MEL_BANDS)
                    .zip(&power)
                    .fold(0.0, |sum, (filter, power)| sum + f64::from(*filter) * power);
                result[frame * MEL_BANDS + band] = (10.0 * sum.max(FLOOR).log10()) as f32;
            }
        }
        result
    }
}

fn read_filters(path: &Path) -> anyhow::Result<Vec<f32>> {
    let bytes = std::fs::read(path).with_context(|| format!("Could not read {}", path.display()))?;
    Ok(bytes.as_chunks::<4>().0.iter().map(|chunk| f32::from_le_bytes(*chunk)).collect())
}

pub struct ClapEmbedder {
    session: Mutex<Session>,
    mel: MelSpectrogram,
}

impl ClapEmbedder {
    pub fn load(storage_root: &Path) -> anyhow::Result<Self> {
        let model = storage_root.join(MODEL_PATH);
        let filters = storage_root.join(MEL_FILTERS_PATH);
        if !model.is_file() || !filters.is_file() {
            bail!(
                "The CLAP model is required but '{MODEL_PATH}' or '{MEL_FILTERS_PATH}' is missing from the storage root. \
                 Set CLAP_MODEL_URL to download it, or export it with `make model`."
            );
        }

        let threads = std::thread::available_parallelism().map_or(1, |n| (n.get() / 4).max(1));
        let failed = |error: String| {
            anyhow::anyhow!(
                "Could not load the CLAP model from '{}'. Delete the model directory and export it again. ({error})",
                model.display()
            )
        };
        let environment = ort::init().with_name("caimack").build().map_err(|e| failed(e.to_string()))?;
        let mut builder = Session::builder(&environment)
            .map_err(|e| failed(e.to_string()))?
            .with_intra_threads(threads)
            .map_err(|e| failed(e.to_string()))?
            .with_inter_threads(1)
            .map_err(|e| failed(e.to_string()))?
            .with_optimization_level(GraphOptimizationLevel::All)
            .map_err(|e| failed(e.to_string()))?;
        let session = builder.commit_from_file(&model).map_err(|e| failed(e.to_string()))?;
        tracing::info!("CLAP model loaded from {} ({threads} intra-op threads)", model.display());

        Ok(Self { session: Mutex::new(session), mel: MelSpectrogram::new(read_filters(&filters)?)? })
    }

    pub fn embed(&self, windows: &[Vec<f32>]) -> anyhow::Result<Vec<f32>> {
        if windows.is_empty() {
            bail!("No audio windows to embed");
        }
        let stride = FRAMES * MEL_BANDS;
        let mut pooled = vec![0.0f32; DIMENSION];

        for chunk in windows.chunks(INFERENCE_BATCH) {
            let mut flat = Vec::with_capacity(chunk.len() * stride);
            for window in chunk {
                flat.extend(self.mel.compute(window));
            }
            let input =
                Tensor::from_array(([chunk.len(), 1, FRAMES, MEL_BANDS], flat)).map_err(|e| anyhow::anyhow!("{e}"))?;

            let mut session = self.session.lock().map_err(|_| anyhow::anyhow!("The CLAP session is poisoned"))?;
            let outputs = session.run(ort::inputs![INPUT_NAME => input]).map_err(|e| anyhow::anyhow!("{e}"))?;
            let (_, values) = outputs[0].try_extract_tensor::<f32>().map_err(|e| anyhow::anyhow!("{e}"))?;
            if values.len() != chunk.len() * DIMENSION {
                bail!("CLAP returned {} values for {} windows", values.len(), chunk.len());
            }
            for row in values.as_chunks::<DIMENSION>().0 {
                pooled.iter_mut().zip(row).for_each(|(sum, value)| *sum += value);
            }
        }

        let count = windows.len() as f32;
        pooled.iter_mut().for_each(|value| *value /= count);
        normalize(&mut pooled);
        Ok(pooled)
    }
}

pub fn normalize(vector: &mut [f32]) {
    let norm = vector.iter().map(|v| v * v).sum::<f32>().sqrt();
    if norm >= DEGENERATE_NORM {
        vector.iter_mut().for_each(|v| *v /= norm);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_plan_matches_the_previous_backend() {
        assert_eq!(windows::plan(36.0), [1.8, 13.0, 24.2]);
    }

    #[test]
    fn short_tracks_get_one_window_and_empty_none() {
        assert_eq!((windows::plan(10.03), windows::plan(0.0)), (vec![0.0], vec![]));
    }

    #[test]
    fn long_tracks_are_capped_at_eight_windows() {
        assert_eq!(windows::plan(3600.0).len(), 8);
    }
}
