// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useEffect, useRef } from "react";
import { rgbOf, rgba, type Rgb } from "@/lib/cssColor";
import { audioAnalyser } from "@/lib/playback/equalizer";
import { bandBins, bandLevel, beatPulse, follow, onset } from "@/lib/playback/spectrum";
import { usePlayerProgress } from "@/contexts/PlayerContext";

const BANDS = 32;

const REACH = 1.32;

const BASS_HZ = 150;
const COLOR_REFRESH_FRAMES = 60;
const FRAME_MS = 1000 / 30;

export function RecordAura({
  playing,
  bpm,
  offset,
}: {
  playing: boolean;
  bpm?: number | null;
  offset?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { getPosition } = usePlayerProgress();
  const live = useRef({ playing, bpm, offset, getPosition });
  const wake = useRef<() => void>(() => {});

  useEffect(() => {
    live.current = { playing, bpm, offset, getPosition };
    wake.current();
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const host = canvas.closest<HTMLElement>("[data-aura-host]");
    const levels = new Float32Array(BANDS);
    let bands: [number, number][] | null = null;
    let bassBins: [number, number] = [1, 2];
    let data: Uint8Array<ArrayBuffer> | null = null;
    let bass = 0;
    let bassAverage = 0;
    let beat = 0;
    let impulse = 0;
    let energy = 0;
    let ambience = 0;
    let phase = 0;
    let previousTime = 0;
    let lastRipple = 0;
    const ripples: { age: number; strength: number; angle: number }[] = [];
    let size = 0;
    let color: Rgb = [211, 178, 120];
    let highlight: Rgb = [242, 238, 231];
    let frames = 0;
    let frame = 0;

    const resize = () => {
      const box = canvas.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      size = box.width;
      canvas.width = Math.round(box.width * ratio);
      canvas.height = Math.round(box.height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      schedule();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const listen = () => {
      const { playing, bpm, offset, getPosition } = live.current;
      const analyser = playing ? audioAnalyser() : null;

      if (analyser) {
        if (!bands || !data) {
          const binHz = analyser.context.sampleRate / analyser.fftSize;
          bands = bandBins(BANDS, analyser.context.sampleRate, analyser.fftSize);
          bassBins = [1, Math.max(2, Math.round(BASS_HZ / binHz))];
          data = new Uint8Array(analyser.frequencyBinCount);
        }

        analyser.getByteFrequencyData(data);
        for (let band = 0; band < BANDS; band++)
          levels[band] = follow(levels[band], bandLevel(data, bands[band]), 0.28, 0.1);

        bass = follow(bass, bandLevel(data, bassBins));
        bassAverage += (bass - bassAverage) * 0.02;
        impulse = onset(bass, bassAverage);
        beat = follow(beat, impulse, 0.35, 0.1);
        return;
      }

      if (playing && bpm) {
        const pulse = beatPulse(getPosition(), bpm, offset ?? 0);
        for (let band = 0; band < BANDS; band++) {
          const shape = 0.3 + 0.3 * Math.sin(band * 1.7) ** 2;
          levels[band] = follow(levels[band], pulse * shape, 0.3, 0.1);
        }
        impulse = pulse;
        beat = follow(beat, pulse * 0.6, 0.35, 0.1);
        return;
      }

      for (let band = 0; band < BANDS; band++) levels[band] = follow(levels[band], 0, 0.28, 0.1);
      impulse = 0;
      beat *= 0.9;
    };

    const draw = (delta: number) => {
      context.clearRect(0, 0, size, size);
      if (size === 0 || energy < 0.002) return;

      const centre = size / 2;
      const disc = centre / REACH;
      const room = centre - disc - 4;
      const presence = Math.min(1, energy * 3);
      phase += delta * (0.14 + energy * 0.35);

      if (energy > 0.01) {
        const glow = context.createRadialGradient(
          centre,
          centre,
          disc * 0.9,
          centre,
          centre,
          centre,
        );
        glow.addColorStop(0, rgba(color, energy * 0.16 + beat * 0.06));
        glow.addColorStop(1, rgba(color, 0));
        context.fillStyle = glow;
        context.fillRect(0, 0, size, size);
      }

      context.lineCap = "round";
      context.shadowColor = rgba(color, 0.6);
      context.shadowBlur = size * 0.012;

      // Broken circles follow the record's grooves; frequency bands gently
      // change their radius and brightness instead of producing radial spikes.
      for (let ring = 0; ring < 3; ring++) {
        for (let arc = 0; arc < 8; arc++) {
          const level = levels[(arc * 3 + ring * 7) % BANDS];
          const radius = disc + room * (0.14 + ring * 0.25 + level * 0.14);
          const angle = phase * (ring % 2 ? -0.45 : 0.6) + (arc * Math.PI) / 4 + ring * 0.28;
          context.lineWidth = Math.max(1, size / 450) + level * 2;
          context.strokeStyle = rgba(color, (0.07 + level * 0.65) * presence);
          context.beginPath();
          context.arc(centre, centre, radius, angle, angle + 0.34 + level * 0.3);
          context.stroke();
        }
      }

      for (let index = ripples.length - 1; index >= 0; index--) {
        const ripple = ripples[index];
        ripple.age += delta / 1.15;
        if (ripple.age >= 1) {
          ripples.splice(index, 1);
          continue;
        }
        const radius = disc + room * (0.1 + ripple.age * 0.85);
        context.lineWidth = 1.5;
        context.strokeStyle = rgba(color, ripple.strength * (1 - ripple.age) ** 2 * 0.26);
        context.beginPath();
        context.arc(centre, centre, radius, ripple.angle, ripple.angle + Math.PI * 0.85);
        context.moveTo(
          centre + Math.cos(ripple.angle + Math.PI) * radius,
          centre + Math.sin(ripple.angle + Math.PI) * radius,
        );
        context.arc(centre, centre, radius, ripple.angle + Math.PI, ripple.angle + Math.PI * 1.85);
        context.stroke();
      }

      // Small highlights travel along the rim and rise with the high bands.
      context.shadowBlur = size * 0.006;
      context.shadowColor = rgba(highlight, 0.5);
      for (let glint = 0; glint < 10; glint++) {
        const shimmer = Math.max(0, Math.sin(phase * 2 + glint * 2.4)) ** 12;
        const strength = shimmer * levels[16 + (glint % 16)] * presence;
        const angle = glint * 2.39996 + phase * 0.35;
        context.strokeStyle = rgba(highlight, strength * 0.8);
        context.lineWidth = 1.5;
        context.beginPath();
        context.arc(centre, centre, disc + room * (0.2 + (glint % 3) * 0.22), angle, angle + 0.035);
        context.stroke();
      }
      context.shadowBlur = 0;
    };

    const schedule = () => {
      if (!frame && !motion.matches && document.visibilityState === "visible" && size > 0)
        frame = requestAnimationFrame(tick);
    };

    const tick = (now: number) => {
      frame = 0;
      if (motion.matches || document.visibilityState !== "visible" || size === 0) {
        context.clearRect(0, 0, size, size);
        if (size > 0) host?.style.removeProperty("--beat");
        return;
      }
      if (previousTime && now - previousTime < FRAME_MS) {
        schedule();
        return;
      }
      const delta = Math.min(0.05, previousTime ? (now - previousTime) / 1000 : 1 / 30);
      previousTime = now;

      if (frames++ % COLOR_REFRESH_FRAMES === 0) {
        const style = getComputedStyle(canvas);
        color = rgbOf(style.getPropertyValue("--primary"), color);
        highlight = rgbOf(style.getPropertyValue("--foreground"), highlight);
      }

      listen();
      energy = follow(energy, levels.reduce((sum, value) => sum + value, 0) / BANDS, 0.25, 0.1);
      ambience = follow(ambience, Math.min(0.45, energy * 0.25 + beat * 0.3), 0.08, 0.04);
      if (live.current.playing && impulse > 0.22 && now - lastRipple > 320) {
        if (ripples.length >= 3) ripples.shift();
        ripples.push({ age: 0, strength: impulse, angle: phase });
        lastRipple = now;
      }
      host?.style.setProperty("--beat", ambience.toFixed(3));
      draw(delta);
      if (live.current.playing || energy > 0.002) schedule();
      else {
        ripples.length = 0;
        host?.style.removeProperty("--beat");
      }
    };

    const syncMotion = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      previousTime = 0;
      if (motion.matches || document.visibilityState !== "visible") {
        context.clearRect(0, 0, size, size);
        host?.style.removeProperty("--beat");
      } else schedule();
    };
    wake.current = schedule;
    motion.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncMotion);
    syncMotion();

    return () => {
      wake.current = () => {};
      cancelAnimationFrame(frame);
      observer.disconnect();
      motion.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncMotion);
      host?.style.removeProperty("--beat");
    };
  }, []);

  return <canvas ref={canvasRef} className="record-aura" aria-hidden="true" />;
}
