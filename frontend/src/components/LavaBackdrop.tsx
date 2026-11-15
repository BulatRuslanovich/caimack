// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useEffect, useRef } from "react";

/** Fixed pixel budget, independent of screen size and device pixel ratio. */
const EDGE = 192;
const FRAME_MS = 50;
const TAU = Math.PI * 2;

export function LavaBackdrop({ src }: { src: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d", { alpha: false });
    if (!canvas || !context) return;

    // Draw the artwork directly: privacy browsers can replace getImageData()
    // results with unrelated colours. No pixel readback is needed for this effect.
    const average = document.createElement("canvas");
    average.width = average.height = 1;
    let ready = false;
    let disposed = false;
    const blobs = Array.from({ length: 6 }, () => {
      const sprite = document.createElement("canvas");
      sprite.width = sprite.height = 64;
      return {
        sprite,
        phase: Math.random() * TAU,
        orbit: Math.random() * TAU,
        speed: 0.035 + Math.random() * 0.035,
        size: 0.55 + Math.random() * 0.35,
      };
    });

    let elapsed = 0;
    let last = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    function draw() {
      if (!canvas || !context) return;
      const w = canvas.width,
        h = canvas.height;
      context.fillStyle = "#171819";
      context.fillRect(0, 0, w, h);
      if (!ready) return;
      context.drawImage(average, 0, 0, w, h);
      for (const blob of blobs) {
        const phase = elapsed * blob.speed + blob.phase;
        const x = w * (0.5 + 0.46 * Math.sin(phase + blob.orbit));
        const y = h * (0.5 + 0.46 * Math.cos(phase * 0.83 + blob.orbit));
        const size = Math.max(w, h) * blob.size;
        context.save();
        context.translate(x, y);
        context.rotate(phase * 0.3);
        context.scale(1 + 0.24 * Math.sin(phase * 1.3), 1 + 0.26 * Math.cos(phase));
        context.drawImage(blob.sprite, -size / 2, -size / 2, size, size);
        context.restore();
      }
      // Keep white controls readable even on white or very bright artwork.
      context.fillStyle = "rgba(0,0,0,0.58)";
      context.fillRect(0, 0, w, h);
    }

    function tick() {
      const now = performance.now();
      elapsed += Math.min(now - last, 100) / 1000;
      last = now;
      draw();
      timer = setTimeout(tick, FRAME_MS);
    }

    function sync() {
      clearTimeout(timer);
      timer = undefined;
      if (document.hidden) return;
      draw();
      if (ready && !reduced.matches) {
        last = performance.now();
        timer = setTimeout(tick, FRAME_MS);
      }
    }

    const image = new Image();
    image.decoding = "async";
    // Progressive downsampling averages regions without reading their pixels.
    // Six regional colours keep the dominant cover colour and its accents.
    image.onload = () => {
      if (disposed) return;
      let small: CanvasImageSource = image;
      let edge = 64;
      while (edge >= 4) {
        const next = document.createElement("canvas");
        next.width = edge * 3;
        next.height = edge * 2;
        const ctx = next.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(small, 0, 0, next.width, next.height);
        small = next;
        edge /= 2;
      }
      const averageContext = average.getContext("2d");
      if (!averageContext) return;
      averageContext.drawImage(small, 0, 0, 1, 1);
      const swatch = document.createElement("canvas");
      swatch.width = swatch.height = 1;
      const paint = swatch.getContext("2d");
      if (!paint) return;
      blobs.forEach(({ sprite }, i) => {
        paint.clearRect(0, 0, 1, 1);
        paint.drawImage(small, (i % 3) * 4, Math.floor(i / 3) * 4, 4, 4, 0, 0, 1, 1);
        const ctx = sprite.getContext("2d")!;
        ctx.drawImage(swatch, 0, 0, 64, 64);
        const mask = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        mask.addColorStop(0, "rgba(0,0,0,0.95)");
        mask.addColorStop(0.3, "rgba(0,0,0,0.8)");
        mask.addColorStop(0.65, "rgba(0,0,0,0.35)");
        mask.addColorStop(1, "transparent");
        ctx.globalCompositeOperation = "destination-in";
        ctx.fillStyle = mask;
        ctx.fillRect(0, 0, 64, 64);
      });
      ready = true;
      sync();
    };
    if (src) image.src = src;

    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      const scale = EDGE / Math.max(width, height);
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      if (!document.hidden) draw();
    });
    resize.observe(canvas);
    reduced.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      disposed = true;
      image.onload = null;
      image.src = "";
      clearTimeout(timer);
      resize.disconnect();
      reduced.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [src]);

  return <canvas ref={ref} width={192} height={108} className="lava-backdrop" aria-hidden="true" />;
}
