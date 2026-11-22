// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, expect, it, vi } from "vitest";
import { request } from "@/lib/http";
import { importVkMusic, searchVkMusic } from "./vkMusic";

vi.mock("@/lib/http", () => ({ request: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("keeps safe VK covers and supports results from older extensions", async () => {
  const track = {
    id: "-42_17",
    title: "Track",
    artist: "Artist",
    duration: 179,
    restricted: false,
  };
  const coverUrl = "https://sun9-1.userapi.com/cover.jpg";
  vi.stubGlobal("window", {
    setTimeout,
    clearTimeout,
    chrome: {
      runtime: {
        sendMessage: (_extension: string, _message: unknown, callback: (data: unknown) => void) =>
          callback({
            tracks: [
              { ...track, coverUrl },
              { ...track, id: "-42_18", coverUrl: "https://userapi.com.example.test/cover.jpg" },
              { ...track, id: "-42_19" },
            ],
          }),
      },
    },
  });

  await expect(searchVkMusic("track")).resolves.toEqual([
    { ...track, coverUrl },
    { ...track, id: "-42_18" },
    { ...track, id: "-42_19" },
  ]);
});

it.each([
  { album: "Hunter x Hunter OST", cover: "AQID" },
  { album: undefined, cover: undefined },
])("uploads audio with album $album", async ({ album, cover }) => {
  const reply = {
    artist: "Hirano Yoshihisa",
    title: "Kingdom of Predators",
    audio: "AA==",
    format: "mp3",
    album,
    cover,
  };
  vi.stubGlobal("window", {
    setTimeout,
    clearTimeout,
    chrome: {
      runtime: {
        sendMessage: (_extension: string, _message: unknown, callback: (data: unknown) => void) =>
          callback(reply),
      },
    },
  });
  await importVkMusic(reply.title, "-42_17", vi.fn());

  const [path, options] = vi.mocked(request).mock.calls[0];
  expect(path).toBe("/integrations/vk-music/import");
  expect(options?.body).toBeInstanceOf(FormData);
  const form = options?.body as FormData;
  expect(form.get("album")).toBe(album ?? null);
  if (cover) {
    const artwork = form.get("cover") as Blob;
    expect(new Uint8Array(await artwork.arrayBuffer())).toEqual(Uint8Array.of(1, 2, 3));
  } else {
    expect(form.has("cover")).toBe(false);
  }
});
