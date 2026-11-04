// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import type { AdaptivePlayback } from "@/lib/playback/adaptivePlayback";
import type { AudioQuality } from "@/lib/types";

export function bufferedAhead(audio: Pick<HTMLMediaElement, "buffered" | "currentTime">): number {
  for (let index = 0; index < audio.buffered.length; index++) {
    if (
      audio.buffered.start(index) <= audio.currentTime &&
      audio.buffered.end(index) >= audio.currentTime
    ) {
      return audio.buffered.end(index) - audio.currentTime;
    }
  }
  return 0;
}

export function sourceKeyOf(
  trackId: string,
  quality: AudioQuality,
  forceAdaptive: boolean,
  revision: number,
): string {
  return `${trackId}:${quality}:${forceAdaptive ? "adaptive" : "direct"}:${revision}`;
}

export function silence(audio: HTMLAudioElement, playback: AdaptivePlayback | null): void {
  playback?.destroy();
  audio.pause();
  audio.removeAttribute("src");
  audio.load();

  delete audio.dataset.trackId;
  delete audio.dataset.sourceKey;
  delete audio.dataset.sourceLoading;
  delete audio.dataset.playbackMode;
  delete audio.dataset.streamKbps;
  delete audio.dataset.streamReduced;
}
