#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 Bulat Ruslanovich

"""Internal, single-GPU MERT inference. Accepts PCM, never filesystem paths/URLs."""

import argparse
from contextlib import contextmanager, redirect_stdout
from contextvars import ContextVar
from datetime import datetime, timezone
import hashlib
import io
import json
import logging
import math
import multiprocessing
import os
import signal
import struct
import threading
import time
import uuid
import warnings
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
LOGGER = logging.getLogger("mert")
REQUEST_ID = ContextVar("mert_request_id", default=None)
LOAD_STAGE = ContextVar("mert_load_stage", default="imports")


def event(level, message, **fields):
    if REQUEST_ID.get() is not None:
        fields.setdefault("request_id", REQUEST_ID.get())
    LOGGER.log(level, message, extra={"fields": fields})


class LogFormatter(logging.Formatter):
    def __init__(self, json_output=False):
        super().__init__()
        self.json_output = json_output

    def format(self, record):
        fields = {"message": record.getMessage(), **getattr(record, "fields", {})}
        if record.exc_info:
            fields["exception"] = self.formatException(record.exc_info)
        timestamp = datetime.fromtimestamp(record.created, timezone.utc).isoformat(
            timespec="milliseconds"
        )
        if self.json_output:
            return json.dumps(
                dict(
                    timestamp=timestamp,
                    level=record.levelname,
                    target=record.name,
                    pid=record.process,
                    fields=fields,
                ),
                ensure_ascii=False,
            )
        message = fields.pop("message").replace("\n", r"\n").replace("\r", r"\r")
        details = " ".join(
            f"{key}={json.dumps(value, ensure_ascii=False)}"
            for key, value in fields.items()
        )
        return (
            f"{timestamp} {record.levelname:>5} {record.name}: {message} pid={record.process}"
            + (f" {details}" if details else "")
        )


def configure_logging():
    level = os.environ.get("MERT_LOG_LEVEL", "INFO").upper()
    invalid_level = level not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
    output_format = os.environ.get("LOG_FORMAT", "text")
    handler = logging.StreamHandler()
    handler.setFormatter(LogFormatter(json_output=output_format == "json"))
    logging.basicConfig(
        level=logging.INFO if invalid_level else level, handlers=[handler], force=True
    )
    logging.captureWarnings(True)
    # Transformers 4.38 passes this deprecated option internally. Other warnings
    # (including other FutureWarnings) must remain visible.
    warnings.filterwarnings(
        "ignore",
        category=FutureWarning,
        message=r"`resume_download` is deprecated.*",
        module=r"huggingface_hub\.file_download",
    )
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    for name in ("huggingface_hub", "transformers", "urllib3", "httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)
    if invalid_level:
        event(logging.WARNING, "Invalid MERT_LOG_LEVEL; using INFO")
    if output_format not in {"text", "json"}:
        event(logging.WARNING, "Invalid LOG_FORMAT; expected text or json, using text")


@contextmanager
def load_stage(stage):
    LOAD_STAGE.set(stage)
    started = time.monotonic()
    event(logging.INFO, "Model loading stage started", stage=stage)
    yield
    event(
        logging.INFO,
        "Model loading stage finished",
        stage=stage,
        elapsed_ms=round((time.monotonic() - started) * 1000),
    )


class ModelOutput(io.TextIOBase):
    """Convert remote model prints to events without hiding unknown diagnostics."""

    def __init__(self, cqt_enabled):
        self.cqt_enabled = cqt_enabled
        self.pending = ""

    def write(self, text):
        self.pending += text
        while "\n" in self.pending:
            line, self.pending = self.pending.split("\n", 1)
            self._line(line)
        return len(text)

    def flush(self):
        if self.pending:
            self._line(self.pending)
            self.pending = ""

    def _line(self, line):
        if (
            line.strip()
            == "WARNING: feature_extractor_cqt requires the libray 'nnAudio'"
            and not self.cqt_enabled
        ):
            event(
                logging.DEBUG, "Optional nnAudio is absent; this model has CQT disabled"
            )
        elif line.strip():
            event(logging.WARNING, "Model emitted a diagnostic", output=line)


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

        with load_stage("imports"):
            import torch
            from huggingface_hub import hf_hub_download
            from transformers import AutoConfig, AutoModel, Wav2Vec2FeatureExtractor

        with load_stage("gpu_initialization"):
            if not torch.cuda.is_available():
                raise RuntimeError(
                    "MERT requires a CUDA or ROCm GPU; check Docker GPU access"
                )
            torch.set_num_threads(int(os.environ.get("OMP_NUM_THREADS", "2")))
            torch.cuda.set_device(0)
        options = dict(revision=REVISION)
        with load_stage("configuration"):
            self.processor = Wav2Vec2FeatureExtractor.from_pretrained(MODEL, **options)
            config = AutoConfig.from_pretrained(
                MODEL, trust_remote_code=True, **options
            )
        with load_stage("architecture"):
            output = ModelOutput(
                cqt_enabled=getattr(config, "feature_extractor_cqt", False)
            )
            try:
                with redirect_stdout(output):
                    model = AutoModel.from_config(
                        config, trust_remote_code=True, code_revision=REVISION
                    )
            finally:
                output.flush()
        # Native strict loading preserves legacy weight_norm g/v parameters.
        with load_stage("checkpoint_cache_or_download"):
            checkpoint = Path(
                hf_hub_download(MODEL, filename="pytorch_model.bin", **options)
            )
            event(
                logging.INFO,
                "Model checkpoint available",
                size_bytes=checkpoint.stat().st_size,
            )
        with load_stage("checksum_verification"):
            with checkpoint.open("rb") as source:
                digest = hashlib.file_digest(source, "sha256").hexdigest()
            if digest != CHECKPOINT_SHA256:
                raise RuntimeError(
                    "MERT checkpoint checksum mismatch; replace the cached file"
                )
        with load_stage("checkpoint_loading"):
            load_weights(model, checkpoint)
        with load_stage("gpu_transfer"):
            self.model = model.eval().to("cuda")
            torch.cuda.synchronize()
        LOAD_STAGE.set("ready")
        event(
            logging.INFO,
            "Model initialized on GPU",
            model=MODEL,
            revision=REVISION,
            dimension=DIMENSION,
            device=torch.cuda.get_device_name(0),
            backend="ROCm" if torch.version.hip else "CUDA",
            allocated_mib=round(torch.cuda.memory_allocated() / 1024**2),
            reserved_mib=round(torch.cuda.memory_reserved() / 1024**2),
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


def model_worker(connection, model_factory, wake_request_id=None):
    # Only this spawned process imports torch and creates a GPU context. Killing
    # it releases the context too, which unloading tensors alone cannot do.
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    configure_logging()
    REQUEST_ID.set(wake_request_id)
    phase = "loading"
    try:
        model = model_factory()
        connection.send(("ready", None))
        phase = "inference"
        while True:
            request_id, windows = connection.recv()
            REQUEST_ID.set(request_id)
            connection.send(("vector", model.embed(windows)))
    except EOFError:
        pass
    except Exception as error:
        LOGGER.exception(
            "GPU worker failed",
            extra={
                "fields": dict(
                    phase=phase,
                    stage=LOAD_STAGE.get() if phase == "loading" else "inference",
                    request_id=REQUEST_ID.get(),
                )
            },
        )
        try:
            connection.send(("error", f"{type(error).__name__}: {error}"))
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
        self._generation = 0
        self._completed = 0
        self._fragments = 0
        self._rejected = {"loading": 0, "busy": 0, "error": 0}
        self._ready_at = 0
        self._last_load_report = 0

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
                event(
                    logging.WARNING,
                    "GPU worker did not terminate; forcing shutdown",
                    worker_pid=self._process.pid,
                )
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
        previous_state = self._state
        self._state = "error"
        self._retry_at = self._clock() + self._backoff
        event(
            logging.ERROR,
            "GPU worker unavailable; new requests deferred during recovery",
            reason=reason,
            previous_state=previous_state,
            retry_after_secs=self._backoff,
            worker_pid=self._process.pid if self._process else None,
            exit_code=self._process.exitcode if self._process else None,
            completed=self._completed,
            worker_generation=self._generation,
        )
        self._backoff = min(self._backoff * 2, 300)
        self._stop_worker()

    def _start_worker(self):
        parent, child = self._context.Pipe()
        process = self._context.Process(
            target=model_worker,
            args=(child, self._factory, REQUEST_ID.get()),
            daemon=True,
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
        self._last_load_report = self._started_at
        self._state = "loading"
        self._generation += 1
        self._completed = self._fragments = 0
        self._rejected = {"loading": 0, "busy": 0, "error": 0}
        event(
            logging.INFO,
            "GPU worker starting on embedding request; model loading",
            worker_pid=process.pid,
            worker_generation=self._generation,
            load_timeout_secs=self.load_timeout,
            model=MODEL,
            revision=REVISION,
        )

    def maintain(self):
        # Called by the HTTP accept loop, never by a GPU request thread.
        with self._lock:
            if self._closed:
                return
            try:
                if self._state == "error" and self._clock() >= self._retry_at:
                    self._stop_worker()
                    self._state = "sleeping"
                    event(
                        logging.INFO,
                        "Recovery delay finished; waiting for the next embedding request",
                    )
                if self._state not in ("loading", "ready"):
                    return
                if self._state == "loading":
                    if self._connection.poll():
                        kind, detail = self._connection.recv()
                        if kind != "ready":
                            raise RuntimeError(detail or "model loading failed")
                        self._last_used = self._clock()
                        self._ready_at = self._last_used
                        self._state = "ready"
                        event(
                            logging.INFO,
                            "GPU worker ready; waiting for a retried embedding request",
                            worker_pid=self._process.pid,
                            worker_generation=self._generation,
                            elapsed_ms=round((self._clock() - self._started_at) * 1000),
                            idle_timeout_secs=self.idle_timeout,
                            rejected_while_loading=self._rejected["loading"],
                        )
                    elif self._clock() - self._started_at >= self.load_timeout:
                        raise TimeoutError("model loading timed out")
                    elif self._clock() - self._last_load_report >= 30:
                        event(
                            logging.INFO,
                            "Model is still loading; embedding requests remain deferred",
                            worker_pid=self._process.pid,
                            elapsed_secs=round(self._clock() - self._started_at),
                            load_timeout_secs=self.load_timeout,
                        )
                        self._last_load_report = self._clock()
                if not self._process.is_alive():
                    raise RuntimeError("GPU worker exited")
                if (
                    self._state == "ready"
                    and self.idle_timeout > 0
                    and self._clock() - self._last_used >= self.idle_timeout
                ):
                    worker_pid = self._process.pid
                    idle_secs = round(self._clock() - self._last_used)
                    self._stop_worker()
                    self._state = "sleeping"
                    event(
                        logging.INFO,
                        "GPU worker stopped after idle timeout; GPU context released",
                        worker_pid=worker_pid,
                        idle_secs=idle_secs,
                        idle_timeout_secs=self.idle_timeout,
                        ready_secs=round(self._clock() - self._ready_at),
                        completed=self._completed,
                        fragments=self._fragments,
                        rejected_loading=self._rejected["loading"],
                        rejected_busy=self._rejected["busy"],
                    )
                    if self._completed == 0:
                        event(
                            logging.WARNING,
                            "Model went idle without completing any embeddings; check backend retry timing",
                            worker_generation=self._generation,
                        )
            except Exception as error:
                self._fail(f"{type(error).__name__}: {error}")

    def embed(self, windows):
        with self._lock:
            if self._closed:
                raise Unavailable("MERT is shutting down")
            if self._state == "error":
                if self._clock() < self._retry_at:
                    self._rejected["error"] += 1
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
                self._rejected["loading"] += 1
                raise Unavailable("MERT is loading")
            if self._state == "busy":
                # The durable queue lives in the backend database. Do not build
                # an unbounded second queue of PCM bodies and HTTP threads here.
                self._rejected["busy"] += 1
                raise Unavailable("MERT is busy", 1)
            self._state = "busy"
            connection = self._connection
            worker_pid = self._process.pid

        started = self._clock()
        event(
            logging.DEBUG,
            "GPU inference started",
            worker_pid=worker_pid,
            fragments=len(windows),
            audio_secs=round(sum(map(len, windows)) / SAMPLE_RATE, 3),
        )
        try:
            connection.send((REQUEST_ID.get(), windows))
            if not connection.poll(self.inference_timeout):
                raise TimeoutError("inference timed out")
            kind, vector = connection.recv()
            if kind == "error":
                raise RuntimeError(vector or "GPU inference failed")
            if (
                kind != "vector"
                or len(vector) != DIMENSION
                or not all(math.isfinite(value) for value in vector)
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
                self._completed += 1
                self._fragments += len(windows)
        event(
            logging.INFO,
            "Embedding completed",
            worker_pid=worker_pid,
            fragments=len(windows),
            dimension=len(vector),
            completed=self._completed,
            elapsed_ms=round((self._clock() - started) * 1000),
        )
        return vector

    def close(self):
        with self._lock:
            if self._closed:
                return
            self._closed = True
            self._stop_worker()
            event(
                logging.INFO,
                "MERT stopped; GPU worker released",
                completed=self._completed,
            )


class MertServer(ThreadingHTTPServer):
    def __init__(self, address, supervisor):
        self.supervisor = supervisor
        super().__init__(address, handler(supervisor))

    def service_actions(self):
        self.supervisor.maintain()


def handler(model):
    class Handler(BaseHTTPRequestHandler):
        def handle_one_request(self):
            self.request_id = uuid.uuid4().hex
            self.request_started = time.monotonic()
            token = REQUEST_ID.set(self.request_id)
            try:
                super().handle_one_request()
            finally:
                REQUEST_ID.reset(token)

        def setup(self):
            super().setup()
            self.connection.settimeout(15)

        def reply(self, status: int, payload: dict, retry_after=None):
            body = json.dumps(payload, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.send_header("X-Request-Id", self.request_id)
            if retry_after is not None:
                self.send_header("Retry-After", str(retry_after))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                event(
                    logging.DEBUG, "Client disconnected before receiving the response"
                )
            route = self.path if self.path in {"/health", "/embed"} else "<unmatched>"
            state = model.status()["state"]
            fields = dict(
                method=self.command,
                route=route,
                status=status,
                state=state,
                elapsed_ms=round((time.monotonic() - self.request_started) * 1000),
            )
            if status >= 400:
                fields["reason"] = payload.get("error", "")
            if retry_after is not None:
                fields["retry_after_secs"] = retry_after
            if status == 503 and payload.get("error") in {
                "MERT is loading",
                "MERT is busy",
            }:
                event(
                    logging.DEBUG,
                    "Embedding request deferred; client must retry",
                    **fields,
                )
            elif status >= 400 and status != 404:
                event(logging.WARNING, "HTTP request rejected", **fields)
            else:
                event(logging.DEBUG, "HTTP response sent", **fields)

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
                LOGGER.exception(
                    "Unhandled embedding request failure",
                    extra={"fields": {"request_id": self.request_id}},
                )
                self.reply(503, dict(error="Inference unavailable; retry later"))

        def log_message(self, fmt, *args):
            # reply() emits structured outcomes without raw URLs or header values.
            pass

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
    configure_logging()
    if args.download_only:
        event(
            logging.INFO,
            "Validating model download and GPU initialization",
            **identity(),
        )
        Mert()
        event(logging.INFO, "Model download validation completed")
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
        event(logging.INFO, "Shutdown requested", signal=signal.Signals(signum).name)
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    try:
        with MertServer((args.host, args.port), supervisor) as server:
            event(
                logging.INFO,
                "MERT HTTP ready; GPU starts on the first embedding request",
                address=args.host,
                port=server.server_port,
                state="sleeping",
                idle_timeout_secs=supervisor.idle_timeout,
                load_timeout_secs=supervisor.load_timeout,
                inference_timeout_secs=supervisor.inference_timeout,
                **identity(),
            )
            server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        supervisor.close()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        LOGGER.exception("MERT service failed")
        raise SystemExit(1)
