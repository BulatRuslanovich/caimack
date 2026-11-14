// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich
"use client";

import { usePlayerClock } from "@/contexts/PlayerContext";
import type { Rgb } from "@/lib/cssColor";
import { trackCoverUrl } from "@/lib/media";
import { audioAnalyser } from "@/lib/playback/equalizer";
import { bandBins, bandLevel, beatPulse } from "@/lib/playback/spectrum";
import { type PlayerEffect } from "@/lib/playerEffects";
import type { Track } from "@/lib/types";
import { AudioMotion, MOTION_BANDS } from "@/lib/visuals/audioMotion";
import { effectPalette, type EffectPalette } from "@/lib/visuals/effectPalette";
import { createEffectsRenderer } from "@/lib/visuals/reactiveEffectsRenderer";
import { useEffect, useLayoutEffect, useRef } from "react";

export function EffectCanvas({
  effect,
  intensity,
  sensitivity,
  track,
  playing,
  frozen = false,
}: {
  effect: PlayerEffect;
  intensity: number;
  sensitivity: number;
  track: Track;
  playing: boolean;
  frozen?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const getPosition = usePlayerClock();
  const source = trackCoverUrl(track, "thumb");
  const live = useRef({
    effect,
    intensity,
    sensitivity,
    playing,
    frozen,
    bpm: track.cues?.bpm,
    offset: track.cues?.audioStart,
    getPosition,
  });
  const wake = useRef(() => {});

  useLayoutEffect(() => {
    live.current = {
      effect,
      intensity,
      sensitivity,
      playing,
      frozen,
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
    frozen,
    track.cues?.bpm,
    track.cues?.audioStart,
    getPosition,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer = createEffectsRenderer(canvas, track.id);
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
    const dynamics = new AudioMotion();
    let data: Uint8Array<ArrayBuffer> | null = null;
    let waveform: Float32Array<ArrayBuffer> | null = null;
    const spectrum = new Float32Array(MOTION_BANDS);
    let ranges: [number, number][] = [];
    let spectrumAnalyser: AnalyserNode | null = null;
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
      if (live.current.frozen) return;
      const box = canvas.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const ratio = Math.min(
        1.25,
        window.devicePixelRatio || 1,
        Math.sqrt(650_000 / (box.width * box.height)),
      );
      const width = Math.max(1, Math.round(box.width * ratio));
      const height = Math.max(1, Math.round(box.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      schedule();
    };
    const draw = (now: number) => {
      frame = 0;
      if (disposed || document.visibilityState !== "visible" || !renderer || live.current.frozen)
        return;
      if (previous && now - previous < 1000 / 30 && live.current.playing && !motion.matches) {
        schedule();
        return;
      }
      const delta = Math.min(0.1, previous ? (now - previous) / 1000 : 1 / 30);
      previous = now;
      const current = live.current;
      const analyser = current.playing && !motion.matches ? audioAnalyser("transients") : null;
      let low = 0,
        middle = 0,
        treble = 0;
      spectrum.fill(0);
      let rms: number | undefined;
      if (analyser) {
        if (spectrumAnalyser !== analyser) {
          ranges = bandBins(MOTION_BANDS, analyser.context.sampleRate, analyser.fftSize);
          spectrumAnalyser = analyser;
        }
        if (!data || data.length !== analyser.frequencyBinCount)
          data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        if (!waveform || waveform.length !== analyser.fftSize)
          waveform = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(waveform);
        let squares = 0;
        for (const value of waveform) squares += value * value;
        rms = Math.sqrt(squares / waveform.length);
        const hz = analyser.context.sampleRate / analyser.fftSize;
        const range = (from: number, to: number): [number, number] => [
          Math.min(data!.length - 1, Math.max(0, Math.floor(from / hz))),
          Math.min(data!.length, Math.max(1, Math.ceil(to / hz))),
        ];
        low = bandLevel(data, range(40, 180));
        middle = bandLevel(data, range(220, 2400));
        treble = bandLevel(data, range(3000, 11_000));
        ranges.forEach((bins, i) => (spectrum[i] = bandLevel(data!, bins)));
      } else if (current.playing && current.bpm && !motion.matches) {
        const beat = beatPulse(current.getPosition(), current.bpm, current.offset ?? 0);
        low = beat * 0.45;
        middle = beat * 0.2;
        treble = beat * 0.12;
      }
      const active = current.playing && !motion.matches;
      const response = dynamics.step(
        [low, middle, treble],
        delta,
        current.sensitivity,
        active,
        spectrum,
        rms,
      );
      renderer.draw({
        effect: current.effect,
        intensity: current.intensity / 100,
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
      if (live.current.playing && !motion.matches) audioAnalyser("transients");
      schedule();
    };
    const lost = (event: Event) => {
      event.preventDefault();
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const restored = () => {
      renderer?.destroy();
      renderer = createEffectsRenderer(canvas, track.id);
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
  }, [source, track.id]);

  return (
    <canvas
      ref={canvasRef}
      className="player-effects-backdrop"
      data-player-effect={effect}
      aria-hidden="true"
    />
  );
}
