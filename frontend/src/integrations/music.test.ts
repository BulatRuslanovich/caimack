// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it, vi } from "vitest";
import { isMusicLink, searchMusic } from "./music";
import { fetchWithSession } from "@/lib/http";

vi.mock("@/lib/http", () => ({ API_BASE: "/api", fetchWithSession: vi.fn() }));

it("routes pasted web links to the shared import instead of text search", () => {
  expect(
    isMusicLink("https://open.spotify.com/intl-de/playlist/0123456789012345678901?si=test"),
  ).toBe(true);
  expect(isMusicLink("https://music.yandex.ru/users/user/playlists/3")).toBe(true);
  expect(isMusicLink("https://vk.com/music/playlist/-1_4")).toBe(true);
  expect(isMusicLink("Last Christmas Wham!")).toBe(false);
  expect(isMusicLink("file:///tmp/playlist")).toBe(false);
});

it("delivers one source while the next source is still streaming", async () => {
  const bytes = new TextEncoder();
  let feed!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      feed = controller;
    },
  });
  vi.mocked(fetchWithSession).mockResolvedValue(new Response(stream));
  const events: string[] = [];
  const first = Promise.withResolvers<void>();
  const search = searchMusic(
    "Artist Window",
    ["vk", "yandex"],
    new AbortController().signal,
    (event) => {
      events.push(event.source);
      first.resolve();
    },
  );
  feed.enqueue(bytes.encode('{"source":"vk","groups":[]}' + "\n" + '{"source":'));
  await first.promise;
  expect(events).toEqual(["vk"]);
  feed.enqueue(bytes.encode('"yandex","groups":[]}' + "\n"));
  feed.close();
  await search;
  expect(events).toEqual(["vk", "yandex"]);
});
