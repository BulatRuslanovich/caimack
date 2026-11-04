#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 Bulat Ruslanovich
"""Считает направления настроений текстовой башней CLAP.

Текстовая и аудио-башни CLAP проецируют в одно пространство. Но сырая близость трека к «sad song»
говорит больше о жанре и темпе (медленное, акустика), чем о грусти: у всех музыкальных описаний есть
общая составляющая. Поэтому настроение задаётся парой: на что похоже и на что не похоже. Направление
настроения — разность средних векторов двух сторон, и счёт трека — близость к «похожему» минус близость
к «непохожему». Общая составляющая сокращается, а знак счёта сам говорит, подходит ли трек: ближе к
своей стороне, чем к противоположной.

Каждая сторона — среднее нескольких описаний (prompt ensembling): одно описание шумит, среднее
устойчивее. Описания — про звучание, а не про ситуацию: CLAP знает, как звучит «calm instrumental»,
но не знает, что такое «работа». Настроения, которые CLAP не различает («фокус» и «чилл», «в дорогу»
и всё бодрое), не держим порознь.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from transformers import ClapModel, ClapProcessor

DEFAULT_MODEL = "laion/larger_clap_music_and_speech"

MOODS: dict[str, dict[str, list[str]]] = {
    "workout": {
        "like": [
            "energetic high tempo workout music with a powerful driving beat",
            "intense pumping gym music with heavy bass",
            "fast aggressive music with a strong rhythm",
        ],
        "unlike": [
            "calm slow quiet relaxing music",
            "soft gentle acoustic ballad",
        ],
    },
    "party": {
        "like": [
            "dance party music with a catchy upbeat beat",
            "club dance music with a four on the floor kick",
            "fun danceable pop song",
        ],
        "unlike": [
            "slow sad quiet acoustic song",
            "ambient music without drums",
        ],
    },
    "chill": {
        "like": [
            "relaxed laid-back chill music",
            "calm instrumental music for studying",
            "mellow lo-fi beats",
        ],
        "unlike": [
            "loud aggressive intense fast music",
            "energetic dance music with heavy drums",
        ],
    },
    "sleep": {
        "like": [
            "very quiet slow ambient music",
            "soft gentle peaceful piano music",
            "slow dreamy calm soundscape",
        ],
        "unlike": [
            "loud energetic upbeat music with drums",
            "fast rhythmic music with vocals",
        ],
    },
    "happy": {
        "like": [
            "happy cheerful upbeat song",
            "joyful bright music in a major key",
            "feel good positive music",
        ],
        "unlike": [
            "sad melancholic song",
            "dark gloomy music in a minor key",
        ],
    },
    "sad": {
        "like": [
            "sad melancholic song",
            "heartbreaking emotional ballad",
            "dark gloomy music in a minor key",
        ],
        "unlike": [
            "happy cheerful upbeat song",
            "joyful bright music in a major key",
        ],
    },
}


def normalize(vector: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(vector)
    return vector / norm if norm > 1e-12 else vector


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    print(f"loading {args.model}")
    model = ClapModel.from_pretrained(args.model).eval()
    processor = ClapProcessor.from_pretrained(args.model)

    def side(prompts: list[str]) -> np.ndarray:
        inputs = processor(text=prompts, return_tensors="pt", padding=True)
        with torch.no_grad():
            vectors = model.get_text_features(**inputs).numpy()
        return normalize(np.stack([normalize(v) for v in vectors]).mean(axis=0))

    moods = {}
    for key, sides in MOODS.items():
        like, unlike = side(sides["like"]), side(sides["unlike"])
        moods[key] = [round(float(x), 7) for x in normalize(like - unlike)]
        print(f"  {key}: like/unlike cosine {float(like @ unlike):.3f}")

    keys = list(moods)
    matrix = np.asarray(list(moods.values()))
    print("\ncosine between mood directions:")
    print("         " + " ".join(f"{k[:7]:>7}" for k in keys))
    for k, row in zip(keys, matrix @ matrix.T):
        print(f"{k[:8]:>8} " + " ".join(f"{v:7.3f}" for v in row))

    body = ",\n".join(f"  {json.dumps(k)}: {json.dumps(v)}" for k, v in moods.items())
    args.out.write_text(f'{{\n "modelId": {json.dumps(args.model)},\n "moods": {{\n{body}\n }}\n}}\n')
    print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
