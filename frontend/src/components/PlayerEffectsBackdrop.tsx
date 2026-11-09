// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useRef } from "react";
import { usePlayerEffects, type PlayerEffect } from "@/lib/playerEffects";
import { trackCoverUrl } from "@/lib/media";
import { audioAnalyser } from "@/lib/playback/equalizer";
import { bandLevel, beatPulse } from "@/lib/playback/spectrum";
import { effectPalette, type EffectPalette } from "@/lib/visuals/effectPalette";
import { createEffectsRenderer } from "@/lib/visuals/reactiveEffectsRenderer";
import { AudioMotion } from "@/lib/visuals/audioMotion";
import { usePlayerProgress } from "@/contexts/PlayerContext";
import type { Track } from "@/lib/types";
import type { Rgb } from "@/lib/cssColor";

export function PlayerEffectsBackdrop({ track, playing }: { track: Track; playing: boolean }) {
  const { effect, intensity, sensitivity } = usePlayerEffects();
  if (effect === "off" || intensity === 0) return null;
  return (
    <EffectCanvas
      effect={effect}
      intensity={intensity}
      sensitivity={sensitivity}
      track={track}
      playing={playing}
    />
  );
}

function EffectCanvas({
  effect,
  intensity,
  sensitivity,
  track,
  playing,
}: {
  effect: PlayerEffect;
  intensity: number;
  sensitivity: number;
  track: Track;
  playing: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { getPosition } = usePlayerProgress();
  const source = trackCoverUrl(track, "thumb");
  const live = useRef({
    effect,
    intensity,
    sensitivity,
    playing,
    bpm: track.cues?.bpm,
    offset: track.cues?.audioStart,
    getPosition,
  });
  const wake = useRef(() => {});

  useEffect(() => {
    live.current = {
      effect,
      intensity,
      sensitivity,
      playing,
      bpm: track.cues?.bpm,
      offset: track.cues?.audioStart,
      getPosition,
    };
    wake.current();
  }, [
    effect,
    intensity,
    sensitivity,
    playing,
    track.cues?.bpm,
    track.cues?.audioStart,
    getPosition,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer = createEffectsRenderer(canvas);
    canvas.dataset.renderer = renderer?.kind ?? "unavailable";
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sample = document.createElement("canvas");
    sample.width = sample.height = 24;
    const paint = sample.getContext("2d", { willReadFrequently: true });
    let pixels: Uint8ClampedArray | null = null;
    let palette: EffectPalette = [
      [188, 208, 232],
      [132, 179, 194],
      [237, 216, 186],
    ];
    let light = false;
    let time = 8;
    const dynamics = new AudioMotion();
    let data: Uint8Array<ArrayBuffer> | null = null;
    let previous = 0;
    let frame = 0;
    let disposed = false;

    const readPalette = () => {
      light = document.documentElement.dataset.theme === "light";
      let fallback: Rgb = [188, 208, 232];
      if (paint) {
        paint.clearRect(0, 0, 24, 24);
        paint.fillStyle = "#bcd0e8";
        paint.fillStyle = getComputedStyle(canvas).getPropertyValue("--primary").trim();
        paint.fillRect(0, 0, 1, 1);
        const rgb = paint.getImageData(0, 0, 1, 1).data;
        fallback = [rgb[0], rgb[1], rgb[2]];
      }
      palette = effectPalette(pixels ?? [], fallback);
    };

    const schedule = () => {
      if (!disposed && !frame && document.visibilityState === "visible")
        frame = requestAnimationFrame(draw);
    };
    const resize = () => {
      const box = canvas.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const ratio = Math.min(
        1.25,
        window.devicePixelRatio || 1,
        Math.sqrt(650_000 / (box.width * box.height)),
      );
      canvas.width = Math.max(1, Math.round(box.width * ratio));
      canvas.height = Math.max(1, Math.round(box.height * ratio));
      schedule();
    };
    const draw = (now: number) => {
      frame = 0;
      if (disposed || document.visibilityState !== "visible" || !renderer) return;
      if (previous && now - previous < 1000 / 30 && live.current.playing && !motion.matches) {
        schedule();
        return;
      }
      const delta = Math.min(0.1, previous ? (now - previous) / 1000 : 1 / 30);
      previous = now;
      const current = live.current;
      const analyser = current.playing && !motion.matches ? audioAnalyser() : null;
      let low = 0,
        middle = 0,
        treble = 0;
      if (analyser) {
        if (!data || data.length !== analyser.frequencyBinCount)
          data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const hz = analyser.context.sampleRate / analyser.fftSize;
        const range = (from: number, to: number): [number, number] => [
          Math.min(data!.length - 1, Math.max(0, Math.floor(from / hz))),
          Math.min(data!.length, Math.max(1, Math.ceil(to / hz))),
        ];
        low = bandLevel(data, range(40, 180));
        middle = bandLevel(data, range(220, 2400));
        treble = bandLevel(data, range(3000, 11_000));
      } else if (current.playing && current.bpm && !motion.matches) {
        const beat = beatPulse(current.getPosition(), current.bpm, current.offset ?? 0);
        low = beat * 0.45;
        middle = beat * 0.2;
        treble = beat * 0.12;
      }
      const active = current.playing && !motion.matches;
      const response = dynamics.step([low, middle, treble], delta, current.sensitivity, active);
      if (active) time += delta * (0.4 + response.mid * 0.5);
      renderer.draw({
        effect: current.effect,
        intensity: current.intensity / 100,
        time,
        delta: active ? delta : 0,
        ...response,
        palette,
        light,
      });
      if (active) schedule();
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      previous = 0;
      schedule();
    };
    const gesture = () => {
      if (live.current.playing && !motion.matches) audioAnalyser();
      schedule();
    };
    const lost = (event: Event) => {
      event.preventDefault();
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const restored = () => {
      renderer?.destroy();
      renderer = createEffectsRenderer(canvas);
      canvas.dataset.renderer = renderer?.kind ?? "unavailable";
      sync();
    };

    readPalette();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const theme = new MutationObserver(() => {
      readPalette();
      schedule();
    });
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-colorway", "style"],
    });
    let image: HTMLImageElement | null = null;
    if (source && paint) {
      image = new Image();
      image.onload = () => {
        if (disposed || !image) return;
        try {
          paint.clearRect(0, 0, 24, 24);
          paint.drawImage(image, 0, 0, 24, 24);
          pixels = paint.getImageData(0, 0, 24, 24).data;
          readPalette();
          schedule();
        } catch {
          /* A cross-origin cover can still use the interface palette. */
        }
      };
      image.src = source;
    }
    motion.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("pointerdown", gesture, true);
    window.addEventListener("keydown", gesture, true);
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);
    wake.current = schedule;
    resize();
    return () => {
      disposed = true;
      wake.current = () => {};
      cancelAnimationFrame(frame);
      observer.disconnect();
      theme.disconnect();
      motion.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pointerdown", gesture, true);
      window.removeEventListener("keydown", gesture, true);
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      if (image) image.onload = null;
      renderer?.destroy();
    };
  }, [source]);

  return (
    <canvas
      ref={canvasRef}
      className="player-effects-backdrop"
      data-player-effect={effect}
      aria-hidden="true"
    />
  );
}
