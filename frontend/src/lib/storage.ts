// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

type StorageArea = "local" | "session";

function areaOf(kind: StorageArea): Storage | null {
  try {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

export function readStored(key: string, kind: StorageArea = "local"): string | null {
  try {
    return areaOf(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string | null, kind: StorageArea = "local"): void {
  try {
    const area = areaOf(kind);
    if (value === null) area?.removeItem(key);
    else area?.setItem(key, value);
  } catch {}
}

export function readStoredJson(key: string, kind: StorageArea = "local"): unknown {
  const raw = readStored(key, kind);
  if (raw === null) return null;

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    writeStored(key, null, kind);
    return null;
  }
}

export function writeStoredJson(key: string, value: unknown, kind: StorageArea = "local"): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return;
  }

  writeStored(key, serialized, kind);
}
