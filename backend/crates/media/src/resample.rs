// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::collections::VecDeque;

const HALF_TAPS: usize = 16;
const CUTOFF: f64 = 0.97;
const KAISER_BETA: f64 = 9.0;

pub struct Resampler {
    up: u64,
    down: u64,
    half: i64,

    table: Vec<Vec<f32>>,
    buffer: VecDeque<f32>,

    base: i64,
    received: i64,
    next_out: u64,
}

impl Resampler {
    pub fn new(input_rate: u32, output_rate: u32) -> Self {
        let divisor = gcd(u64::from(input_rate), u64::from(output_rate));
        let up = u64::from(output_rate) / divisor;
        let down = u64::from(input_rate) / divisor;

        let scale = (up as f64 / down as f64).min(1.0);
        let cutoff = CUTOFF * scale;
        let half = (HALF_TAPS as f64 / scale).ceil() as i64;

        let table = (0..up)
            .map(|phase| {
                let fraction = phase as f64 / up as f64;
                let mut weights: Vec<f64> = ((-half + 1)..=half)
                    .map(|j| {
                        let x = fraction - j as f64;
                        cutoff * sinc(cutoff * x) * kaiser(x / half as f64)
                    })
                    .collect();
                let sum: f64 = weights.iter().sum();
                if sum.abs() > f64::EPSILON {
                    weights.iter_mut().for_each(|w| *w /= sum);
                }
                weights.into_iter().map(|w| w as f32).collect()
            })
            .collect();

        Self { up, down, half, table, buffer: VecDeque::new(), base: 0, received: 0, next_out: 0 }
    }

    pub fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        if self.up == self.down {
            out.extend_from_slice(input);
            return;
        }
        self.buffer.extend(input);
        self.received += input.len() as i64;
        self.emit(out, false);
    }

    pub fn finish(&mut self, out: &mut Vec<f32>) {
        if self.up == self.down {
            return;
        }
        self.emit(out, true);
    }

    fn emit(&mut self, out: &mut Vec<f32>, finishing: bool) {
        loop {
            let position = self.next_out * self.down;
            let i0 = (position / self.up) as i64;
            if finishing {
                if i0 >= self.received {
                    break;
                }
            } else if i0 + self.half >= self.received {
                break;
            }

            let weights = &self.table[(position % self.up) as usize];
            let first = i0 - self.half + 1;
            let mut sum = 0.0f32;
            for (j, weight) in weights.iter().enumerate() {
                let index = first + j as i64 - self.base;
                if index >= 0
                    && let Some(sample) = self.buffer.get(index as usize)
                {
                    sum += sample * weight;
                }
            }
            out.push(sum);
            self.next_out += 1;
        }

        let keep_from = (self.next_out * self.down / self.up) as i64 - self.half;
        while self.base < keep_from && !self.buffer.is_empty() {
            self.buffer.pop_front();
            self.base += 1;
        }
    }
}

fn gcd(a: u64, b: u64) -> u64 {
    if b == 0 { a } else { gcd(b, a % b) }
}

fn sinc(x: f64) -> f64 {
    if x.abs() < 1e-12 { 1.0 } else { (std::f64::consts::PI * x).sin() / (std::f64::consts::PI * x) }
}

fn kaiser(u: f64) -> f64 {
    if u.abs() > 1.0 {
        return 0.0;
    }
    bessel_i0(KAISER_BETA * (1.0 - u * u).sqrt()) / bessel_i0(KAISER_BETA)
}

fn bessel_i0(x: f64) -> f64 {
    let mut sum = 1.0;
    let mut term = 1.0;
    let quarter = x * x / 4.0;
    for k in 1..64 {
        term *= quarter / (k as f64 * k as f64);
        sum += term;
        if term < sum * 1e-17 {
            break;
        }
    }
    sum
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(rate: u32, hz: f64, seconds: f64) -> Vec<f32> {
        (0..(f64::from(rate) * seconds) as usize)
            .map(|i| (2.0 * std::f64::consts::PI * hz * i as f64 / f64::from(rate)).sin() as f32)
            .collect()
    }

    fn resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
        let mut resampler = Resampler::new(from, to);
        let mut out = Vec::new();
        for chunk in input.chunks(1000) {
            resampler.process(chunk, &mut out);
        }
        resampler.finish(&mut out);
        out
    }

    #[test]
    fn length_follows_the_rate_ratio() {
        let out = resample(&tone(44_100, 440.0, 1.0), 44_100, 48_000);
        assert_eq!(out.len(), 48_000);
    }

    #[test]
    fn a_tone_survives_up_and_down_sampling() {
        let expected = tone(48_000, 440.0, 1.0);
        let out = resample(&tone(44_100, 440.0, 1.0), 44_100, 48_000);
        let error =
            out[1000..47_000].iter().zip(&expected[1000..47_000]).map(|(a, b)| (a - b).abs()).fold(0.0, f32::max);
        assert!(error < 0.01, "max error {error}");
    }

    #[test]
    fn content_above_the_new_nyquist_is_removed() {
        let out = resample(&tone(44_100, 9_000.0, 1.0), 44_100, 11_025);
        let peak = out[500..10_500].iter().map(|s| s.abs()).fold(0.0, f32::max);
        assert!(peak < 0.01, "peak {peak}");
    }
}
