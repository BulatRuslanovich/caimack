// SPDX-License-Identifier: AGPL-3.0-only

import type { PlaylistDetail, PlaylistMembership } from "./types";

export const playlistSortOptions = {
  manual: "playlists.sort.manual",
  title: "playlists.sort.title",
  artist: "playlists.sort.artist",
  added: "playlists.sort.added",
  duration: "playlists.sort.duration",
} as const;

export type PlaylistSort = keyof typeof playlistSortOptions;

export function sortPlaylistTracks(
  playlist: Pick<PlaylistDetail, "tracks" | "trackAddedAt">,
  sort: PlaylistSort,
  locale: string,
) {
  const { tracks, trackAddedAt } = playlist;
  switch (sort) {
    case "manual":
      return tracks;
    case "title":
    case "artist": {
      const { compare } = new Intl.Collator(locale);
      const field = sort === "title" ? "title" : "artistName";
      return tracks.toSorted((a, b) => compare(a[field], b[field]));
    }
    case "added": {
      const dates = new Map<string, number>();
      for (const [id, date] of Object.entries(trackAddedAt ?? {})) {
        const time = Date.parse(date);
        if (Number.isFinite(time)) dates.set(id, time);
      }
      const dateOf = (id: string) => dates.get(id) ?? -Infinity;
      return tracks.toSorted((a, b) => dateOf(b.id) - dateOf(a.id));
    }
    case "duration":
      return tracks.toSorted((a, b) => a.durationSeconds - b.durationSeconds);
  }
}

export function restoredPlaylistOrder(current: string[], trackId: string, original: string[]) {
  const position = original.indexOf(trackId);
  if (position < 0 || !current.includes(trackId)) return current;

  const remaining = current.filter((id) => id !== trackId);
  const available = new Set(remaining);
  const previous = original.slice(0, position).findLast((id) => available.has(id));
  const next = original.slice(position + 1).find((id) => available.has(id));
  const index = previous ? remaining.indexOf(previous) + 1 : next ? remaining.indexOf(next) : 0;
  remaining.splice(index, 0, trackId);
  return remaining;
}

export async function savePlaylistMemberships(
  rows: PlaylistMembership[],
  desired: ReadonlyMap<string, boolean>,
  change: (id: string, present: boolean) => Promise<unknown>,
) {
  const edits = rows.flatMap(({ playlist, containsTrack }) => {
    const present = desired.get(playlist.id);
    return present === undefined || present === containsTrack ? [] : [{ id: playlist.id, present }];
  });
  const results = await Promise.allSettled(
    edits.map(async ({ id, present }) => change(id, present)),
  );
  const saved = new Map<string, boolean>();
  const failed = new Set<string>();
  edits.forEach(({ id, present }, index) => {
    if (results[index].status === "fulfilled") saved.set(id, present);
    else failed.add(id);
  });
  return { saved, failed };
}
