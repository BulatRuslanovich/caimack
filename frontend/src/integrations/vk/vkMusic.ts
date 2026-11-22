// SPDX-License-Identifier: AGPL-3.0-only

import { request } from "@/lib/http";
import type { UploadResult } from "@/lib/types";

const EXTENSION_ID = "nboiinigncmofgemflodijebiebgkcbo";
const PROTOCOL = "caimack-vk-music-v1";
const LIMIT = 24 * 1024 * 1024;
const COVER_LIMIT = 2 * 1024 * 1024;
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
      "trackId" in message ? 65_000 : 16_000,
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

export async function importVkMusic(
  query: string,
  trackId: string,
  onUploading: () => void,
): Promise<UploadResult> {
  return uploadVkTrack(await send({ action: "import", query, trackId }), onUploading);
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

export async function importVkPlaylistTrack(
  source: string,
  trackId: string,
): Promise<UploadResult> {
  return uploadVkTrack(await send({ action: "playlistTrack", source, trackId }));
}

function uploadVkTrack(
  { artist, title, audio, format, album, cover }: Record<string, unknown>,
  onUploading?: () => void,
): Promise<UploadResult> {
  const audioBytes = decodeFile(audio, LIMIT);
  if (
    typeof artist !== "string" ||
    typeof title !== "string" ||
    (format !== "mp3" && format !== "flac" && format !== "stream") ||
    !audioBytes
  ) {
    throw new VkMusicError("unavailable");
  }
  const form = new FormData();
  form.set("title", title);
  form.set("artist", artist);
  form.set("format", format);
  form.set("audio", new Blob([audioBytes]), "audio");
  if (typeof album === "string" && album.trim()) form.set("album", album);
  const coverBytes = decodeFile(cover, COVER_LIMIT);
  if (coverBytes) form.set("cover", new Blob([coverBytes]), "cover");
  onUploading?.();
  return request<UploadResult>("/integrations/vk-music/import", { method: "POST", body: form });
}

function decodeFile(encoded: unknown, limit: number) {
  if (typeof encoded !== "string" || encoded.length > Math.ceil(limit / 3) * 4) return null;
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    return null;
  }
  if (!binary.length || binary.length > limit) return null;
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
