// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { latin1, readBytes } from "./fileBytes";
import { readFlacTags } from "./flac";
import { readId3Tags } from "./id3";

export type AudioTags = { title?: string; artist?: string };

const SniffBytes = 12;

export async function readAudioTags(file: File): Promise<AudioTags> {
  try {
    const head = await readBytes(file, 0, SniffBytes);
    if (head.length < SniffBytes) return {};

    if (latin1(head, 0, 3) === "ID3") return await readId3Tags(file);
    if (latin1(head, 0, 4) === "fLaC") return await readFlacTags(file);

    return {};
  } catch {
    return {};
  }
}
