# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 Bulat Ruslanovich
import argparse
import importlib.util
import json
import math
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import benchmark_mert as benchmark


class MertExperimentTests(unittest.TestCase):
    def test_windows_cover_the_body_without_passing_the_end(self):
        self.assertEqual(benchmark.fragment_offsets(200, 5, 3), [10, 97.5, 185])
        for duration in [0.5, 5, 5.1, 7, 20, 200, 3600]:
            offsets = benchmark.fragment_offsets(duration, 5, 3)
            self.assertEqual(len(offsets), len(set(offsets)))
            self.assertTrue(
                all(0 <= offset <= max(0, duration - 5) for offset in offsets)
            )
        self.assertEqual(benchmark.fragment_offsets(200, 5, 1), [97.5])

    def test_invalid_durations_and_embeddings_are_rejected(self):
        for duration in [0, -1, math.nan, math.inf]:
            with self.assertRaises(ValueError):
                benchmark.fragment_offsets(duration, 5, 3)
        for vectors in [[], [[]], [[1], [1, 2]], [[math.nan]], [[math.inf]], [[0, 0]]]:
            with self.assertRaises(ValueError):
                benchmark.pool(vectors)
        self.assertEqual(
            benchmark.pool([[1, 0], [0, 1]]), [1 / math.sqrt(2), 1 / math.sqrt(2)]
        )

    def test_sampling_is_repeatable_and_ignores_non_audio_files(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ["a.mp3", "b.FLAC", "c.wav", "cover.jpg", "notes.txt"]:
                (root / name).touch()
            self.assertEqual(
                benchmark.select_files(root, 2, 17), benchmark.select_files(root, 2, 17)
            )
            self.assertEqual(
                {path.name for path in benchmark.select_files(root, 10, 17)},
                {"a.mp3", "b.FLAC", "c.wav"},
            )

    def test_failed_gpu_start_is_reported_without_changing_the_input(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "input"
            source.mkdir()
            audio = source / "track.mp3"
            audio.write_bytes(b"original recording")
            args = argparse.Namespace(
                input=source,
                output=root / "results",
                model="m-a-p/MERT-v1-330M",
                limit=5,
                seed=17,
                windows=3,
                seconds=5,
                layer=-1,
                list_only=False,
            )
            with patch.object(
                benchmark, "probe", return_value={"durationSeconds": 200}
            ), patch.object(
                benchmark, "run_gpu", side_effect=RuntimeError("CUDA unavailable")
            ):
                with self.assertRaises(RuntimeError):
                    benchmark.run(args)
            reports = list(args.output.glob("*/report.json"))
            self.assertEqual(len(reports), 1)
            report = json.loads(reports[0].read_text(encoding="utf-8"))
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["message"], "CUDA unavailable")
            self.assertEqual(audio.read_bytes(), b"original recording")
            self.assertFalse(list(args.output.glob("*/embeddings.jsonl")))

    def test_manifest_runs_create_separate_directories_without_loading_a_model(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "track.flac").touch()
            args = argparse.Namespace(
                input=root,
                output=root / "results",
                model="m-a-p/MERT-v1-330M",
                limit=1,
                seed=17,
                windows=3,
                seconds=5,
                layer=-1,
                list_only=True,
            )
            with patch.object(
                benchmark, "probe", return_value={"durationSeconds": 200}
            ), patch.object(benchmark, "run_gpu") as gpu:
                benchmark.run(args)
                benchmark.run(args)
            self.assertEqual(len(list(args.output.glob("*/report.json"))), 2)
            gpu.assert_not_called()


@unittest.skipUnless(
    importlib.util.find_spec("torch"), "requires the PyTorch experiment image"
)
class CheckpointCompatibilityTests(unittest.TestCase):
    def test_legacy_normalization_keeps_the_original_model_output(self):
        import torch

        legacy = torch.nn.utils.weight_norm(torch.nn.Conv1d(2, 3, 3), dim=2)
        current = torch.nn.utils.parametrizations.weight_norm(
            torch.nn.Conv1d(2, 3, 3), dim=2
        )
        with TemporaryDirectory() as temporary:
            path = Path(temporary) / "weights.bin"
            torch.save(legacy.state_dict(), path)
            benchmark.load_weights(current, path)
        sample = torch.arange(18, dtype=torch.float32).reshape(1, 2, 9)
        torch.testing.assert_close(current(sample), legacy(sample))

    def test_an_incomplete_checkpoint_fails_instead_of_using_random_parameters(self):
        import torch

        model = torch.nn.Linear(2, 3)
        with TemporaryDirectory() as temporary:
            path = Path(temporary) / "weights.bin"
            torch.save({"weight": model.weight}, path)
            with self.assertRaises(RuntimeError):
                benchmark.load_weights(model, path)


if __name__ == "__main__":
    unittest.main()
