# SPDX-License-Identifier: AGPL-3.0-only
import copy
import csv
import io
import json
from pathlib import Path
import tempfile
import unittest

import evaluate_recommendations as evaluation


def report():
    def variant(name, ids):
        return {
            "ranking": name,
            "picks": [{"trackId": i} for i in ids],
            "meanSeedSimilarity": 0.9,
            "meanPairSimilarity": 0.8,
            "artistCount": 2,
        }

    return {
        "schemaVersion": 1,
        "tracks": [{"id": "a", "title": "=formula", "artistName": "Artist"}],
        "cases": [
            {
                "seedTrackId": "seed",
                "variants": [
                    variant("legacyV3", ["a", "b"]),
                    variant("calibratedV4", ["b", "c"]),
                ],
            }
        ],
    }


class EvaluationTests(unittest.TestCase):
    def test_blind_template_deduplicates_shared_candidates_and_hides_rank(self):
        data = report()
        rows = list(csv.DictReader(io.StringIO(evaluation.prepare(data))))
        self.assertEqual({r["trackId"] for r in rows}, {"a", "b", "c"})
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(r["rating"] == "" for r in rows))
        self.assertNotIn("ranking", rows[0])
        self.assertEqual(
            next(r for r in rows if r["trackId"] == "a")["title"], "'=formula"
        )
        self.assertEqual(evaluation.prepare(data), evaluation.prepare(data))

    def test_missing_judgments_are_not_negative_and_cases_stay_paired(self):
        result = evaluation.score(report(), {("seed", "a"): 2, ("seed", "b"): 1})
        self.assertEqual(result["fullyRatedCases"], 0)
        self.assertEqual(result["unjudgedPairs"], 1)
        self.assertIsNone(result["relevance"]["legacyV3"]["ndcgAt10"])
        self.assertIsNone(result["candidateMinusBaseline"]["precisionAt10"])

    def test_ndcg_uses_pooled_ideal_and_position_discount(self):
        result = evaluation.score(
            report(), {("seed", "a"): 0, ("seed", "b"): 1, ("seed", "c"): 2}
        )
        self.assertEqual(result["fullyRatedCases"], 1)
        self.assertEqual(result["relevance"]["legacyV3"]["precisionAt10"], 0.1)
        self.assertEqual(result["relevance"]["calibratedV4"]["precisionAt10"], 0.2)
        self.assertGreater(result["candidateMinusBaseline"]["ndcgAt10"], 0)
        self.assertLess(result["relevance"]["calibratedV4"]["ndcgAt10"], 1)

    def test_all_rejected_is_valid_and_has_zero_relevance(self):
        result = evaluation.score(
            report(), {pair: 0 for pair in evaluation.pairs(report())}
        )
        self.assertEqual(result["relevance"]["legacyV3"]["ndcgAt10"], 0)

    def test_ratings_cannot_be_mixed_with_another_report(self):
        data = report()
        altered = copy.deepcopy(data)
        altered["username"] = "other"
        with self.assertRaisesRegex(ValueError, "another report"):
            evaluation.read_ratings(altered, evaluation.prepare(data))

    def test_duplicate_invalid_or_unknown_grades_are_rejected(self):
        data = report()
        template = evaluation.prepare(data)
        lines = template.splitlines(keepends=True)
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            evaluation.read_ratings(data, template + lines[1])
        for grade in (-1, 3, True, "2"):
            with self.assertRaises(ValueError):
                evaluation.score(data, {("seed", "a"): grade})
        with self.assertRaises(ValueError):
            evaluation.score(data, {("seed", "unknown"): 0})

    def test_windows_redirect_and_unicode_titles_can_be_loaded(self):
        data = report()
        data["tracks"][0]["title"] = "Музыка"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "report.json"
            path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-16")
            self.assertEqual(evaluation.load_report(path), data)

    def test_bad_report_is_rejected(self):
        data = report()
        data["cases"][0]["variants"][1]["picks"] = [{"trackId": "seed"}]
        with self.assertRaises(ValueError):
            evaluation.validate_report(data)


if __name__ == "__main__":
    unittest.main()
