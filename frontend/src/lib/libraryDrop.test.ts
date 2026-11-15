// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { CollisionDetection } from "@dnd-kit/core";
import { folderDropPosition, libraryCollisionDetection } from "./libraryDrop";

describe("library drop target", () => {
  const folder = { left: 50, right: 650, top: 100, bottom: 180, width: 600, height: 80 };
  const album = { ...folder, top: 180, bottom: 260 };
  const args: Parameters<CollisionDetection>[0] = {
    active: {
      id: "album:a",
      data: { current: {} },
      rect: { current: { initial: album, translated: album } },
    },
    // The preview's centre is below the folder; the grab point is still over its artwork.
    collisionRect: album,
    droppableRects: new Map([
      ["folder:b", folder],
      ["album:a", album],
    ]),
    droppableContainers: ["folder:b", "album:a"].map((id) => ({
      id,
      key: id,
      disabled: false,
      node: { current: null },
      rect: { current: null },
      data: { current: {} },
    })),
    pointerCoordinates: { x: 70, y: 140 },
  };

  it("uses the actual grab point to select a folder instead of the preview centre", () => {
    expect(libraryCollisionDetection(args).map((hit) => hit.id)).toEqual(["folder:b"]);
    expect(folderDropPosition(folder, args.pointerCoordinates)).toBe("inside");
  });
  it("accepts drops on the icon, label and right side of a folder", () => {
    for (const x of [55, 80, 200, 640])
      expect(folderDropPosition(folder, { x, y: 140 })).toBe("inside");
  });
  it("reserves only the top and bottom edges for sorting", () => {
    expect(folderDropPosition(folder, { x: 70, y: 105 })).toBe("before");
    expect(folderDropPosition(folder, { x: 70, y: 175 })).toBe("after");
    expect(folderDropPosition(folder, null)).toBe("inside");
  });
  it("does not select the source or a nearby folder when released outside", () => {
    expect(libraryCollisionDetection({ ...args, pointerCoordinates: { x: 70, y: 220 } })).toEqual(
      [],
    );
    expect(libraryCollisionDetection({ ...args, pointerCoordinates: { x: 800, y: 140 } })).toEqual(
      [],
    );
    expect(folderDropPosition(folder, { x: 800, y: 140 })).toBeNull();
  });
});
