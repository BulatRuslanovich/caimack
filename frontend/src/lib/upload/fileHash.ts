// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { createSHA256 } from "hash-wasm";

const HASH_CHUNK_BYTES = 4 * 1024 * 1024;

export async function sha256File(file: Blob): Promise<string> {
  const hasher = await createSHA256();

  for (let offset = 0; offset < file.size; offset += HASH_CHUNK_BYTES) {
    const chunk = file.slice(offset, Math.min(offset + HASH_CHUNK_BYTES, file.size));
    hasher.update(new Uint8Array(await chunk.arrayBuffer()));
  }

  return hasher.digest("hex");
}
