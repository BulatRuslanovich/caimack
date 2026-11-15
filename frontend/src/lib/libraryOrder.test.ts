import { describe, it, expect } from "vitest";
import { orderedKeys, mergeVisibleOrder } from "./libraryOrder";

describe("library order", () => {
  it("keeps hidden entries in place when a filtered view is reordered", () => {
    expect(
      mergeVisibleOrder(
        ["favorites", "album:a", "artist:b", "album:c", "downloads"],
        ["album:c", "album:a"],
      ),
    ).toEqual(["favorites", "album:c", "artist:b", "album:a", "downloads"]);
  });
  it("ignores removed entries, deduplicates and includes new entries", () => {
    expect(
      orderedKeys(
        ["favorites", "folder:a", "album:b", "downloads"],
        ["album:b", "gone", "album:b", "favorites"],
      ),
    ).toEqual(["album:b", "favorites", "folder:a", "downloads"]);
  });
});
