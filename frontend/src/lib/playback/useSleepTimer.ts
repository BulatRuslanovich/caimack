// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const SLEEP_TIMER_MINUTES = [15, 30, 45, 60, 90] as const;

export const SLEEP_FADE_SECONDS = 15;

const FADE_TICK_MS = 200;

export type SleepTimer =
  { kind: "minutes"; minutes: number; endsAt: number } | { kind: "trackEnd" };

export type SleepTimerChoice = number | "trackEnd" | null;

export function sleepGain(remainingSeconds: number): number {
  return Math.min(1, Math.max(0, remainingSeconds / SLEEP_FADE_SECONDS));
}

export function sleepTimerFor(choice: SleepTimerChoice, now: number): SleepTimer | null {
  if (choice === null) return null;
  if (choice === "trackEnd") return { kind: "trackEnd" };

  return { kind: "minutes", minutes: choice, endsAt: now + choice * 60_000 };
}

export function useSleepTimer(onExpire: () => void) {
  const [timer, setTimer] = useState<SleepTimer | null>(null);
  const [gain, setGain] = useState(1);
  const expire = useRef(onExpire);

  useEffect(() => {
    expire.current = onExpire;
  });

  const choose = useCallback((choice: SleepTimerChoice) => {
    setTimer(sleepTimerFor(choice, Date.now()));
    setGain(1);
  }, []);

  useEffect(() => {
    if (timer?.kind !== "minutes") return;

    let ticking: number | undefined;

    const step = () => {
      const left = (timer.endsAt - Date.now()) / 1000;

      if (left > 0) {
        setGain(sleepGain(left));
        return;
      }

      window.clearInterval(ticking);
      expire.current();
      setTimer(null);
      setGain(1);
    };

    const fadeStartsIn = timer.endsAt - Date.now() - SLEEP_FADE_SECONDS * 1000;
    const waiting = window.setTimeout(
      () => {
        step();
        ticking = window.setInterval(step, FADE_TICK_MS);
      },
      Math.max(0, fadeStartsIn),
    );

    return () => {
      window.clearTimeout(waiting);
      window.clearInterval(ticking);
    };
  }, [timer]);

  return { timer, gain, choose };
}

export function useSleepCountdown(timer: SleepTimer | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  const endsAt = timer?.kind === "minutes" ? timer.endsAt : null;

  useEffect(() => {
    if (endsAt === null) return;

    const ticking = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(ticking);
  }, [endsAt]);

  return endsAt === null ? null : Math.max(0, Math.ceil((endsAt - now) / 1000));
}
