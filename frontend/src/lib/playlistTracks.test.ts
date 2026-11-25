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

it("reverses known values while keeping ties stable and incomplete metadata last", () => {
  const tracks = [
    { id: "a", albumTitle: "Album 10", year: 2020, durationSeconds: 20 },
    { id: "b", albumTitle: "Album 2", year: 2021, durationSeconds: 30 },
    { id: "c", albumTitle: "Album 2", year: 2021, durationSeconds: 30 },
    { id: "d", durationSeconds: 10 },
  ] as Track[];
  const playlist = {
    tracks,
    trackAddedAt: { a: "2026-01-02T00:00:00Z", c: "2026-01-01T00:00:00Z" },
  };
  const sorted = (
    mode: Parameters<typeof sortPlaylistTracks>[1],
    direction: Parameters<typeof sortPlaylistTracks>[3],
  ) => sortPlaylistTracks(playlist, mode, "en", direction).map(({ id }) => id);

  expect(sorted("album", "asc")).toEqual(["b", "c", "a", "d"]);
  expect(sorted("album", "desc")).toEqual(["a", "b", "c", "d"]);
  expect(sorted("year", "desc")).toEqual(["b", "c", "a", "d"]);
  expect(sorted("added", "asc")).toEqual(["c", "a", "b", "d"]);
  expect(sorted("duration", "desc")).toEqual(["b", "c", "a", "d"]);
  expect(sortPlaylistTracks(playlist, "manual", "en", "desc")).toBe(tracks);
});
