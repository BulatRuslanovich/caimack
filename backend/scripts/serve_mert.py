#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 Bulat Ruslanovich

"""Internal, single-GPU MERT inference. Accepts PCM, never filesystem paths/URLs."""

import argparse
import hashlib
import json
import logging
import math
import os
import struct
from http.server import BaseHTTPRequestHandler, HTTPServer

from benchmark_mert import MODELS, SAMPLE_RATE, load_weights, pool

MODEL = "m-a-p/MERT-v1-330M"
REVISION = MODELS[MODEL]
STRATEGY = "mert_5240c270_5s_final_mean_v1"
DIMENSION = 1024
CHECKPOINT_SHA256 = "0c03774d821a6ad972cb48220b128a10ebea2c790116bd0fd35e5a013f8017f6"
MAX_WINDOWS = 8
MAX_SAMPLES = SAMPLE_RATE * 5
MAX_BODY = 4 + MAX_WINDOWS * (4 + MAX_SAMPLES * 4)


def identity() -> dict:
    return dict(model=MODEL, revision=REVISION, strategy=STRATEGY, dimension=DIMENSION)


def decode_windows(body: bytes) -> list[list[float]]:
    if len(body) < 4 or len(body) > MAX_BODY:
        raise ValueError("Invalid PCM body size")
    count = struct.unpack_from("<I", body)[0]
    if not 1 <= count <= MAX_WINDOWS:
        raise ValueError("Invalid fragment count")
    offset = 4
    windows = []
    for _ in range(count):
        if offset + 4 > len(body):
            raise ValueError("Missing fragment length")
        length = struct.unpack_from("<I", body, offset)[0]
        offset += 4
        if not 1 <= length <= MAX_SAMPLES or offset + length * 4 > len(body):
            raise ValueError("Invalid fragment length")
        samples = list(struct.unpack_from(f"<{length}f", body, offset))
        if not all(math.isfinite(value) for value in samples):
            raise ValueError("Non-finite PCM")
        windows.append(samples)
        offset += length * 4
    if offset != len(body):
        raise ValueError("Unexpected trailing PCM data")
    return windows


class Mert:
    def __init__(self) -> None:
        from pathlib import Path

        import torch
        from huggingface_hub import hf_hub_download
        from transformers import AutoConfig, AutoModel, Wav2Vec2FeatureExtractor

        if not torch.cuda.is_available():
            raise RuntimeError("MERT requires a CUDA or ROCm GPU; check Docker GPU access")
        torch.set_num_threads(int(os.environ.get("OMP_NUM_THREADS", "2")))
        torch.cuda.set_device(0)
        options = dict(revision=REVISION)
        self.processor = Wav2Vec2FeatureExtractor.from_pretrained(MODEL, **options)
        config = AutoConfig.from_pretrained(MODEL, trust_remote_code=True, **options)
        model = AutoModel.from_config(
            config, trust_remote_code=True, code_revision=REVISION
        )
        # Native strict loading preserves legacy weight_norm g/v parameters.
        checkpoint = Path(
            hf_hub_download(MODEL, filename="pytorch_model.bin", **options)
        )
        with checkpoint.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        if digest != CHECKPOINT_SHA256:
            raise RuntimeError(
                "MERT checkpoint checksum mismatch; replace the cached file"
            )
        load_weights(model, checkpoint)
        self.model = model.eval().to("cuda")
        logging.info(
            "MERT ready: %s, revision %s, GPU %s, backend %s",
            MODEL,
            REVISION,
            torch.cuda.get_device_name(0),
            "ROCm" if torch.version.hip else "CUDA",
        )

    def embed(self, windows: list[list[float]]) -> list[float]:
        import numpy as np
        import torch

        vectors = []
        with torch.inference_mode():
            for samples in windows:
                # The convolutional frontend needs at least 400 samples.
                waveform = np.asarray(samples, dtype=np.float32)
                if len(waveform) < 400:
                    waveform = np.pad(waveform, (0, 400 - len(waveform)))
                inputs = self.processor(
                    waveform, sampling_rate=SAMPLE_RATE, return_tensors="pt"
                ).to("cuda")
                frames = self.model(**inputs).last_hidden_state
                vector = torch.nn.functional.normalize(frames.mean(dim=1), dim=-1)[0]
                vectors.append(vector.cpu().tolist())
        return pool(vectors)


def handler(model):
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(15)

        def reply(self, status: int, payload: dict):
            body = json.dumps(payload, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            (
                self.reply(200, identity())
                if self.path == "/health"
                else self.reply(404, dict(error="Not found"))
            )

        def do_POST(self):
            if self.path != "/embed":
                self.reply(404, dict(error="Not found"))
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 4 <= length <= MAX_BODY:
                    raise ValueError("Invalid Content-Length")
                if self.headers.get("Content-Type") != "application/octet-stream":
                    raise ValueError("Expected PCM binary body")
                body = self.rfile.read(length)
                if len(body) != length:
                    raise ValueError("Incomplete body")
                windows = decode_windows(body)
            except (ValueError, TimeoutError) as error:
                self.reply(400, dict(error=str(error)))
                return
            try:
                vector = model.embed(windows)
                if len(vector) != DIMENSION or not all(
                    math.isfinite(value) for value in vector
                ):
                    raise ValueError("Invalid model output")
                self.reply(200, {**identity(), "vector": vector})
            except Exception:
                logging.exception("MERT inference failed")
                self.reply(503, dict(error="Inference unavailable; retry later"))

        def log_message(self, fmt, *args):
            logging.debug(fmt, *args)

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8090)
    parser.add_argument("--download-only", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    model = Mert()
    if not args.download_only:
        # Serial execution bounds GPU memory, regardless of callers' concurrency.
        with HTTPServer((args.host, args.port), handler(model)) as server:
            server.serve_forever()


if __name__ == "__main__":
    main()
