// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, expect, it, vi } from "vitest";
import { searchVkMusic, vkMusicConnection } from "./vkMusic";

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
  [{ ready: true }, "ready"],
  [{ error: "openVk" }, "openVk"],
  [{ error: "signInVk" }, "signInVk"],
  [{ error: "invalidRequest" }, "update"],
])("reports the browser connection for %j", async (reply, status) => {
  vi.stubGlobal("window", {
    setTimeout,
    clearTimeout,
    chrome: {
      runtime: {
        sendMessage: (_extension: string, message: unknown, callback: (data: unknown) => void) => {
          expect(message).toMatchObject({ action: "status" });
          callback(reply);
        },
      },
    },
  });

  await expect(vkMusicConnection()).resolves.toBe(status);
});
