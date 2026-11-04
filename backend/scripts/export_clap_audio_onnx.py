#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 Bulat Ruslanovich
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import torch
from transformers import ClapFeatureExtractor, ClapModel

DEFAULT_MODEL = "laion/larger_clap_music_and_speech"
WINDOW_SECONDS = 10.0
STRATEGY = "clap_body_v2"


class ClapAudioTower(torch.nn.Module):
    def __init__(self, model: ClapModel):
        super().__init__()
        self.audio_model = model.audio_model
        self.audio_projection = model.audio_projection

    def forward(self, input_features: torch.Tensor) -> torch.Tensor:
        pooled = self.audio_model(input_features=input_features, return_dict=True).pooler_output
        return torch.nn.functional.normalize(self.audio_projection(pooled), dim=-1)


def plan_windows(duration: float, segment: float = WINDOW_SECONDS) -> list[float]:
    if duration <= 0:
        return []
    if duration <= segment + 0.05:
        return [0.0]

    count = min(max(round(duration / 30.0), 3), 8)
    edge = min(duration * 0.05, 15.0)
    first, last = edge, duration - segment - edge
    if last <= first:
        first, last = 0.0, duration - segment

    offsets: list[float] = []
    for index in range(count):
        candidate = first + (last - first) * index / (count - 1)
        if all(abs(candidate - kept) >= 0.5 for kept in offsets):
            offsets.append(candidate)

    return offsets


def mel_of(extractor: ClapFeatureExtractor, window: np.ndarray) -> np.ndarray:
    return extractor._np_extract_fbank_features(window, extractor.mel_filters_slaney)


def pad_like_extractor(waveform: np.ndarray, target: int) -> np.ndarray:
    if waveform.shape[0] >= target:
        return waveform[:target]

    repeats = int(target / len(waveform))
    if repeats > 1:
        waveform = np.tile(waveform, repeats)

    return np.pad(waveform, (0, target - waveform.shape[0]), mode="constant")


def embed(tower: ClapAudioTower, mels: list[np.ndarray]) -> np.ndarray:
    batch = np.stack(mels)[:, None, :, :].astype(np.float32)

    with torch.no_grad():
        vectors = tower(torch.from_numpy(batch)).numpy()

    pooled = vectors.mean(axis=0)
    norm = np.linalg.norm(pooled)

    return (pooled / norm if norm > 1e-12 else pooled).astype(np.float32)


def write_f32(path: Path, array: np.ndarray) -> None:
    path.write_bytes(np.ascontiguousarray(array, dtype=np.float32).tobytes())


def lcg_noise(count: int) -> np.ndarray:
    state = np.uint64(20260921)
    multiplier = np.uint64(6364136223846793005)
    increment = np.uint64(1442695040888963407)
    values = np.empty(count, dtype=np.float64)

    with np.errstate(over="ignore"):
        for i in range(count):
            state = np.uint64(state * multiplier + increment)
            values[i] = (int(state >> np.uint64(40)) / float(1 << 24)) * 2.0 - 1.0

    return values


FIXTURE_SECONDS = 12.0


def fixtures(rate: int, seconds: float = FIXTURE_SECONDS) -> dict[str, np.ndarray]:
    n = int(rate * seconds)
    t = np.arange(n, dtype=np.float64) / rate

    sweep = np.sin(2 * np.pi * (80.0 * t + (6000.0 - 80.0) / (2 * seconds) * t * t)) * 0.6
    noise = lcg_noise(n) * 0.2

    clicks = np.zeros(n)
    clicks[:: rate // 8] = 0.9

    chord = sum(np.sin(2 * np.pi * f * t) for f in (220.0, 277.18, 329.63)) / 3 * 0.7

    quiet = np.sin(2 * np.pi * 440.0 * t) * 1e-4

    return {"sweep": sweep, "noise": noise, "clicks": clicks, "chord": chord, "quiet": quiet}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--fixtures-dir", type=Path)
    parser.add_argument("--opset", type=int, default=17)
    args = parser.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)

    print(f"loading {args.model}")
    model = ClapModel.from_pretrained(args.model).eval()
    extractor = ClapFeatureExtractor.from_pretrained(args.model)

    if getattr(model.config.audio_config, "enable_fusion", False):
        raise SystemExit(
            "Чекпоинт с enable_fusion=True: графу нужен второй вход is_longer и 4 канала. "
            "Этот скрипт и C#-сторона рассчитаны на unfused."
        )

    rate = extractor.sampling_rate
    samples = extractor.nb_max_samples
    frames = samples // extractor.hop_length + 1
    bins = extractor.nb_frequency_bins

    tower = ClapAudioTower(model).eval()
    onnx_path = args.out_dir / "audio.onnx"

    print(f"exporting {onnx_path} (opset {args.opset})")
    torch.onnx.export(
        tower,
        (torch.zeros(3, 1, frames, extractor.feature_size, dtype=torch.float32),),
        str(onnx_path),
        input_names=["input_features"],
        output_names=["audio_embedding"],
        dynamic_axes={"input_features": {0: "batch"}, "audio_embedding": {0: "batch"}},
        opset_version=args.opset,
        dynamo=False,
    )

    filters = extractor.mel_filters_slaney.astype(np.float32)
    if filters.shape != (bins, extractor.feature_size):
        raise SystemExit(f"неожиданная форма банка фильтров: {filters.shape}")

    write_f32(args.out_dir / f"mel_filters_{extractor.feature_size}x{bins}.f32", filters)

    digest = hashlib.sha256(onnx_path.read_bytes()).hexdigest()

    meta = {
        "modelId": args.model,
        "strategy": STRATEGY,
        "dimension": int(model.config.projection_dim),
        "samplingRate": rate,
        "windowSamples": samples,
        "windowSeconds": WINDOW_SECONDS,
        "fftWindowSize": extractor.fft_window_size,
        "hopLength": extractor.hop_length,
        "melBands": extractor.feature_size,
        "frequencyBins": bins,
        "frames": frames,
        "frequencyMin": extractor.frequency_min,
        "frequencyMax": extractor.frequency_max,
        "topDb": extractor.top_db,
        "onnxSha256": digest,
        "opset": args.opset,
    }
    (args.out_dir / "model.json").write_text(json.dumps(meta, indent=2) + "\n")

    print(json.dumps(meta, indent=2))

    if args.fixtures_dir is None:
        return

    args.fixtures_dir.mkdir(parents=True, exist_ok=True)
    print(f"\nwriting golden fixtures to {args.fixtures_dir}")

    manifest = {"sampleRate": rate, "seconds": FIXTURE_SECONDS, "fixtures": {}}

    for name, signal in fixtures(rate).items():
        duration = len(signal) / rate
        offsets = plan_windows(duration)

        mels = []
        for offset in offsets:
            start = int(round(offset * rate))
            mels.append(mel_of(extractor, pad_like_extractor(signal[start : start + samples], samples)))

        write_f32(args.fixtures_dir / f"{name}.mel.f32", mels[0])
        write_f32(args.fixtures_dir / f"{name}.vec.f32", embed(tower, mels))

        manifest["fixtures"][name] = {
            "windows": [round(o, 6) for o in offsets],
            "sampleChecksum": float(np.sum(signal.astype(np.float32), dtype=np.float64)),
        }

        print(f"  {name}: {len(offsets)} window(s) at {[round(o, 3) for o in offsets]}")

    (args.fixtures_dir / "fixtures.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
