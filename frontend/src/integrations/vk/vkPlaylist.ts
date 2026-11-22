// SPDX-License-Identifier: AGPL-3.0-only

import { api } from "@/lib/api";
import type { Playlist, UploadProbeFile } from "@/lib/types";
import { VkMusicError, getVkPlaylist, importVkPlaylistTrack } from "./vkMusic";

type TrackProgress = { current: number; total: number; title: string };

export interface VkPlaylistImportResult {
  playlist: Playlist | null;
  skipped: string[];
  omitted: number;
}

export function vkPlaylistSource(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (
      url.protocol !== "https:" ||
      !["vk.ru", "vk.com"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    return (
      /^\/music\/playlist\/(-?\d{1,20}_\d{1,20}(?:_[A-Za-z0-9-]{1,128})?)\/?$/.exec(
        url.pathname,
      )?.[1] ?? null
    );
  } catch {
    return null;
  }
}

export async function importVkPlaylist(
  source: string,
  onProgress: (progress: TrackProgress) => void,
): Promise<VkPlaylistImportResult> {
  const { name, tracks, omitted } = await getVkPlaylist(source);
  if (!tracks.length) return { playlist: null, skipped: [], omitted };

  const files: UploadProbeFile[] = tracks.map(({ title, artist }) => ({
    fileName: `${artist} - ${title}.mp3`,
    title,
    artist,
  }));
  const { files: matches } = await api.checkUpload(files);
  const ids = new Set<string>();
  const skipped: string[] = [];

  for (const [index, track] of tracks.entries()) {
    onProgress({ current: index + 1, total: tracks.length, title: track.title });
    const match = matches[index]?.match;
    if (match) {
      ids.add(match.id);
      continue;
    }

    if (!track.restricted) {
      try {
        const { uploaded } = await importVkPlaylistTrack(source, track.id);
        const linked = uploaded[0] ?? (await api.checkUpload([files[index]])).files[0]?.match;
        if (linked) {
          ids.add(linked.id);
          continue;
        }
      } catch (error) {
        if (!(error instanceof VkMusicError)) throw error;
        if (
          ![
            "mediaDenied",
            "mediaExpired",
            "mediaHost",
            "mediaMissing",
            "mediaNetwork",
            "mediaPlayerOnly",
            "tooLarge",
            "unavailable",
            "unsupported",
          ].includes(error.code)
        )
          throw error;
      }
    }
    skipped.push(`${track.title} — ${track.artist}`);
  }

  const playlist = ids.size ? await api.createPlaylistWithTracks(name, [...ids]) : null;
  return { playlist, skipped, omitted };
}
