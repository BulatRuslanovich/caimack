// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use ebur128::{EbuR128, Mode};

const SILENCE_LUFS: f64 = -70.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Loudness {
    pub integrated_lufs: f64,
    pub true_peak_db: f64,
    pub range_lu: Option<f64>,
}

#[derive(Default)]
pub struct LoudnessMeter {
    meter: Option<EbuR128>,
    channels: u32,
    broken: bool,
}

impl LoudnessMeter {
    pub fn feed(&mut self, interleaved: &[f32], channels: usize, rate: u32) {
        if self.broken {
            return;
        }
        let Ok(channels) = u32::try_from(channels) else {
            self.broken = true;
            return;
        };
        if self.meter.is_none() {
            match EbuR128::new(channels, rate, Mode::I | Mode::LRA | Mode::TRUE_PEAK) {
                Ok(meter) => {
                    self.meter = Some(meter);
                    self.channels = channels;
                }
                Err(_) => {
                    self.broken = true;
                    return;
                }
            }
        }
        let Some(meter) = self.meter.as_mut() else { return };
        if channels != self.channels || meter.rate() != rate || meter.add_frames_f32(interleaved).is_err() {
            self.broken = true;
        }
    }

    pub fn complete(self) -> Option<Loudness> {
        if self.broken {
            return None;
        }
        let meter = self.meter?;
        let integrated_lufs = meter.loudness_global().ok().filter(|lufs| lufs.is_finite() && *lufs > SILENCE_LUFS)?;
        let peak = (0..self.channels).filter_map(|channel| meter.true_peak(channel).ok()).fold(0.0, f64::max);
        if peak <= 0.0 {
            return None;
        }
        let range_lu = meter.loudness_range().ok().filter(|lu| lu.is_finite());
        Some(Loudness { integrated_lufs, true_peak_db: 20.0 * peak.log10(), range_lu })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(amplitude: f32, seconds: u32, rate: u32, channels: usize) -> Vec<f32> {
        (0..seconds * rate)
            .flat_map(|i| {
                let value = amplitude * (std::f32::consts::TAU * 997.0 * i as f32 / rate as f32).sin();
                std::iter::repeat_n(value, channels)
            })
            .collect()
    }

    #[test]
    fn stereo_sine_at_minus_twenty_dbfs_reads_minus_twenty_lufs() {
        let mut meter = LoudnessMeter::default();
        for chunk in sine(0.1, 10, 44_100, 2).chunks(4096) {
            meter.feed(chunk, 2, 44_100);
        }
        let loudness = meter.complete();

        let integrated = loudness.map(|l| l.integrated_lufs).unwrap_or_default();
        let peak = loudness.map(|l| l.true_peak_db).unwrap_or_default();
        assert!((integrated + 20.0).abs() < 0.3, "{integrated}");
        assert!((peak + 20.0).abs() < 0.3, "{peak}");
    }

    #[test]
    fn silence_has_no_loudness() {
        let mut meter = LoudnessMeter::default();
        meter.feed(&vec![0.0; 44_100 * 2 * 5], 2, 44_100);
        assert_eq!(meter.complete(), None);
    }

    #[test]
    fn changing_the_channel_count_gives_up() {
        let mut meter = LoudnessMeter::default();
        meter.feed(&sine(0.1, 5, 44_100, 2), 2, 44_100);
        meter.feed(&sine(0.1, 5, 44_100, 1), 1, 44_100);
        assert_eq!(meter.complete(), None);
    }
}
