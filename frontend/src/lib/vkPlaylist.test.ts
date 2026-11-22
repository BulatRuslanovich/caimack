// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import type { Track } from "@/lib/types";
import { VkMusicError, getVkPlaylist, importVkPlaylistTrack } from "@/lib/vkMusic";
import { importVkPlaylist, vkPlaylistSource } from "./vkPlaylist";

vi.mock("@/lib/api", () => ({
  api: { checkUpload: vi.fn(), createPlaylistWithTracks: vi.fn() },
}));
vi.mock("@/lib/vkMusic", async (original) => ({
  ...(await original<typeof import("@/lib/vkMusic")>()),
  getVkPlaylist: vi.fn(),
  importVkPlaylistTrack: vi.fn(),
}));

function libraryTrack(id: string): Track {
  return {
    id,
    title: id,
    artistId: "artist",
    artistName: "Artist",
    durationSeconds: 180,
    originalFileName: `${id}.mp3`,
    isFavorite: false,
    hasCover: false,
    hasLyrics: false,
    createdAt: "2026-01-01",
  };
}

it("accepts a VK playlist link with an access key and rejects other hosts", () => {
  expect(vkPlaylistSource("https://vk.ru/music/playlist/123_2_a09f?ref=music")).toBe("123_2_a09f");
  expect(vkPlaylistSource("https://vk.com/music/playlist/-42_17/")).toBe("-42_17");
  expect(vkPlaylistSource("https://vk.ru.example.com/music/playlist/123_2")).toBeNull();
  expect(vkPlaylistSource("https://vk.ru/audio")).toBeNull();
});

it("creates one playlist in VK order from new and existing tracks", async () => {
  const tracks = [
    { id: "-42_17", title: "First", artist: "Artist", duration: 180, restricted: false },
    { id: "-42_18", title: "Second", artist: "Artist", duration: 192, restricted: true },
    { id: "-42_19", title: "Third", artist: "Artist", duration: 194, restricted: false },
  ];
  vi.mocked(getVkPlaylist).mockResolvedValue({ name: "Mix", tracks, omitted: 1 });
  vi.mocked(api.checkUpload).mockResolvedValue({
    files: [
      { fileName: "First.mp3", verdict: "New", basis: "Tags" },
      { fileName: "Second.mp3", verdict: "Duplicate", basis: "Tags", match: libraryTrack("local") },
      { fileName: "Third.mp3", verdict: "New", basis: "Tags" },
    ],
  });
  vi.mocked(importVkPlaylistTrack)
    .mockResolvedValueOnce({ uploaded: [libraryTrack("imported")], failed: [] })
    .mockRejectedValueOnce(new VkMusicError("mediaPlayerOnly"));
  vi.mocked(api.createPlaylistWithTracks).mockResolvedValue({
    id: "playlist",
    name: "Mix",
    trackCount: 2,
    durationSeconds: 360,
    isPublic: false,
    ownerId: "user",
    ownerName: "listener",
    hasCover: false,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  });

  const progress = vi.fn();
  const result = await importVkPlaylist("123_2_a09f", progress);
  expect(api.createPlaylistWithTracks).toHaveBeenCalledExactlyOnceWith("Mix", [
    "imported",
    "local",
  ]);
  expect(importVkPlaylistTrack).not.toHaveBeenCalledWith("123_2_a09f", "-42_18");
  expect(result).toMatchObject({
    playlist: { id: "playlist" },
    skipped: ["Third — Artist"],
    omitted: 1,
  });
  expect(progress).toHaveBeenLastCalledWith({ current: 3, total: 3, title: "Third" });
});
