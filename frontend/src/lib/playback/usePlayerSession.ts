// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { useEffect, useState } from "react";
import type { RadioSessionState } from "./playerTypes";
import { readPersistedPlayer, usePersistedPlayer, type PersistedPlayer } from "./usePlayerStorage";

export function usePlayerSession(
  userId: string | null,
  snapshot: PersistedPlayer,
  isPlaying: boolean,
  {
    restoreQueue,
    restorePreferences,
    restoreRadio,
    resumeAt,
  }: {
    restoreQueue: (saved: PersistedPlayer) => void;
    restorePreferences: (saved: PersistedPlayer) => void;
    restoreRadio: (saved: RadioSessionState) => void;
    resumeAt: (id: string | undefined, seconds: number) => void;
  },
) {
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const saved = readPersistedPlayer(userId);
    if (saved) {
      restoreQueue(saved);
      restorePreferences(saved);
      if (saved.index >= 0) resumeAt(saved.queue[saved.index].id, saved.position);
      if (saved.radioSession) restoreRadio(saved.radioSession);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRestored(true);
  }, [userId, restoreQueue, restorePreferences, restoreRadio, resumeAt]);
  usePersistedPlayer(userId, snapshot, restored, isPlaying);
}
