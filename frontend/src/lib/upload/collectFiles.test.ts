// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import { filesFromEntries } from "./collectFiles";

function file(name: string): FileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (resolve: (file: File) => void) => resolve(new File(["x"], name)),
  } as unknown as FileSystemFileEntry;
}

function folder(name: string, children: FileSystemEntry[], batch = 2): FileSystemDirectoryEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let offset = 0;
      return {
        readEntries: (resolve: (entries: FileSystemEntry[]) => void) => {
          resolve(children.slice(offset, offset + batch));
          offset += batch;
        },
      };
    },
  } as unknown as FileSystemDirectoryEntry;
}

const names = (files: File[]) => files.map((one) => one.name);

describe("filesFromEntries", () => {
  it("walks nested folders and keeps only audio from them", async () => {
    const files = await filesFromEntries([
      folder("Music", [
        folder("Album", [file("01.flac"), file("cover.jpg"), file("album.cue")]),
        file("single.mp3"),
        file("notes.txt"),
      ]),
    ]);

    expect(names(files)).toEqual(["01.flac", "single.mp3"]);
  });

  it("reads a folder past the first batch of entries", async () => {
    const tracks = Array.from({ length: 5 }, (_, index) => file(`${index + 1}.mp3`));

    const files = await filesFromEntries([folder("Album", tracks, 2)]);

    expect(files).toHaveLength(5);
  });

  it("orders tracks the way a person numbers them", async () => {
    const files = await filesFromEntries([
      folder("Album", [file("10.mp3"), file("2.mp3"), file("1.mp3")]),
    ]);

    expect(names(files)).toEqual(["1.mp3", "2.mp3", "10.mp3"]);
  });

  it("passes a file dropped on its own through, so the queue can explain a rejection", async () => {
    const files = await filesFromEntries([file("cover.jpg")]);

    expect(names(files)).toEqual(["cover.jpg"]);
  });
});
