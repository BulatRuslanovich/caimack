# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 Bulat Ruslanovich

import json
import struct
import threading
import unittest
import urllib.error
import urllib.request
from http.server import HTTPServer

import serve_mert as service


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
        class FakeModel:
            fail = False

            def embed(self, windows):
                if self.fail:
                    raise RuntimeError("GPU unavailable")
                return [1.0] + [0.0] * (service.DIMENSION - 1)

        model = FakeModel()
        server = HTTPServer(("127.0.0.1", 0), service.handler(model))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            with urllib.request.urlopen(base + "/health", timeout=2) as response:
                self.assertEqual(json.load(response), service.identity())

            def request(body):
                return urllib.request.urlopen(
                    urllib.request.Request(
                        base + "/embed",
                        data=body,
                        headers={"Content-Type": "application/octet-stream"},
                    ),
                    timeout=2,
                )

            with request(packet([0.5])) as response:
                result = json.load(response)
                self.assertEqual(result["revision"], service.REVISION)
                self.assertEqual(len(result["vector"]), service.DIMENSION)
            with self.assertRaises(urllib.error.HTTPError) as invalid:
                request(packet([float("nan")]))
            self.assertEqual(invalid.exception.code, 400)
            invalid.exception.close()
            model.fail = True
            with self.assertLogs(level="ERROR"):
                with self.assertRaises(urllib.error.HTTPError) as unavailable:
                    request(packet([1.0]))
            self.assertEqual(unavailable.exception.code, 503)
            unavailable.exception.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
