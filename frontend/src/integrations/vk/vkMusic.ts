// SPDX-License-Identifier: AGPL-3.0-only

const EXTENSION_ID = "nboiinigncmofgemflodijebiebgkcbo";
const PROTOCOL = "caimack-vk-music-v1";
const COVER_HOSTS = [
  "vkuserphoto.ru",
  "vkuseraudio.net",
  "vkuseraudio.ru",
  "okcdn.ru",
  "vkcdn.ru",
  "userapi.com",
];
const errors = [
  "busy",
  "invalidRequest",
  "mediaDenied",
  "mediaExpired",
  "mediaHost",
  "mediaMissing",
  "mediaNetwork",
  "mediaPlayerOnly",
  "openVk",
  "playlistExtensionUpdate",
  "playlistUnavailable",
  "signInVk",
  "tooLarge",
  "unavailable",
  "unsupported",
  "vkChanged",
] as const;

type VkError = (typeof errors)[number] | "extensionMissing";

export class VkMusicError extends Error {
  constructor(readonly code: VkError) {
    super(code);
  }
}

export interface VkTrack {
  id: string;
  title: string;
  artist: string;
  duration: number;
  restricted: boolean;
  coverUrl?: string;
}

type Message =
  | { action: "status" }
  | { action: "search"; query: string }
  | { action: "import"; query: string; trackId: string }
  | { action: "playlist"; source: string }
  | { action: "playlistTrack"; source: string; trackId: string };

type Runtime = {
  lastError?: unknown;
  sendMessage: (
    id: string,
    message: { protocol: string } & Message,
    callback: (response: unknown) => void,
  ) => void;
};

function send(message: Message): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const runtime = (window as Window & { chrome?: { runtime?: Runtime } }).chrome?.runtime;
    if (!runtime?.sendMessage) {
      reject(new VkMusicError("extensionMissing"));
      return;
    }

    const timer = window.setTimeout(
      () => reject(new VkMusicError("vkChanged")),
      message.action === "status" ? 2_000 : "trackId" in message ? 65_000 : 16_000,
    );
    try {
      runtime.sendMessage(EXTENSION_ID, { protocol: PROTOCOL, ...message }, (response) => {
        window.clearTimeout(timer);
        if (runtime.lastError || !response || typeof response !== "object") {
          reject(new VkMusicError("extensionMissing"));
          return;
        }
        const reply = response as Record<string, unknown>;
        const code = errors.find((error) => error === reply.error);
        if (code) reject(new VkMusicError(code));
        else resolve(reply);
      });
    } catch {
      window.clearTimeout(timer);
      reject(new VkMusicError("extensionMissing"));
    }
  });
}

export async function vkMusicConnection() {
  try {
    const reply = await send({ action: "status" });
    return reply.ready === true ? "ready" : "unavailable";
  } catch (error) {
    if (error instanceof VkMusicError) {
      if (error.code === "invalidRequest") return "update";
      if (error.code === "extensionMissing") return "extension";
      if (error.code === "openVk") return "openVk";
      if (error.code === "signInVk") return "signInVk";
    }
    return "unavailable";
  }
}
export type VkMusicConnection = Awaited<ReturnType<typeof vkMusicConnection>>;
export const VK_CONNECTION_QUERY = ["vk-music-connection"] as const;

function isTrack(value: unknown): value is VkTrack {
  if (!value || typeof value !== "object") return false;
  const track = value as Partial<VkTrack>;
  return (
    typeof track.id === "string" &&
    /^-?\d{1,20}_\d{1,20}$/.test(track.id) &&
    typeof track.artist === "string" &&
    typeof track.title === "string" &&
    typeof track.duration === "number" &&
    Number.isFinite(track.duration) &&
    typeof track.restricted === "boolean"
  );
}

export async function searchVkMusic(query: string): Promise<VkTrack[]> {
  const { tracks } = await send({ action: "search", query });
  if (!Array.isArray(tracks) || tracks.length > 30 || !tracks.every(isTrack)) {
    throw new VkMusicError("vkChanged");
  }
  return tracks.map(({ coverUrl, ...track }) => {
    const url = vkCoverUrl(coverUrl);
    return url ? { ...track, coverUrl: url.href } : track;
  });
}

function vkCoverUrl(value: unknown): URL | undefined {
  if (typeof value !== "string" || value.length > 4096) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return;
    if (COVER_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)))
      return url;
  } catch {
    return;
  }
}

export function fetchVkAudio(
  input: { trackId: string } & ({ query: string } | { source: string }),
) {
  return "source" in input
    ? send({ action: "playlistTrack", ...input })
    : send({ action: "import", ...input });
}

export async function getVkPlaylist(source: string) {
  const { name, tracks, omitted } = await send({ action: "playlist", source }).catch((error) => {
    if (error instanceof VkMusicError && error.code === "invalidRequest") {
      throw new VkMusicError("playlistExtensionUpdate");
    }
    throw error;
  });
  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof omitted !== "number" ||
    !Number.isSafeInteger(omitted) ||
    omitted < 0 ||
    !Array.isArray(tracks) ||
    !tracks.every(isTrack)
  ) {
    throw new VkMusicError("playlistUnavailable");
  }
  return { name, tracks, omitted };
}
