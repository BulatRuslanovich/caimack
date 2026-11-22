// SPDX-License-Identifier: AGPL-3.0-only

import { vkMusicRequest } from "./vk-page.mjs";

const VK_SITES = ["https://vk.ru/*", "https://vk.com/*"];
let busy = false;

chrome.runtime.onMessageExternal.addListener((message, sender, reply) => {
  if (
    sender.frameId !== 0 ||
    !sender.url ||
    message?.protocol !== "caimack-vk-music-v1"
  ) {
    return false;
  }
  const query = typeof message.query === "string" ? message.query.trim() : "";
  const isPlaylist =
    message.action === "playlist" || message.action === "playlistTrack";
  const playlist = isPlaylist ? message.source : null;
  const needsTrack =
    message.action === "import" || message.action === "playlistTrack";
  const trackId = needsTrack ? message.trackId : null;
  if (
    (isPlaylist
      ? typeof playlist !== "string" ||
        !/^-?\d{1,20}_\d{1,20}(?:_[A-Za-z0-9-]{1,128})?$/.test(playlist)
      : !["search", "import"].includes(message.action) ||
        query.length < 2 ||
        query.length > 200) ||
    (needsTrack &&
      (typeof trackId !== "string" || !/^-?\d{1,20}_\d{1,20}$/.test(trackId)))
  ) {
    reply({ error: "invalidRequest" });
    return false;
  }
  if (busy) {
    reply({ error: "busy" });
    return false;
  }

  busy = true;
  void (async () => {
    let response;
    try {
      const tabs = await chrome.tabs.query({ url: VK_SITES });
      const path = playlist ? `/music/playlist/${playlist}` : null;
      const tab =
        tabs.find(
          ({ url }) => url && new URL(url).pathname.replace(/\/$/, "") === path,
        ) ??
        tabs.find(
          ({ url }) =>
            url &&
            /^\/(?:audio|audios-?\d+|music(?:\/playlist\/[^/]+)?)\/?$/.test(
              new URL(url).pathname,
            ),
        );
      if (tab?.id === undefined) {
        response = { error: "openVk" };
      } else {
        const [execution] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: vkMusicRequest,
          args: [query, trackId, playlist],
        });
        response = execution?.result ?? { error: "vkChanged" };
      }
    } catch {
      response = { error: "vkChanged" };
    } finally {
      busy = false;
    }
    reply(response);
  })();
  return true;
});
