// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { afterEach, expect, it, vi } from "vitest";
import { readPersistedPlayer } from "./usePlayerStorage";

afterEach(() => vi.unstubAllGlobals());

it("does not restore another user's queue or the legacy shared queue", () => {
  const privateQueue = JSON.stringify({ queue: [{ id: "private-alice-track" }], index: 0 });
  const data = new Map([
    ["music-streaming.player", privateQueue],
    ["music-streaming.player:alice", privateQueue],
  ]);
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      removeItem: (key: string) => data.delete(key),
    },
  });

  expect(readPersistedPlayer("bob")).toBeNull();
  expect(readPersistedPlayer(null)).toBeNull();
  expect(readPersistedPlayer("alice")?.queue[0].id).toBe("private-alice-track");
  expect(data.has("music-streaming.player")).toBe(false);
});
