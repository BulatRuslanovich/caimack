#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 Bulat Ruslanovich
"""Run an isolated MERT GPU experiment without changing the application database."""
from __future__ import annotations

import argparse
import array
import json
import math
import os
from pathlib import Path
import random
import subprocess
import sys
import time
from datetime import datetime, timezone
from uuid import uuid4

MODELS = {
    "m-a-p/MERT-v1-330M": "5240c2708a5acaee1007f43fb9735c7dcd0b78c9",
    "m-a-p/MERT-v1-95M": "12af15fef9d0ac838c3f475bfbbf26d2060dd4f5",
}
SAMPLE_RATE = 24_000
EXTENSIONS = {".mp3", ".flac", ".wav", ".m4a", ".ogg", ".opus", ".aac"}


def positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return number


def fragment_offsets(duration: float, seconds: float, count: int) -> list[float]:
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("audio duration must be finite and positive")
    if not math.isfinite(seconds) or seconds <= 0 or count < 1:
        raise ValueError("fragment size and count must be positive")
    if duration <= seconds:
        return [0.0]
    edge = min(duration * 0.05, 15.0)
    first, last = edge, duration - seconds - edge
    if last <= first:
        return [(duration - seconds) / 2]
    if count == 1:
        return [(first + last) / 2]
    # Overlapping near-identical windows must not dominate a short recording.
    count = min(count, max(2, int((last - first) / seconds) + 1))
    return [first + (last - first) * index / (count - 1) for index in range(count)]


def select_files(root: Path, limit: int, seed: int) -> list[Path]:
    if not root.is_dir():
        raise ValueError(f"input directory does not exist: {root}")
    files = sorted(
        path
        for path in root.rglob("*")
        if path.is_file() and path.suffix.lower() in EXTENSIONS
    )
    if not files:
        raise ValueError(f"no audio files found in {root}")
    return sorted(random.Random(seed).sample(files, min(limit, len(files))))


def probe(path: Path) -> dict:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration:format_tags=title,artist,album",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        timeout=30,
    )
    info = json.loads(result.stdout)["format"]
    duration = float(info["duration"])
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError(f"invalid duration for {path.name}")
    tags = {key.lower(): value for key, value in info.get("tags", {}).items()}
    return {
        "durationSeconds": duration,
        "title": tags.get("title", path.stem),
        "artist": tags.get("artist"),
        "album": tags.get("album"),
    }


def decode(path: Path, offset: float, seconds: float) -> array.array:
    result = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-ss",
            str(offset),
            "-i",
            str(path),
            "-t",
            str(seconds),
            "-ac",
            "1",
            "-ar",
            str(SAMPLE_RATE),
            "-f",
            "f32le",
            "pipe:1",
        ],
        check=True,
        capture_output=True,
        timeout=60,
    )
    samples = array.array("f")
    samples.frombytes(result.stdout)
    if sys.byteorder != "little":
        samples.byteswap()
    if not samples:
        raise ValueError(f"no decoded samples for {path.name} at {offset:.2f}s")
    return samples


def pool(vectors: list[list[float]]) -> list[float]:
    if (
        not vectors
        or not vectors[0]
        or any(len(row) != len(vectors[0]) for row in vectors)
    ):
        raise ValueError("fragment embeddings must have equal nonzero dimensions")
    averaged = [sum(column) / len(vectors) for column in zip(*vectors)]
    norm = math.sqrt(sum(value * value for value in averaged))
    if not math.isfinite(norm) or norm < 1e-12:
        raise ValueError("MERT returned a non-finite or zero embedding")
    return [value / norm for value in averaged]


def write_json(path: Path, value: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def load_weights(model, checkpoint: Path) -> None:
    import torch

    # Native loading runs PyTorch's compatibility hooks for legacy weight_norm.
    # Transformers 4.38's from_pretrained path can skip these trained parameters.
    state = torch.load(checkpoint, map_location="cpu", weights_only=True, mmap=True)
    model.load_state_dict(state, strict=True)


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("/input"))
    parser.add_argument("--output", type=Path, default=Path("/output/runs"))
    parser.add_argument("--model", choices=MODELS, default="m-a-p/MERT-v1-330M")
    parser.add_argument("--limit", type=positive_int, default=5)
    parser.add_argument("--windows", type=positive_int, default=3)
    parser.add_argument("--seconds", type=positive_int, default=5)
    parser.add_argument("--seed", type=int, default=17)
    parser.add_argument(
        "--layer",
        type=int,
        default=-1,
        help="hidden layer to pool; -1 uses the final layer",
    )
    parser.add_argument(
        "--list-only",
        action="store_true",
        help="write the sample manifest without loading PyTorch or downloading weights",
    )
    return parser.parse_args()


def run(args: argparse.Namespace) -> None:
    paths = select_files(args.input, args.limit, args.seed)
    manifest = []
    for path in paths:
        info = probe(path)
        manifest.append(
            {
                "path": str(path.relative_to(args.input)),
                **info,
                "offsetsSeconds": fragment_offsets(
                    info["durationSeconds"], args.seconds, args.windows
                ),
            }
        )

    started = time.perf_counter()
    run_id = (
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex[:8]
    )
    directory = args.output / run_id
    directory.mkdir(parents=True, exist_ok=False)
    report = {
        "model": args.model,
        "revision": MODELS[args.model],
        "seed": args.seed,
        "windowSeconds": args.seconds,
        "layer": args.layer,
        "precision": "float32",
        "sampleRateHz": SAMPLE_RATE,
        "selected": len(manifest),
        "manifest": manifest,
        "status": "manifest" if args.list_only else "starting",
        "tracks": [],
    }
    write_json(directory / "report.json", report)
    print(f"Sample: {len(manifest)} tracks; output: {directory}", flush=True)
    if args.list_only:
        return

    try:
        run_gpu(args, directory, report, paths, manifest)
        report["status"] = "complete"
    except Exception as error:
        report.update(
            {"status": "failed", "error": type(error).__name__, "message": str(error)}
        )
        raise
    finally:
        report["elapsedSeconds"] = time.perf_counter() - started
        write_json(directory / "report.json", report)
    print(
        json.dumps(
            {
                key: report.get(key)
                for key in [
                    "status",
                    "device",
                    "loadSeconds",
                    "elapsedSeconds",
                    "gpuPeakAllocatedBytes",
                    "gpuPeakReservedBytes",
                ]
            }
        ),
        flush=True,
    )


def run_gpu(
    args: argparse.Namespace,
    directory: Path,
    report: dict,
    paths: list[Path],
    manifest: list[dict],
) -> None:
    # Imports stay lazy: sample preparation and unit tests need only Python + ffmpeg.
    import numpy as np
    import torch
    from huggingface_hub import hf_hub_download
    from transformers import AutoConfig, AutoModel, Wav2Vec2FeatureExtractor

    if not torch.cuda.is_available():
        raise RuntimeError(
            "CUDA/ROCm is unavailable. Check the GPU driver and Docker device access; this experiment requires a GPU."
        )
    torch.set_num_threads(int(os.environ.get("OMP_NUM_THREADS", "2")))
    torch.cuda.set_device(0)
    report.update(
        {
            "device": torch.cuda.get_device_name(0),
            "torch": torch.__version__,
            "cuda": torch.version.cuda,
            "hip": torch.version.hip,
            "gpuTotalBytes": torch.cuda.get_device_properties(0).total_memory,
            "gpuFreeBytesBeforeLoad": torch.cuda.mem_get_info()[0],
        }
    )
    write_json(directory / "report.json", report)
    load_started = time.perf_counter()
    options = {"revision": MODELS[args.model]}
    processor = Wav2Vec2FeatureExtractor.from_pretrained(args.model, **options)
    # MERT v1 requires its own model class; only the pinned official revision is executed.
    config = AutoConfig.from_pretrained(args.model, trust_remote_code=True, **options)
    model = AutoModel.from_config(
        config, trust_remote_code=True, code_revision=MODELS[args.model]
    )
    checkpoint = Path(
        hf_hub_download(args.model, filename="pytorch_model.bin", **options)
    )
    load_weights(model, checkpoint)
    report["weightsValidated"] = True
    model = model.eval().to("cuda")
    if args.layer != -1 and not 0 <= args.layer <= model.config.num_hidden_layers:
        raise ValueError(
            f"--layer must be -1 or between 0 and {model.config.num_hidden_layers}"
        )
    torch.cuda.synchronize()
    report["loadSeconds"] = time.perf_counter() - load_started
    torch.cuda.reset_peak_memory_stats()

    with (directory / "embeddings.jsonl").open("x", encoding="utf-8") as output:
        for index, (path, item) in enumerate(zip(paths, manifest)):
            track_started = time.perf_counter()
            vectors = []
            inference_seconds = 0.0
            with torch.inference_mode():
                for offset in item["offsetsSeconds"]:
                    waveform = np.asarray(
                        decode(path, offset, args.seconds), dtype=np.float32
                    )
                    inputs = processor(
                        waveform, sampling_rate=SAMPLE_RATE, return_tensors="pt"
                    ).to("cuda")
                    torch.cuda.synchronize()
                    inference_started = time.perf_counter()
                    result = model(**inputs, output_hidden_states=args.layer != -1)
                    frames = (
                        result.last_hidden_state
                        if args.layer == -1
                        else result.hidden_states[args.layer]
                    )
                    vector = torch.nn.functional.normalize(frames.mean(dim=1), dim=-1)[
                        0
                    ]
                    vectors.append(vector.cpu().tolist())
                    torch.cuda.synchronize()
                    inference_seconds += time.perf_counter() - inference_started
                    del result, frames, vector, inputs
            vector = pool(vectors)
            output.write(
                json.dumps(
                    {"path": item["path"], "vector": vector},
                    ensure_ascii=False,
                    allow_nan=False,
                )
                + "\n"
            )
            output.flush()
            report["tracks"].append(
                {
                    "path": item["path"],
                    "windows": len(vectors),
                    "dimension": len(vector),
                    "totalSeconds": time.perf_counter() - track_started,
                    "inferenceSeconds": inference_seconds,
                }
            )
            report["gpuPeakAllocatedBytes"] = torch.cuda.max_memory_allocated()
            report["gpuPeakReservedBytes"] = torch.cuda.max_memory_reserved()
            write_json(directory / "report.json", report)
            print(
                f"[{index + 1}/{len(paths)}] {item['path']}: {report['tracks'][-1]['totalSeconds']:.2f}s",
                flush=True,
            )


if __name__ == "__main__":
    try:
        run(arguments())
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"MERT experiment failed: {error}", file=sys.stderr)
        sys.exit(1)
