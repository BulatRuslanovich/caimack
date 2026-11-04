// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

const PULL = 64;
const FUSE_MS = 280;

export function Pin({ children }: { children: ReactNode }) {
  const origin = useRef<{ x: number; y: number } | null>(null);
  const pulled = useRef(false);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const [boom, setBoom] = useState(false);

  const onPointerDown = (event: PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    origin.current = { x: event.clientX, y: event.clientY };
    pulled.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLSpanElement>) => {
    if (!origin.current) return;
    const dx = event.clientX - origin.current.x;
    const dy = event.clientY - origin.current.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 4) return;
    const give = Math.min(distance, PULL * 1.5) / distance;
    setOffset({ x: dx * give * 0.35, y: dy * give * 0.35 });
    pulled.current = distance > PULL;
  };

  const onPointerUp = () => {
    origin.current = null;
    setOffset(null);
    if (pulled.current) setTimeout(() => setBoom(true), FUSE_MS);
  };

  return (
    <>
      <span
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={(event) => {
          if (!pulled.current) return;
          pulled.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        className="inline-flex touch-none"
        style={{
          transform: offset ? `translate(${offset.x}px, ${offset.y}px)` : undefined,
          transition: offset ? "none" : "transform 420ms cubic-bezier(0.3, 1.6, 0.5, 1)",
        }}
      >
        {children}
      </span>
      {boom && <Boom onDone={() => setBoom(false)} />}
    </>
  );
}

function Boom({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const leave = () => setLeaving(true);
    window.addEventListener("keydown", leave);
    return () => window.removeEventListener("keydown", leave);
  }, []);

  return createPortal(
    <div
      aria-hidden="true"
      className="boom"
      data-leaving={leaving || undefined}
      onClick={() => setLeaving(true)}
      onAnimationEnd={(event) => {
        if (leaving && event.target === event.currentTarget) onDone();
      }}
    >
      <img src="/reze.jpg" alt="" draggable={false} />
    </div>,
    document.body,
  );
}
