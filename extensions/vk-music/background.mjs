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
  if (message.action === "status") {
    checkVkConnection().then(reply, () => reply({ error: "vkChanged" }));
    return true;
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
      const tab = await findVkTab(playlist);
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


async function findVkTab(playlist) {
  const tabs = await chrome.tabs.query({ url: VK_SITES });
  const path = playlist ? `/music/playlist/${playlist}` : null;
  return (
    tabs.find(({ url }) => url && new URL(url).pathname.replace(/\/$/, "") === path) ??
    tabs.find(({ url }) => url && /^\/(?:audio|audios-?\d+|music(?:\/playlist\/[^/]+)?)\/?$/.test(new URL(url).pathname))
  );
}

async function checkVkConnection() {
  const tab = await findVkTab();
  if (tab?.id === undefined) return { error: "openVk" };
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: () => /^[1-9][0-9]*$/.test(String(window.vk?.id ?? "")),
  });
  return execution?.result ? { ready: true } : { error: "signInVk" };
}
