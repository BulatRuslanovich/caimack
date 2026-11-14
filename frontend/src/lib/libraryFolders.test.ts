// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from "vitest";
import { canMoveFolder, folderTrail } from "./libraryFolders";
const folders = [
  { id: "a", name: "A", parentId: null, createdAt: "" },
  { id: "b", name: "B", parentId: "a", createdAt: "" },
  { id: "c", name: "C", parentId: "b", createdAt: "" },
  { id: "d", name: "D", parentId: null, createdAt: "" },
];
describe("library folder navigation", () => {
  it("builds the breadcrumb and disallows self and descendant destinations", () => {
    expect(folderTrail(folders, "c").map((f) => f.name)).toEqual(["A", "B", "C"]);
    expect(canMoveFolder(folders, "a", "c")).toBe(false);
    expect(canMoveFolder(folders, "a", "a")).toBe(false);
    expect(canMoveFolder(folders, "b", "d")).toBe(true);
    expect(canMoveFolder(folders, "b", null)).toBe(true);
  });
  it("handles a removed ancestor or a malformed cycle without hanging", () => {
    expect(folderTrail(folders.slice(1), "c").map((f) => f.name)).toEqual(["B", "C"]);
    expect(folderTrail([{ ...folders[0], parentId: "b" }, folders[1]], "b")).toHaveLength(2);
    expect(folderTrail(folders, "missing")).toEqual([]);
  });
});
