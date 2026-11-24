// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it, vi } from "vitest";
import { savePlaylistMemberships, sortPlaylistTracks } from "./playlistTracks";
import type { Playlist, Track } from "./types";

it("saves only changed checkboxes and retries only unconfirmed changes", async () => {
  const rows = ["addA", "addB", "remove", "unchanged"].map((id) => ({
    playlist: { id } as Playlist,
    containsTrack: id === "remove" || id === "unchanged",
  }));
  const desired = new Map([
    ["addA", true],
    ["addB", true],
    ["remove", false],
  ]);
  const change = vi
    .fn()
    .mockResolvedValueOnce({ changed: 1 })
    .mockRejectedValueOnce(new Error("temporary failure"))
    .mockResolvedValue({ changed: 1 });

  const first = await savePlaylistMemberships(rows, desired, change);
  expect(change.mock.calls).toEqual([
    ["addA", true],
    ["addB", true],
    ["remove", false],
  ]);
  expect([...first.saved]).toEqual([
    ["addA", true],
    ["remove", false],
  ]);
  expect([...first.failed]).toEqual(["addB"]);

  change.mockClear();
  const refreshed = rows.map((row) => ({
    ...row,
    containsTrack: first.saved.get(row.playlist.id) ?? row.containsTrack,
  }));
  refreshed[3].containsTrack = false; // Another client removed this untouched membership.
  const second = await savePlaylistMemberships(refreshed, desired, change);
  expect(change.mock.calls).toEqual([["addB", true]]);
  expect(second.failed.size).toBe(0);
  expect([...second.saved]).toEqual([["addB", true]]);
});

it("uses locale collation, ascending duration and newest known date without changing manual order", () => {
  const tracks = [
    { id: "one", title: "Я", artistName: "А", durationSeconds: 60 },
    { id: "two", title: "Б", artistName: "Г", durationSeconds: 10 },
    { id: "three", title: "А", artistName: "Я", durationSeconds: 20 },
    { id: "four", title: "Г", artistName: "Б", durationSeconds: 20 },
  ] as Track[];
  const playlist = {
    tracks,
    trackAddedAt: {
      one: "2026-01-05T01:00:00+03:00",
      three: "invalid",
      four: "2026-01-04T23:00:00Z",
    },
  };
  const sorted = (mode: Parameters<typeof sortPlaylistTracks>[1]) =>
    sortPlaylistTracks(playlist, mode, "ru").map(({ id }) => id);
  expect(sorted("title")).toEqual(["three", "two", "four", "one"]);
  expect(sorted("artist")).toEqual(["one", "four", "two", "three"]);
  expect(sorted("duration")).toEqual(["two", "three", "four", "one"]);
  expect(sorted("added")).toEqual(["four", "one", "two", "three"]);
  expect(sorted("manual")).toEqual(["one", "two", "three", "four"]);
  expect(sortPlaylistTracks({ tracks }, "added", "ru")).toEqual(tracks);
});
