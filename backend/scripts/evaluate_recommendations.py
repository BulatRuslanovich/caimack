#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Blind pooled judgments for paired radio reports; Python standard library only."""

import argparse
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import random
import sys


VARIANTS = ("legacyV3", "calibratedV4")
COLUMNS = (
    "reportId",
    "seedId",
    "seedArtist",
    "seedTitle",
    "trackId",
    "artist",
    "title",
    "rating",
    "notes",
)


def load_report(path):
    data = Path(path).read_bytes()
    # Windows PowerShell redirects native stdout as UTF-16; Unix uses UTF-8.
    encoding = "utf-16" if data.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig"
    report = json.loads(data.decode(encoding))
    validate_report(report)
    return report


def validate_report(report):
    if report.get("schemaVersion") != 1 or not report.get("cases"):
        raise ValueError(
            "Expected a version 1 report with at least one evaluation case"
        )
    seeds = set()
    for case in report["cases"]:
        seed = case["seedTrackId"]
        if seed in seeds:
            raise ValueError("Duplicate seed in report")
        seeds.add(seed)
        variants = {v["ranking"]: v for v in case["variants"]}
        if set(variants) != set(VARIANTS) or len(case["variants"]) != 2:
            raise ValueError("Expected one legacyV3 and one calibratedV4 variant")
        for variant in variants.values():
            ids = [p["trackId"] for p in variant["picks"]]
            if len(ids) > 10 or len(ids) != len(set(ids)) or seed in ids:
                raise ValueError(
                    "Expected distinct top-ten candidates, excluding the seed"
                )


def report_id(report):
    encoded = json.dumps(
        report, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def pairs(report):
    return {
        (case["seedTrackId"], pick["trackId"])
        for case in report["cases"]
        for variant in case["variants"]
        for pick in variant["picks"]
    }


def spreadsheet_text(value):
    value = str(value)
    return "'" + value if value.lstrip().startswith(("=", "+", "-", "@")) else value


def prepare(report):
    """One grade per seed/candidate pair, with algorithm and rank hidden."""
    labels = {t["id"]: t for t in report["tracks"]}
    fingerprint = report_id(report)
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=COLUMNS)
    writer.writeheader()
    for case in report["cases"]:
        seed_id = case["seedTrackId"]
        seed = labels.get(seed_id, {})
        ids = sorted({p["trackId"] for v in case["variants"] for p in v["picks"]})
        random.Random(seed_id).shuffle(ids)
        for track_id in ids:
            track = labels.get(track_id, {})
            writer.writerow(
                {
                    "reportId": fingerprint,
                    "seedId": seed_id,
                    "trackId": track_id,
                    "seedArtist": spreadsheet_text(seed.get("artistName", "")),
                    "seedTitle": spreadsheet_text(seed.get("title", seed_id)),
                    "artist": spreadsheet_text(track.get("artistName", "")),
                    "title": spreadsheet_text(track.get("title", track_id)),
                    "rating": "",
                    "notes": "",
                }
            )
    return output.getvalue()


def read_ratings(report, text):
    expected = pairs(report)
    fingerprint = report_id(report)
    result = {}
    seen = set()
    for row in csv.DictReader(io.StringIO(text.lstrip("\ufeff"))):
        pair = (row["seedId"], row["trackId"])
        if row["reportId"] != fingerprint or pair not in expected:
            raise ValueError(
                "Ratings belong to another report or contain an unknown pair"
            )
        if pair in seen:
            raise ValueError("Duplicate pair in ratings")
        seen.add(pair)
        grade = row["rating"].strip()
        if grade:
            if grade not in ("0", "1", "2"):
                raise ValueError(
                    "Use 0 (poor), 1 (acceptable), 2 (good), or leave the rating blank"
                )
            result[pair] = int(grade)
    return result


def dcg(grades):
    return sum(
        (2**grade - 1) / math.log2(position + 2)
        for position, grade in enumerate(grades[:10])
    )


def average(values):
    return sum(values) / len(values) if values else None


def score(report, ratings):
    expected = pairs(report)
    if not ratings.keys() <= expected or any(
        type(g) is not int or not 0 <= g <= 2 for g in ratings.values()
    ):
        raise ValueError("Invalid judgments")
    metrics = {name: {"precisionAt10": [], "ndcgAt10": []} for name in VARIANTS}
    complete = 0
    for case in report["cases"]:
        seed = case["seedTrackId"]
        pool = {p["trackId"] for v in case["variants"] for p in v["picks"]}
        # Keep the comparison paired. Missing judgments are never negative labels.
        if not pool or any((seed, track) not in ratings for track in pool):
            continue
        complete += 1
        ideal = dcg(sorted((ratings[seed, track] for track in pool), reverse=True))
        for variant in case["variants"]:
            grades = [ratings[seed, p["trackId"]] for p in variant["picks"]]
            name = variant["ranking"]
            metrics[name]["precisionAt10"].append(sum(g > 0 for g in grades) / 10)
            metrics[name]["ndcgAt10"].append(dcg(grades) / ideal if ideal else 0.0)
    means = {
        name: {key: average(values) for key, values in fields.items()}
        for name, fields in metrics.items()
    }
    structural = {}
    for name in VARIANTS:
        variants = [
            v for c in report["cases"] for v in c["variants"] if v["ranking"] == name
        ]
        structural[name] = {
            key: average([v[key] for v in variants])
            for key in ("meanSeedSimilarity", "meanPairSimilarity", "artistCount")
        }
    delta = {
        key: means[VARIANTS[1]][key] - means[VARIANTS[0]][key] if complete else None
        for key in metrics[VARIANTS[0]]
    }
    return {
        "reportId": report_id(report),
        "totalCases": len(report["cases"]),
        "fullyRatedCases": complete,
        "totalPairs": len(expected),
        "judgedPairs": len(ratings),
        "unjudgedPairs": len(expected) - len(ratings),
        "relevance": means,
        "candidateMinusBaseline": delta,
        "structuralOnly": structural,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "score"))
    parser.add_argument("report", type=Path)
    parser.add_argument("ratings", type=Path)
    args = parser.parse_args()
    report = load_report(args.report)
    if args.command == "prepare":
        # Never overwrite manual judgments when regenerating a template.
        with args.ratings.open("x", encoding="utf-8-sig", newline="") as output:
            output.write(prepare(report))
        print(f"Prepared {len(pairs(report))} blind judgments in {args.ratings}")
    else:
        ratings = read_ratings(report, args.ratings.read_text(encoding="utf-8-sig"))
        print(json.dumps(score(report, ratings), indent=2, allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"Recommendation evaluation failed: {error}", file=sys.stderr)
        sys.exit(1)
