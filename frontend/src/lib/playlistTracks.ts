// SPDX-License-Identifier: AGPL-3.0-only

import type { PlaylistDetail, PlaylistMembership, SortDirection } from "./types";

export const playlistSortOptions = {
  manual: "playlists.sort.manual",
  title: "sort.title",
  artist: "sort.artist",
  album: "sort.album",
  added: "sort.dateAdded",
  year: "sort.year",
  duration: "sort.duration",
} as const;

export type PlaylistSort = keyof typeof playlistSortOptions;

export function sortPlaylistTracks(
  playlist: Pick<PlaylistDetail, "tracks" | "trackAddedAt">,
  sort: PlaylistSort,
  locale: string,
  direction: SortDirection = sort === "added" ? "desc" : "asc",
) {
  const { tracks, trackAddedAt } = playlist;
  if (sort === "manual") return tracks;

  const sign = direction === "asc" ? 1 : -1;
  const { compare } = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });

  // Keep absent metadata at the end in both directions, and keep playlist order for ties.
  function compareValues<T>(
    a: T | null | undefined,
    b: T | null | undefined,
    compare: (a: T, b: T) => number,
  ) {
    if (a == null) return b == null ? 0 : 1;
    if (b == null) return -1;
    return sign * compare(a, b);
  }

  const numeric = (a: number, b: number) => a - b;
  switch (sort) {
    case "title":
      return tracks.toSorted((a, b) => sign * compare(a.title, b.title));
    case "artist":
      return tracks.toSorted((a, b) => sign * compare(a.artistName, b.artistName));
    case "album":
      return tracks.toSorted((a, b) => compareValues(a.albumTitle, b.albumTitle, compare));
    case "added": {
      const dates = new Map<string, number>();
      for (const [id, date] of Object.entries(trackAddedAt ?? {})) {
        const time = Date.parse(date);
        if (Number.isFinite(time)) dates.set(id, time);
      }
      return tracks.toSorted((a, b) => compareValues(dates.get(a.id), dates.get(b.id), numeric));
    }
    case "year":
      return tracks.toSorted((a, b) => compareValues(a.year, b.year, numeric));
    case "duration":
      return tracks.toSorted((a, b) => sign * numeric(a.durationSeconds, b.durationSeconds));
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
