// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { useCallback, useState } from "react";
import type { PersistedPlayer } from "./usePlayerStorage";

export function usePlaybackPreferences() {
  const [volume, setVolumeState] = useState(1);
  const [muted, setMuted] = useState(false);
  const [crossfade, setCrossfade] = useState(0);
  const [smartTransitions, setSmartTransitions] = useState(true);
  const [normalizeVolume, setNormalizeVolume] = useState(false);
  const [autoplay, setAutoplay] = useState(true);
  const restorePreferences = useCallback((saved: PersistedPlayer) => {
    setVolumeState(saved.volume);
    setMuted(saved.muted);
    setCrossfade(saved.crossfade);
    setSmartTransitions(saved.smartTransitions);
    setNormalizeVolume(saved.normalizeVolume);
    setAutoplay(saved.autoplay);
  }, []);
  return {
    volume,
    setVolumeState,
    muted,
    setMuted,
    crossfade,
    setCrossfade,
    smartTransitions,
    setSmartTransitions,
    normalizeVolume,
    setNormalizeVolume,
    autoplay,
    setAutoplay,
    restorePreferences,
  };
}
