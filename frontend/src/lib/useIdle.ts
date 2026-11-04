// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useEffect, useRef, useState } from "react";

const ACTIVITY = ["pointermove", "pointerdown", "wheel", "keydown"] as const;

const WAKE_THROTTLE_MS = 100;

export function useIdle(delayMs: number, enabled = true): boolean {
  const [idle, setIdle] = useState(false);
  const idleRef = useRef(false);

  useEffect(() => {
    const wakeUp = () => {
      if (!idleRef.current) return;
      idleRef.current = false;
      setIdle(false);
    };

    if (!enabled || window.matchMedia("(pointer: coarse)").matches) return wakeUp;

    let timer = 0;
    let lastArmed = 0;

    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        idleRef.current = true;
        setIdle(true);
      }, delayMs);
    };

    const onActivity = () => {
      wakeUp();

      const now = performance.now();
      if (now - lastArmed < WAKE_THROTTLE_MS) return;

      lastArmed = now;
      arm();
    };

    arm();
    for (const event of ACTIVITY) window.addEventListener(event, onActivity, { passive: true });

    return () => {
      window.clearTimeout(timer);
      for (const event of ACTIVITY) window.removeEventListener(event, onActivity);
      wakeUp();
    };
  }, [delayMs, enabled]);

  return idle;
}
