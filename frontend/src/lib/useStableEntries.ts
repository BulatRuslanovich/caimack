// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { useState } from "react";
import { queueEntries } from "./playback/queueEntries";
import type { Track } from "./types";

export function useStableEntries(tracks: Track[]) {
  const [snapshot, setSnapshot] = useState(() => ({ tracks, entries: queueEntries(tracks) }));
  if (snapshot.tracks !== tracks) {
    const next = { tracks, entries: queueEntries(tracks, snapshot.entries) };
    setSnapshot(next);
    return next.entries;
  }
  return snapshot.entries;
}
