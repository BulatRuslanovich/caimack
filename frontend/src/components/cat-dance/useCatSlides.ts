// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { audioAnalyser } from "@/lib/playback/equalizer";
import { bandLevel, follow, onset } from "@/lib/playback/spectrum";
import {
  CAT_SLIDESHOW,
  CatSlideClock,
  createCatSlides,
  finishCatSlide,
  requestCatSlide,
  syncCatTrack,
} from "@/lib/catSlideshow";

export function useCatSlides({
  trackId,
  active,
  automatic,
  reduced,
  bpm,
  audioStart,
  getPosition,
}: {
  trackId: string | null;
  active: boolean;
  automatic: boolean;
  reduced: boolean;
  bpm?: number | null;
  audioStart?: number | null;
  getPosition: () => number;
}) {
  const [slides, setSlides] = useState(() => createCatSlides(trackId));
  const next = syncCatTrack(slides, trackId, automatic);
  if (next !== slides) setSlides(next);
  const live = useRef({ bpm, audioStart, getPosition });
  const clock = useRef<CatSlideClock | null>(null);
  useLayoutEffect(() => {
    live.current = { bpm, audioStart, getPosition };
  }, [bpm, audioStart, getPosition]);

  useEffect(() => {
    if (slides.previous === null) return;
    const token = slides.revision;
    const timeout = window.setTimeout(
      () => setSlides((state) => finishCatSlide(state, token)),
      reduced ? 0 : CAT_SLIDESHOW.dissolveMs,
    );
    return () => window.clearTimeout(timeout);
  }, [slides.previous, slides.revision, reduced]);

  useEffect(() => {
    clock.current = new CatSlideClock(live.current.getPosition());
    if (!active || !automatic || reduced) return;
    let frame = 0,
      previous = 0,
      average = 0;
    let data: Uint8Array<ArrayBuffer> | null = null;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - previous < 1000 / 30) return;
      previous = now;
      const { getPosition, bpm, audioStart } = live.current;
      let beat: boolean | undefined;
      // Reuse the player's analyser only when a track has no tempo metadata.
      if (!bpm) {
        const analyser = audioAnalyser("transients");
        if (analyser) {
          if (!data || data.length !== analyser.frequencyBinCount)
            data = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(data);
          const hz = analyser.context.sampleRate / analyser.fftSize;
          const bass = bandLevel(data, [
            Math.max(0, Math.floor(40 / hz)),
            Math.min(data.length, Math.ceil(180 / hz)),
          ]);
          beat = onset(bass, average) > 0.22;
          average = follow(average, bass, 0.12, 0.08);
        }
      }
      if (clock.current?.advance(getPosition(), bpm, audioStart ?? 0, beat))
        setSlides((state) => requestCatSlide(state, state.current + 1));
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [active, automatic, reduced, trackId]);

  const select = (index: number) => {
    clock.current?.reset(live.current.getPosition());
    setSlides((state) => requestCatSlide(state, index));
  };
  return { slides, select };
}
