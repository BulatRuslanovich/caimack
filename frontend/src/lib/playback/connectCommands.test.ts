// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { applyConnectCommand } from "./connectCommands";
import type { ConnectCommand } from "./connect";
import type { PlayerActions, PlayerState } from "./playerTypes";
import type { Track } from "@/lib/types";

vi.mock("@/lib/api", () => ({ api: { lookupTracks: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

const command: Extract<ConnectCommand, { type: "play" }> = {
  type: "play",
  trackIds: ["first", "first", "second"],
  index: 2,
  positionSeconds: 15,
  playing: true,
  shuffle: false,
  repeat: "off",
};

it("does not start a track when its lookup completes after the command was cancelled", async () => {
  const lookup = Promise.withResolvers<Track[]>();
  vi.mocked(api.lookupTracks).mockReturnValue(lookup.promise);
  const signal = new AbortController();
  const load = vi.fn();
  const applying = applyConnectCommand(
    command,
    {} as PlayerState,
    {} as PlayerActions,
    load,
    signal.signal,
  );
  signal.abort();
  lookup.resolve([{ id: "first" }, { id: "second" }] as Track[]);
  await expect(applying).rejects.toHaveProperty("name", "AbortError");
  expect(load).not.toHaveBeenCalled();
});

it("preserves repeated queue entries and their index when the catalog lookup returns another order", async () => {
  vi.mocked(api.lookupTracks).mockResolvedValue([{ id: "second" }, { id: "first" }] as Track[]);
  const load = vi.fn();
  await applyConnectCommand(command, {} as PlayerState, {} as PlayerActions, load);
  expect(load.mock.calls[0][0].map((track: Track) => track.id)).toEqual([
    "first",
    "first",
    "second",
  ]);
  expect(load.mock.calls[0][1].index).toBe(2);
});
