// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useCallback, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { deviceId } from "@/lib/events";
import { deviceName } from "@/lib/playback/deviceName";
import { reportQueue } from "@/lib/playback/reportQueue";
import type { RepeatMode } from "@/lib/playback/playerTypes";
import type { Track } from "@/lib/types";

const REPORT_INTERVAL_MS = 10_000;

interface PlaybackReportSource {
  queue: Track[];
  currentIndex: number;
  isPlaying: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  getPosition: () => number;
}

export function usePlaybackReport(source: PlaybackReportSource): () => void {
  const latest = useRef(source);
  useEffect(() => {
    latest.current = source;
  });

  const report = useCallback(() => {
    const { queue, currentIndex, isPlaying, shuffle, repeat, getPosition } = latest.current;
    if (currentIndex < 0 || currentIndex >= queue.length) return;

    void api
      .reportPlayback({
        deviceId: deviceId(),
        deviceName: deviceName(),
        ...reportQueue(queue, currentIndex),
        positionSeconds: getPosition(),
        isPlaying,
        shuffle,
        repeat,
      })
      .catch(() => {});
  }, []);

  const { queue, currentIndex, isPlaying } = source;

  useEffect(() => {
    if (!isPlaying) return;

    report();
    const timer = window.setInterval(report, REPORT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isPlaying, queue, currentIndex, report]);

  const wasPlaying = useRef(false);
  useEffect(() => {
    if (wasPlaying.current && !isPlaying) report();
    wasPlaying.current = isPlaying;
  }, [isPlaying, report]);

  return report;
}
