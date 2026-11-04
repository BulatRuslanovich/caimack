// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import { radioSource, sourceFromPath, sourceOf, tagSource } from "./playSource";

describe("playSource", () => {
  it("names the section a track was started from", () => {
    expect(sourceFromPath("/")).toBe("home");
    expect(sourceFromPath("/albums/1")).toBe("album");
    expect(sourceFromPath("/albums")).toBe("albums");
    expect(sourceFromPath("/artists/7")).toBe("artist");
    expect(sourceFromPath("/playlists/3")).toBe("playlist");
    expect(sourceFromPath("/mixes/daily")).toBe("mix:daily");
    expect(sourceFromPath("/recently-played")).toBe("history");
    expect(sourceFromPath("/search")).toBe("search");
    expect(sourceFromPath("/settings")).toBeNull();
    expect(sourceFromPath(null)).toBeNull();
  });

  it("tells radios apart", () => {
    expect(radioSource("sad")).toBe("radio:mood:sad");
    expect(radioSource(null, true)).toBe("radio:track");
    expect(radioSource()).toBe("radio");
  });

  it("keeps the latest source of a track and ignores an unknown one", () => {
    tagSource(["a", "b"], "album");
    tagSource(["a"], "queue");
    tagSource(["b"], null);

    expect(sourceOf("a")).toBe("queue");
    expect(sourceOf("b")).toBe("album");
    expect(sourceOf("never")).toBeUndefined();
  });
});
