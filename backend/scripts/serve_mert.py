#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 Bulat Ruslanovich

"""Internal, single-GPU MERT inference. Accepts PCM, never filesystem paths/URLs."""

import argparse
import hashlib
import json
import logging
import math
import multiprocessing
import os
import signal
import struct
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

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


class Unavailable(Exception):
    def __init__(self, message: str, retry_after: int = 5):
        super().__init__(message)
        self.retry_after = retry_after


def model_worker(connection, model_factory):
    # Only this spawned process imports torch and creates a GPU context. Killing
    # it releases the context too, which unloading tensors alone cannot do.
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    try:
        model = model_factory()
        connection.send(("ready", None))
        while True:
            windows = connection.recv()
            connection.send(("vector", model.embed(windows)))
    except EOFError:
        pass
    except Exception:
        logging.exception("MERT GPU worker failed")
        try:
            connection.send(("error", None))
        except (OSError, EOFError):
            pass
    finally:
        connection.close()


class ModelSupervisor:
    def __init__(
        self,
        idle_timeout=300,
        load_timeout=1800,
        inference_timeout=90,
        *,
        model_factory=Mert,
        clock=time.monotonic,
    ):
        for name, value in [
            ("idle_timeout", idle_timeout),
            ("load_timeout", load_timeout),
            ("inference_timeout", inference_timeout),
        ]:
            if (
                not math.isfinite(value)
                or value < 0
                or (name != "idle_timeout" and value == 0)
            ):
                raise ValueError(f"Invalid {name}")
        self.idle_timeout = idle_timeout
        self.load_timeout = load_timeout
        self.inference_timeout = inference_timeout
        self._factory = model_factory
        self._clock = clock
        self._context = multiprocessing.get_context("spawn")
        self._lock = threading.Lock()
        self._process = None
        self._connection = None
        self._state = "sleeping"
        self._started_at = 0
        self._last_used = 0
        self._retry_at = 0
        self._backoff = 30
        self._closed = False

    def status(self):
        with self._lock:
            result = {"state": self._state}
            if self._state == "error":
                result["retryAfterSeconds"] = self._retry_after()
            return result

    def _retry_after(self):
        return max(1, math.ceil(self._retry_at - self._clock()))

    def _stop_worker(self):
        if self._process is not None:
            if self._process.is_alive():
                self._process.terminate()
            self._process.join(timeout=1)
            if self._process.is_alive():
                self._process.kill()
                self._process.join(timeout=1)
            if self._process.is_alive():
                # Keep ownership: never start another worker while the old one
                # might still hold GPU memory (e.g. an uninterruptible driver).
                raise RuntimeError("MERT worker did not stop")
            self._process = None
        if self._connection is not None:
            self._connection.close()
            self._connection = None

    def _fail(self, reason):
        self._state = "error"
        self._retry_at = self._clock() + self._backoff
        logging.warning("MERT unavailable: %s; retry in %s s", reason, self._backoff)
        self._backoff = min(self._backoff * 2, 300)
        self._stop_worker()

    def _start_worker(self):
        parent, child = self._context.Pipe()
        process = self._context.Process(
            target=model_worker, args=(child, self._factory), daemon=True
        )
        try:
            process.start()
        except Exception:
            parent.close()
            raise
        finally:
            child.close()
        self._process, self._connection = process, parent
        self._started_at = self._clock()
        self._state = "loading"
        logging.info("MERT waking: worker PID %s", process.pid)

    def maintain(self):
        # Called by the HTTP accept loop, never by a GPU request thread.
        with self._lock:
            if self._closed:
                return
            try:
                if self._state == "error" and self._clock() >= self._retry_at:
                    self._stop_worker()
                    self._state = "sleeping"
                if self._state not in ("loading", "ready"):
                    return
                if self._state == "loading":
                    if self._connection.poll():
                        kind, _ = self._connection.recv()
                        if kind != "ready":
                            raise RuntimeError("model loading failed")
                        self._last_used = self._clock()
                        self._state = "ready"
                        logging.info(
                            "MERT loaded in %.1f s", self._clock() - self._started_at
                        )
                    elif self._clock() - self._started_at >= self.load_timeout:
                        raise TimeoutError("model loading timed out")
                if not self._process.is_alive():
                    raise RuntimeError("GPU worker exited")
                if (
                    self._state == "ready"
                    and self.idle_timeout > 0
                    and self._clock() - self._last_used >= self.idle_timeout
                ):
                    self._stop_worker()
                    self._state = "sleeping"
                    logging.info("MERT sleeping: GPU worker stopped after idle timeout")
            except Exception as error:
                self._fail(f"{type(error).__name__}: {error}")

    def embed(self, windows):
        with self._lock:
            if self._closed:
                raise Unavailable("MERT is shutting down")
            if self._state == "error":
                if self._clock() < self._retry_at:
                    raise Unavailable("MERT is recovering", self._retry_after())
                try:
                    self._stop_worker()
                except Exception as error:
                    self._fail(f"{type(error).__name__}: {error}")
                    raise Unavailable(
                        "MERT worker could not stop", self._retry_after()
                    ) from error
            if self._process is None:
                try:
                    self._start_worker()
                except Exception as error:
                    self._fail(f"{type(error).__name__}: {error}")
                    raise Unavailable(
                        "MERT worker could not start", self._retry_after()
                    ) from error
            if self._state == "loading":
                raise Unavailable("MERT is loading")
            if self._state == "busy":
                # The durable queue lives in the backend database. Do not build
                # an unbounded second queue of PCM bodies and HTTP threads here.
                raise Unavailable("MERT is busy", 1)
            self._state = "busy"
            connection = self._connection

        started = self._clock()
        try:
            connection.send(windows)
            if not connection.poll(self.inference_timeout):
                raise TimeoutError("inference timed out")
            kind, vector = connection.recv()
            if kind != "vector" or len(vector) != DIMENSION or not all(
                math.isfinite(value) for value in vector
            ):
                raise ValueError("invalid model output or inference failure")
        except Exception as error:
            with self._lock:
                if not self._closed:
                    self._fail(f"{type(error).__name__}: {error}")
                retry_after = self._retry_after()
            raise Unavailable(
                "Inference unavailable; retry later", retry_after
            ) from error
        with self._lock:
            if not self._closed:
                self._state = "ready"
                self._last_used = self._clock()
                self._backoff = 30
        logging.info(
            "MERT embedded %s fragments in %.2f s",
            len(windows),
            self._clock() - started,
        )
        return vector

    def close(self):
        with self._lock:
            self._closed = True
            self._stop_worker()


class MertServer(ThreadingHTTPServer):
    def __init__(self, address, supervisor):
        self.supervisor = supervisor
        super().__init__(address, handler(supervisor))

    def service_actions(self):
        self.supervisor.maintain()


def handler(model):
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(15)

        def reply(self, status: int, payload: dict, retry_after=None):
            body = json.dumps(payload, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            if retry_after is not None:
                self.send_header("Retry-After", str(retry_after))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            (
                self.reply(200, {**identity(), **model.status()})
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
                self.reply(200, {**identity(), "vector": vector})
            except Unavailable as error:
                self.reply(503, dict(error=str(error)), retry_after=error.retry_after)
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
    parser.add_argument(
        "--idle-timeout-seconds",
        type=float,
        default=os.environ.get("MERT_IDLE_TIMEOUT_SECONDS", "300"),
        help="Stop the GPU worker after this idle period; 0 disables idle shutdown",
    )
    parser.add_argument(
        "--load-timeout-seconds",
        type=float,
        default=os.environ.get("MERT_LOAD_TIMEOUT_SECONDS", "1800"),
    )
    parser.add_argument(
        "--inference-timeout-seconds",
        type=float,
        default=os.environ.get("MERT_INFERENCE_TIMEOUT_SECONDS", "90"),
    )
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    if args.download_only:
        Mert()
        return
    try:
        supervisor = ModelSupervisor(
            idle_timeout=args.idle_timeout_seconds,
            load_timeout=args.load_timeout_seconds,
            inference_timeout=args.inference_timeout_seconds,
        )
    except ValueError as error:
        parser.error(str(error))

    def stop(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    try:
        with MertServer((args.host, args.port), supervisor) as server:
            logging.info(
                "MERT HTTP ready; GPU sleeping until the first embedding request"
            )
            server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        supervisor.close()


if __name__ == "__main__":
    main()
