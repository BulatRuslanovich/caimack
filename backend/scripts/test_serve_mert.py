# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 Bulat Ruslanovich

import json
import logging
import multiprocessing
import os
from pathlib import Path
import struct
import subprocess
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request
from functools import partial
from unittest.mock import patch

import serve_mert as service


class Clock:
    now = 0.0

    def __call__(self):
        return self.now


class FakeModel:
    def __init__(self, entered=None, release=None):
        self.entered = entered
        self.release = release

    def embed(self, windows):
        if windows[0][0] == -1:
            raise RuntimeError("GPU unavailable")
        if windows[0][0] == -2:
            os._exit(1)
        if windows[0][0] == -3:
            return [0.0]
        if windows[0][0] == -4:
            return [float("nan")] * service.DIMENSION
        if self.entered is not None:
            self.entered.set()
            if not self.release.wait(10):
                raise TimeoutError("test did not release inference")
        return [1.0] + [0.0] * (service.DIMENSION - 1)


class FailingModel:
    def __init__(self):
        raise RuntimeError("GPU unavailable during load")


class HangingModel:
    def __init__(self):
        time.sleep(60)


class SupervisorTests(unittest.TestCase):
    def make_supervisor(self, **options):
        self.clock = Clock()
        supervisor = service.ModelSupervisor(
            model_factory=options.pop("model_factory", FakeModel),
            clock=self.clock,
            **options,
        )
        self.addCleanup(supervisor.close)
        return supervisor

    def wait_state(self, supervisor, state):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            supervisor.maintain()
            if supervisor.status()["state"] == state:
                return
            threading.Event().wait(0.01)
        self.fail(f"Expected {state}, got {supervisor.status()}")

    def wake(self, supervisor):
        with self.assertRaises(service.Unavailable):
            supervisor.embed([[0.5]])
        self.wait_state(supervisor, "ready")

    def test_starts_without_a_worker_and_health_does_not_wake_it(self):
        supervisor = self.make_supervisor()
        for _ in range(3):
            self.assertEqual(supervisor.status()["state"], "sleeping")
            supervisor.maintain()
        self.assertIsNone(supervisor._process)

    def test_idle_terminates_worker_and_next_request_starts_a_new_one(self):
        supervisor = self.make_supervisor(idle_timeout=300)
        self.wake(supervisor)
        process = supervisor._process
        self.clock.now = 10
        self.assertEqual(len(supervisor.embed([[0.5]])), service.DIMENSION)
        self.clock.now = 309
        supervisor.maintain()
        self.assertEqual(supervisor.status()["state"], "ready")
        self.clock.now = 310
        supervisor.maintain()
        self.assertEqual(supervisor.status()["state"], "sleeping")
        self.assertFalse(process.is_alive())
        self.wake(supervisor)
        self.assertIsNot(supervisor._process, process)

    def test_zero_timeout_disables_idle_shutdown(self):
        supervisor = self.make_supervisor(idle_timeout=0)
        self.wake(supervisor)
        self.clock.now = 100000
        supervisor.maintain()
        self.assertEqual(supervisor.status()["state"], "ready")

    def test_concurrent_requests_start_only_one_worker(self):
        supervisor = self.make_supervisor(model_factory=HangingModel)
        barrier = threading.Barrier(5)
        processes = []

        def request():
            barrier.wait(timeout=5)
            with self.assertRaises(service.Unavailable):
                supervisor.embed([[0.5]])
            processes.append(supervisor._process)

        threads = [threading.Thread(target=request) for _ in range(5)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=5)
            self.assertFalse(thread.is_alive())
        self.assertEqual(len(processes), 5)
        self.assertTrue(all(process is processes[0] for process in processes))

    def test_loading_timeout_terminates_worker_and_applies_backoff(self):
        supervisor = self.make_supervisor(model_factory=HangingModel, load_timeout=10)
        with self.assertRaises(service.Unavailable):
            supervisor.embed([[0.5]])
        process = supervisor._process
        self.clock.now = 10
        supervisor.maintain()
        self.assertEqual(
            supervisor.status(), {"state": "error", "retryAfterSeconds": 30}
        )
        self.assertFalse(process.is_alive())
        with self.assertRaises(service.Unavailable) as error:
            supervisor.embed([[0.5]])
        self.assertEqual(error.exception.retry_after, 30)
        self.assertIsNone(supervisor._process)
        self.clock.now = 40
        with self.assertRaises(service.Unavailable):
            supervisor.embed([[0.5]])
        self.assertEqual(supervisor.status()["state"], "loading")

    def test_failed_load_uses_exponential_backoff_capped_at_five_minutes(self):
        supervisor = self.make_supervisor(model_factory=FailingModel)
        for delay in [30, 60, 120, 240, 300, 300]:
            with self.assertRaises(service.Unavailable):
                supervisor.embed([[0.5]])
            self.wait_state(supervisor, "error")
            self.assertEqual(supervisor.status()["retryAfterSeconds"], delay)
            self.clock.now += delay

    def test_expired_backoff_reports_sleeping_without_starting_worker(self):
        supervisor = self.make_supervisor(model_factory=FailingModel)
        with self.assertRaises(service.Unavailable):
            supervisor.embed([[0.5]])
        self.wait_state(supervisor, "error")
        self.clock.now = 30
        supervisor.maintain()
        self.assertEqual(supervisor.status(), {"state": "sleeping"})
        self.assertIsNone(supervisor._process)

    def test_crashed_or_failed_inference_is_retryable_and_destroys_worker(self):
        for sample in [-1, -2, -3, -4]:
            with self.subTest(sample=sample):
                supervisor = self.make_supervisor()
                self.wake(supervisor)
                process = supervisor._process
                with self.assertRaises(service.Unavailable):
                    supervisor.embed([[sample]])
                self.assertEqual(supervisor.status()["state"], "error")
                self.assertFalse(process.is_alive())
                self.clock.now += 30
                self.wake(supervisor)
                self.assertEqual(len(supervisor.embed([[0.5]])), service.DIMENSION)

    def test_busy_worker_is_not_unloaded_and_health_remains_responsive(self):
        context = multiprocessing.get_context("spawn")
        entered, release = context.Event(), context.Event()
        supervisor = self.make_supervisor(
            model_factory=partial(FakeModel, entered=entered, release=release),
            idle_timeout=1,
        )
        self.wake(supervisor)
        server = service.MertServer(("127.0.0.1", 0), supervisor)
        server_thread = threading.Thread(
            target=lambda: server.serve_forever(poll_interval=0.01), daemon=True
        )
        server_thread.start()

        def close_server():
            server.shutdown()
            server.server_close()
            server_thread.join(timeout=2)

        self.addCleanup(close_server)
        vectors = []
        thread = threading.Thread(
            target=lambda: vectors.append(supervisor.embed([[0.5]]))
        )
        thread.start()
        try:
            self.assertTrue(entered.wait(5))
            self.clock.now = 100
            supervisor.maintain()
            self.assertEqual(supervisor.status()["state"], "busy")
            with urllib.request.urlopen(
                f"http://127.0.0.1:{server.server_port}/health", timeout=2
            ) as response:
                self.assertEqual(json.load(response)["state"], "busy")
            with self.assertRaises(service.Unavailable):
                supervisor.embed([[0.5]])
            self.assertTrue(supervisor._process.is_alive())
        finally:
            release.set()
            thread.join(timeout=5)
        self.assertEqual(len(vectors), 1)
        self.assertEqual(supervisor.status()["state"], "ready")
        self.clock.now = 101
        supervisor.maintain()
        self.assertEqual(supervisor.status()["state"], "sleeping")

    def test_inference_timeout_kills_hung_worker(self):
        context = multiprocessing.get_context("spawn")
        supervisor = self.make_supervisor(
            model_factory=partial(
                FakeModel, entered=context.Event(), release=context.Event()
            ),
            inference_timeout=0.05,
        )
        self.wake(supervisor)
        process = supervisor._process
        with self.assertRaises(service.Unavailable):
            supervisor.embed([[0.5]])
        self.assertFalse(process.is_alive())
        self.assertEqual(supervisor.status()["state"], "error")

    def test_close_terminates_worker_and_prevents_restart(self):
        supervisor = self.make_supervisor()
        self.wake(supervisor)
        process = supervisor._process
        supervisor.close()
        self.assertFalse(process.is_alive())
        with self.assertRaises(service.Unavailable):
            supervisor.embed([[0.5]])

    def test_invalid_timeouts_are_rejected_before_starting_a_worker(self):
        for options in [
            {"idle_timeout": -1},
            {"idle_timeout": float("nan")},
            {"load_timeout": 0},
            {"inference_timeout": float("inf")},
        ]:
            with self.subTest(options=options), self.assertRaises(ValueError):
                service.ModelSupervisor(**options)

    def test_idle_log_exposes_a_model_that_loaded_but_did_no_work(self):
        supervisor = self.make_supervisor(idle_timeout=300)
        self.wake(supervisor)
        self.clock.now = 300
        with self.assertLogs("mert", level="INFO") as logs:
            supervisor.maintain()
        stopped = next(
            record
            for record in logs.records
            if "GPU worker stopped after idle" in record.getMessage()
        )
        self.assertEqual(stopped.fields["completed"], 0)
        self.assertEqual(stopped.fields["idle_secs"], 300)
        self.assertTrue(
            any("check backend retry timing" in line for line in logs.output)
        )

    def test_loading_progress_is_periodic_and_includes_the_deadline(self):
        supervisor = self.make_supervisor(model_factory=HangingModel, load_timeout=120)
        with self.assertRaises(service.Unavailable):
            supervisor.embed([[0.5]])
        with self.assertLogs("mert", level="INFO") as logs:
            self.clock.now = 30
            supervisor.maintain()
            self.clock.now = 31
            supervisor.maintain()
            self.clock.now = 60
            supervisor.maintain()
        progress = [
            record.fields
            for record in logs.records
            if "still loading" in record.getMessage()
        ]
        self.assertEqual([record["elapsed_secs"] for record in progress], [30, 60])
        self.assertEqual(progress[0]["load_timeout_secs"], 120)


def packet(*windows):
    return struct.pack("<I", len(windows)) + b"".join(
        struct.pack("<I", len(window)) + struct.pack(f"<{len(window)}f", *window)
        for window in windows
    )


class ProtocolTests(unittest.TestCase):
    def test_pcm_keeps_windows_samples_and_signs(self):
        self.assertEqual(
            service.decode_windows(packet([0.5, -1.0], [0.0])), [[0.5, -1.0], [0.0]]
        )

    def test_rejects_truncated_oversized_nonfinite_or_trailing_data(self):
        for body in [
            b"",
            packet(),
            packet([]),
            packet([float("nan")]),
            packet([float("inf")]),
            packet([1.0])[:-1],
            packet([1.0]) + b"x",
            struct.pack("<II", 1, service.MAX_SAMPLES + 1),
            struct.pack("<I", service.MAX_WINDOWS + 1),
        ]:
            with self.subTest(body=body[:20]):
                with self.assertRaises(ValueError):
                    service.decode_windows(body)

    def test_http_health_embedding_and_retryable_inference_failure(self):
        model = service.ModelSupervisor(model_factory=FakeModel)
        server = service.MertServer(("127.0.0.1", 0), model)
        thread = threading.Thread(
            target=lambda: server.serve_forever(poll_interval=0.01), daemon=True
        )
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            with urllib.request.urlopen(base + "/health", timeout=2) as response:
                self.assertEqual(
                    json.load(response), {**service.identity(), "state": "sleeping"}
                )
            self.assertIsNone(model._process)

            def request(body):
                return urllib.request.urlopen(
                    urllib.request.Request(
                        base + "/embed",
                        data=body,
                        headers={"Content-Type": "application/octet-stream"},
                    ),
                    timeout=2,
                )

            with self.assertRaises(urllib.error.HTTPError) as invalid:
                request(packet([float("nan")]))
            self.assertEqual(invalid.exception.code, 400)
            invalid.exception.close()
            self.assertIsNone(model._process)
            with self.assertRaises(urllib.error.HTTPError) as loading:
                request(packet([0.5]))
            self.assertEqual(loading.exception.code, 503)
            self.assertEqual(loading.exception.headers["Retry-After"], "5")
            loading.exception.close()
            deadline = time.monotonic() + 10
            while model.status()["state"] == "loading" and time.monotonic() < deadline:
                threading.Event().wait(0.01)
            with request(packet([0.5])) as response:
                result = json.load(response)
                self.assertEqual(result["revision"], service.REVISION)
                self.assertEqual(len(result["vector"]), service.DIMENSION)
            with self.assertLogs(level="WARNING"):
                with self.assertRaises(urllib.error.HTTPError) as unavailable:
                    request(packet([-1.0]))
            self.assertEqual(unavailable.exception.code, 503)
            self.assertEqual(unavailable.exception.headers["Retry-After"], "30")
            unavailable.exception.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
            model.close()

    def test_request_logs_correlate_responses_without_logging_secrets_or_pcm(self):
        model = service.ModelSupervisor(model_factory=FakeModel)
        self.addCleanup(model.close)
        server = service.MertServer(("127.0.0.1", 0), model)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        logged = threading.Event()
        original_event = service.event

        def capture_event(level, message, **fields):
            original_event(level, message, **fields)
            if fields.get("status") == 404:
                logged.set()

        try:
            base = f"http://127.0.0.1:{server.server_port}"
            with self.assertLogs("mert", level="DEBUG") as logs, patch.object(
                service, "event", side_effect=capture_event
            ):
                request = urllib.request.Request(
                    base + "/secret-path?token=secret-query",
                    headers={
                        "Authorization": "Bearer secret-auth",
                        "X-Request-Id": "secret-id",
                    },
                )
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(request, timeout=2)
                request_id = error.exception.headers["X-Request-Id"]
                error.exception.close()
                self.assertTrue(
                    logged.wait(5),
                    "HTTP outcome should be logged after sending the response",
                )
            record = next(
                record for record in logs.records if record.fields.get("status") == 404
            )
            self.assertEqual(record.fields["request_id"], request_id)
            self.assertEqual(record.fields["route"], "<unmatched>")
            text = "\n".join(
                service.LogFormatter(True).format(record) for record in logs.records
            )
            for secret in ("secret-path", "secret-query", "secret-auth", "secret-id"):
                self.assertNotIn(secret, text)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


class LoggingTests(unittest.TestCase):
    def test_failed_load_stage_is_retained_without_a_success_event(self):
        token = service.LOAD_STAGE.set("imports")
        try:
            with self.assertLogs("mert", level="INFO") as logs:
                with self.assertRaises(RuntimeError):
                    with service.load_stage("checksum_verification"):
                        raise RuntimeError("checksum mismatch")
            self.assertEqual(service.LOAD_STAGE.get(), "checksum_verification")
            self.assertEqual(len(logs.records), 1)
            self.assertEqual(logs.records[0].fields["stage"], "checksum_verification")
        finally:
            service.LOAD_STAGE.reset(token)

    def run_logging(self, code, **settings):
        result = subprocess.run(
            [sys.executable, "-c", "import serve_mert as s; " + code],
            cwd=Path(service.__file__).parent,
            env={
                **os.environ,
                "MERT_LOG_LEVEL": "DEBUG",
                "LOG_FORMAT": "json",
                **settings,
            },
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")
        return result.stderr.splitlines()

    def test_json_uses_stderr_and_keeps_exceptions_on_one_line(self):
        lines = self.run_logging(
            "s.configure_logging(); "
            'exec(\'try:\\n raise RuntimeError("GPU unavailable")\\nexcept RuntimeError:\\n s.LOGGER.exception("Inference failed")\')'
        )
        self.assertEqual(len(lines), 1)
        record = json.loads(lines[0])
        self.assertEqual(record["level"], "ERROR")
        self.assertTrue(record["timestamp"].endswith("+00:00"))
        self.assertIn("GPU unavailable", record["fields"]["exception"])

    def test_invalid_settings_fall_back_with_an_explanation(self):
        lines = self.run_logging(
            "s.configure_logging(); s.event(s.logging.INFO, 'Ready')",
            MERT_LOG_LEVEL="verbose",
            LOG_FORMAT="invalid",
        )
        self.assertEqual(len(lines), 3)
        self.assertIn("Invalid MERT_LOG_LEVEL", lines[0])
        self.assertIn("Invalid LOG_FORMAT", lines[1])
        self.assertIn("Ready", lines[2])
        self.assertNotIn("\x1b", "".join(lines))

    def test_only_the_known_resume_download_warning_is_suppressed(self):
        lines = self.run_logging(
            "s.configure_logging(); "
            "s.warnings.warn_explicit('`resume_download` is deprecated and will be removed', FutureWarning, 'file_download.py', 1, module='huggingface_hub.file_download'); "
            "s.warnings.warn_explicit('different future warning', FutureWarning, 'file_download.py', 2, module='huggingface_hub.file_download')"
        )
        self.assertEqual(len(lines), 1)
        self.assertIn(
            "different future warning", json.loads(lines[0])["fields"]["message"]
        )

    def test_optional_cqt_warning_is_debug_only_when_cqt_is_disabled(self):
        for enabled, level in [(False, "DEBUG"), (True, "WARNING")]:
            with self.subTest(enabled=enabled), self.assertLogs(
                "mert", level="DEBUG"
            ) as logs:
                output = service.ModelOutput(cqt_enabled=enabled)
                output.write(
                    "WARNING: feature_extractor_cqt requires the libray 'nnAudio'"
                )
                output.flush()
            self.assertEqual(logs.records[0].levelname, level)
        with self.assertLogs("mert", level="WARNING") as logs:
            service.ModelOutput(False).write("unrecognized model diagnostic\n")
        self.assertEqual(
            logs.records[0].fields["output"], "unrecognized model diagnostic"
        )


if __name__ == "__main__":
    unittest.main()
