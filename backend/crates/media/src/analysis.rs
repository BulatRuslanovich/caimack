// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

use std::fs::File;
use std::path::Path;

use anyhow::{Context, bail};
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error as DecodeError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

use crate::clap::{self, windows};
use crate::cues::{self, CueDetector, TrackCuePoints};
use crate::fingerprint::{self, FingerprintBuilder};
use crate::key::{self, KeyDetector, MusicalKey};
use crate::loudness::{Loudness, LoudnessMeter};
use crate::resample::Resampler;

pub struct Analysis {
    pub cues: Option<TrackCuePoints>,

    pub loudness: Option<Loudness>,
    pub key: Option<MusicalKey>,
    pub fingerprint: Option<Vec<u32>>,

    pub windows: Vec<Vec<f32>>,
}

struct Window {
    start: usize,
    samples: Vec<f32>,
}

impl Window {
    fn take(&mut self, position: usize, chunk: &[f32]) {
        let end = self.start + clap::WINDOW_SAMPLES;
        let from = self.start.max(position);
        let to = end.min(position + chunk.len());
        if from < to {
            self.samples.extend_from_slice(&chunk[from - position..to - position]);
        }
    }
}

pub fn analyze(path: &Path, duration_seconds: f64, embed: bool) -> anyhow::Result<Analysis> {
    const _: () = assert!(key::SAMPLE_RATE == cues::SAMPLE_RATE && fingerprint::SAMPLE_RATE == cues::SAMPLE_RATE);

    let file = File::open(path).with_context(|| format!("Could not open {}", path.display()))?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(extension);
    }

    let mut format = symphonia::default::get_probe()
        .probe(&hint, stream, FormatOptions::default(), MetadataOptions::default())
        .context("Not a readable audio file")?;
    let track = format.default_track(TrackType::Audio).context("No audio track")?;
    let track_id = track.id;
    let params = track.codec_params.as_ref().and_then(|params| params.audio()).context("No audio codec parameters")?;
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(params, &AudioDecoderOptions::default())
        .context("Unsupported audio codec")?;

    let plan = if embed { windows::plan(duration_seconds) } else { Vec::new() };
    let mut windows: Vec<Window> = plan
        .into_iter()
        .map(|offset| Window { start: (offset * f64::from(clap::SAMPLE_RATE)).round() as usize, samples: Vec::new() })
        .collect();

    let mut detector = CueDetector::default();
    let mut key = KeyDetector::default();
    let mut fingerprint = FingerprintBuilder::default();
    let mut loudness = LoudnessMeter::default();
    let mut streams: Option<(Resampler, Option<Resampler>)> = None;
    let mut interleaved: Vec<f32> = Vec::new();
    let mut mono: Vec<f32> = Vec::new();
    let mut for_cues: Vec<f32> = Vec::new();
    let mut for_clap: Vec<f32> = Vec::new();
    let mut clap_position = 0usize;

    loop {
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break,
            Err(DecodeError::ResetRequired) => bail!("The stream changed its parameters midway"),
            Err(error) => return Err(error).context("Could not read the audio stream"),
        };
        if packet.track_id != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(DecodeError::DecodeError(_)) => continue,
            Err(error) => return Err(error).context("Could not decode the audio stream"),
        };
        let channels = decoded.spec().channels().count().max(1);
        let rate = decoded.spec().rate();
        decoded.copy_to_vec_interleaved(&mut interleaved);
        loudness.feed(&interleaved, channels, rate);

        mono.clear();
        mono.extend(interleaved.chunks_exact(channels).map(downmix));

        let (to_cues, to_clap) = streams.get_or_insert_with(|| {
            let to_clap = (!windows.is_empty()).then(|| Resampler::new(rate, clap::SAMPLE_RATE));
            (Resampler::new(rate, cues::SAMPLE_RATE), to_clap)
        });
        for_cues.clear();
        to_cues.process(&mono, &mut for_cues);
        detector.feed(&for_cues);
        key.feed(&for_cues);
        fingerprint.feed(&for_cues);

        if let Some(to_clap) = to_clap {
            for_clap.clear();
            to_clap.process(&mono, &mut for_clap);
            for window in &mut windows {
                window.take(clap_position, &for_clap);
            }
            clap_position += for_clap.len();
        }
    }

    let Some((mut to_cues, to_clap)) = streams else {
        bail!("The file holds no decodable audio");
    };
    for_cues.clear();
    to_cues.finish(&mut for_cues);
    detector.feed(&for_cues);
    key.feed(&for_cues);
    fingerprint.feed(&for_cues);

    if let Some(mut to_clap) = to_clap {
        for_clap.clear();
        to_clap.finish(&mut for_clap);
        for window in &mut windows {
            window.take(clap_position, &for_clap);
        }
    }

    Ok(Analysis {
        cues: detector.complete(),
        loudness: loudness.complete(),
        key: key.complete(),
        fingerprint: fingerprint.complete(),
        windows: windows.into_iter().map(|w| w.samples).filter(|samples| !samples.is_empty()).collect(),
    })
}

fn downmix(frame: &[f32]) -> f32 {
    match frame {
        [mono] => *mono,
        [left, right] => (left + right) * std::f32::consts::FRAC_1_SQRT_2,
        many => many.iter().sum::<f32>() / many.len() as f32,
    }
}
