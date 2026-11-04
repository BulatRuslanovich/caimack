// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { isAcceptedAudio } from "@/lib/playback/audioFormats";

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function filesFromDrop(transfer: DataTransfer): Promise<File[]> {
  const items = Array.from(transfer.items).filter((item) => item.kind === "file");
  const entries = items.map((item) => item.webkitGetAsEntry?.() ?? null);

  if (entries.length === 0 || entries.some((entry) => entry === null)) {
    return Promise.resolve(Array.from(transfer.files));
  }

  return filesFromEntries(entries as FileSystemEntry[]);
}

export async function filesFromEntries(entries: FileSystemEntry[]): Promise<File[]> {
  const files: File[] = [];

  for (const entry of entries) {
    if (entry.isDirectory) files.push(...(await audioIn(entry as FileSystemDirectoryEntry)));
    else if (entry.isFile) {
      const file = await fileOf(entry as FileSystemFileEntry);
      if (file) files.push(file);
    }
  }

  return files;
}

export function audioFromFolder(files: FileList | null): File[] {
  return Array.from(files ?? [])
    .filter((file) => isAcceptedAudio(file.name))
    .sort((a, b) => byName.compare(a.webkitRelativePath, b.webkitRelativePath));
}

async function audioIn(directory: FileSystemDirectoryEntry): Promise<File[]> {
  const files: File[] = [];

  for (const entry of await readAll(directory)) {
    if (entry.isDirectory) files.push(...(await audioIn(entry as FileSystemDirectoryEntry)));
    else if (entry.isFile && isAcceptedAudio(entry.name)) {
      const file = await fileOf(entry as FileSystemFileEntry);
      if (file) files.push(file);
    }
  }

  return files;
}

async function readAll(directory: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = directory.createReader();
  const entries: FileSystemEntry[] = [];

  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) =>
      reader.readEntries(resolve, () => resolve([])),
    );
    if (batch.length === 0) break;
    entries.push(...batch);
  }

  return entries.sort((a, b) => byName.compare(a.name, b.name));
}

function fileOf(entry: FileSystemFileEntry): Promise<File | null> {
  return new Promise((resolve) => entry.file(resolve, () => resolve(null)));
}
