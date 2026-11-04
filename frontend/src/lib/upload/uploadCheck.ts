// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { api } from "@/lib/api";
import { mapConcurrent } from "./upload";
import { readAudioTags } from "./audioTags";
import { sha256File } from "./fileHash";
import type { HashResponse } from "./fileHash.worker";
import type { Track, UploadProbeBasis, UploadProbeFile, UploadProbeVerdict } from "@/lib/types";

export type FileCheck =
  | { state: "checked"; verdict: UploadProbeVerdict; basis: UploadProbeBasis; match: Track | null }
  | { state: "failed" };

const HASH_CONCURRENCY = 2;

let hashWorker: Worker | null = null;
let nextHashId = 0;
const pendingHashes = new Map<number, (hash?: string) => void>();

export function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function isDuplicate(check: FileCheck | undefined): boolean {
  return check?.state === "checked" && check.verdict === "Duplicate";
}

export async function findInLibrary(file: File): Promise<Track | null> {
  const check = (await checkAgainstLibrary([file]))[fileKey(file)];

  return check?.state === "checked" && check.verdict === "Duplicate" ? check.match : null;
}

export async function checkAgainstLibrary(files: File[]): Promise<Record<string, FileCheck>> {
  const checks: Record<string, FileCheck> = {};

  try {
    const result = await api.checkUpload(await describeAll(files));

    result.files.forEach((entry, index) => {
      const file = files[index];
      if (!file) return;

      checks[fileKey(file)] = {
        state: "checked",
        verdict: entry.verdict,
        basis: entry.basis,
        match: entry.match ?? null,
      };
    });
  } catch {}

  for (const file of files) checks[fileKey(file)] ??= { state: "failed" };

  return checks;
}

function describeAll(files: File[]): Promise<UploadProbeFile[]> {
  return mapConcurrent(files, HASH_CONCURRENCY, describe);
}

async function describe(file: File): Promise<UploadProbeFile> {
  const tags = await readAudioTags(file);

  return {
    fileName: file.name,
    contentHash: await sha256Hex(file),
    title: tags.title,
    artist: tags.artist,
  };
}

async function sha256Hex(file: File): Promise<string | undefined> {
  try {
    if (typeof Worker === "undefined") return await sha256File(file);

    const worker = (hashWorker ??= createHashWorker());
    const id = nextHashId++;

    return await new Promise<string | undefined>((resolve) => {
      pendingHashes.set(id, resolve);
      worker.postMessage({ id, file });
    });
  } catch {
    return undefined;
  }
}

function createHashWorker(): Worker {
  const worker = new Worker(new URL("./fileHash.worker.ts", import.meta.url), { type: "module" });

  worker.addEventListener("message", (event: MessageEvent<HashResponse>) => {
    const { id, hash } = event.data;
    const resolve = pendingHashes.get(id);
    if (!resolve) return;

    pendingHashes.delete(id);
    resolve(hash);
  });

  worker.addEventListener("error", () => {
    for (const resolve of pendingHashes.values()) resolve(undefined);
    pendingHashes.clear();
    hashWorker = null;
    worker.terminate();
  });

  return worker;
}
