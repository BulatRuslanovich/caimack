// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { optimisticLibraryChange } from "./libraryOptimistic";
import type { LibraryFolder, LibraryItem } from "./types";

const album: LibraryItem = {
  id: "a",
  kind: "album",
  title: "Album",
  subtitle: "Artist",
  hasImage: false,
  coverTrackId: null,
  savedAt: "2026-01-01T00:00:00Z",
  folderId: null,
};

describe("optimistic library moves", () => {
  it("removes the item from the old folder immediately and can restore it after rejection", async () => {
    const client = new QueryClient();
    const items: LibraryItem[] = [album, { ...album, kind: "artist" }];
    client.setQueryData(["savedLibrary"], items);
    const rollback = await optimisticLibraryChange(client, {
      operation: "moveItem",
      kind: "album",
      id: "a",
      folderId: "folder",
    });
    const moved = client.getQueryData<LibraryItem[]>(["savedLibrary"])!;
    expect(moved.filter((item) => item.folderId === null)).toEqual([items[1]]);
    expect(moved.filter((item) => item.folderId === "folder")).toEqual([
      { ...album, folderId: "folder" },
    ]);
    client.setQueryData(rollback!.queryKey, rollback!.previous);
    expect(client.getQueryData(["savedLibrary"])).toEqual(items);
    client.clear();
  });

  it("moves folders to their new parent, including back to the library root", async () => {
    const client = new QueryClient();
    const folders: LibraryFolder[] = [
      { id: "a", name: "A", parentId: null, createdAt: album.savedAt },
      { id: "b", name: "B", parentId: null, createdAt: album.savedAt },
    ];
    client.setQueryData(["libraryFolders"], folders);
    await optimisticLibraryChange(client, { operation: "moveFolder", id: "a", folderId: "b" });
    expect(client.getQueryData(["libraryFolders"])).toEqual([
      { ...folders[0], parentId: "b" },
      folders[1],
    ]);
    await optimisticLibraryChange(client, { operation: "moveFolder", id: "a", folderId: null });
    expect(client.getQueryData(["libraryFolders"])).toEqual(folders);
    client.clear();
  });

  it("keeps the saved order of other folders when reordering one folder", async () => {
    const client = new QueryClient();
    client.setQueryData(["libraryOrder"], { root: ["favorites"], folder: ["album:a", "album:b"] });
    await optimisticLibraryChange(client, {
      operation: "reorder",
      folderId: "folder",
      order: ["album:b", "album:a"],
    });
    expect(client.getQueryData(["libraryOrder"])).toEqual({
      root: ["favorites"],
      folder: ["album:b", "album:a"],
    });
    client.clear();
  });
});
