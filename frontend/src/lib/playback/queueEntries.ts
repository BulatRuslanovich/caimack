// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import type { Track } from "@/lib/types";

const ENTRY = Symbol("queue-entry");
type Entry = Track & { [ENTRY]?: string };
let sequence = 0;

export function queueEntryKey(track: Track): string {
  return (track as Entry)[ENTRY] ?? track.id;
}

export function queueEntries(tracks: Track[], previous: Track[] = []): Track[] {
  const available = new Map<string, string[]>();
  for (const track of previous) {
    const keys = available.get(track.id) ?? [];
    keys.push(queueEntryKey(track));
    available.set(track.id, keys);
  }
  const reserved = new Set(tracks.map((track) => (track as Entry)[ENTRY]).filter(Boolean));
  const used = new Set<string>();
  let changed = false;
  const entries = tracks.map((track) => {
    const own = (track as Entry)[ENTRY];
    const inherited = available.get(track.id)?.find((key) => !used.has(key) && !reserved.has(key));
    const key = own && !used.has(own) ? own : (inherited ?? `entry-${++sequence}`);
    used.add(key);
    if (own === key) return track;
    changed = true;
    return { ...track, [ENTRY]: key };
  });
  return changed ? entries : tracks;
}
