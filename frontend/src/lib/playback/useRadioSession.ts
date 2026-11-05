// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { api } from "@/lib/api";
import {
  mergeRadioBatch,
  queueSignals,
  recommendationReasons,
  radioReaction,
  radioRefreshPlan,
  radioExclusions,
} from "@/lib/playback/radioSession";
import { subscribePlaybackEvents } from "@/lib/events";
import { appendTracks, radioStartAfterInsert } from "@/lib/playback/playerQueue";
import { radioSource, sourceOf, tagSource } from "@/lib/playback/playSource";
import type { RadioSessionState, RadioState, RepeatMode } from "@/lib/playback/playerTypes";
import type { RadioFocus, Track } from "@/lib/types";
import { useT } from "@/contexts/I18nContext";
import { useToast } from "@/lib/useToast";

const RADIO_PREFETCH_AT = 2;

const RADIO_INITIAL_BATCH = 6;

interface RadioSessionInput {
  queue: Track[];
  currentIndex: number;
  repeat: RepeatMode;
  autoplay: boolean;
  queueRef: RefObject<Track[]>;
  orderRef: RefObject<number[]>;
  applyQueue: (queue: Track[], order: number[]) => void;
  setCurrentIndex: (index: number) => void;
}

interface RadioSession {
  session: RadioSessionState | null;
  radio: RadioState;

  start: (seedTrack?: Track | null) => Promise<Track[] | null>;

  stop: () => void;
  setFocus: (focus: RadioFocus) => void;
  pin: (trackId: string) => void;
  resetRadio: () => void;
  restore: (session: RadioSessionState | null, radioFrom?: number) => void;

  noteInsert: (at: number, queueLength: number) => void;
  radioFrom: () => number;
}

export function useRadioSession({
  queue,
  currentIndex,
  repeat,
  autoplay,
  queueRef,
  orderRef,
  applyQueue,
  setCurrentIndex,
}: RadioSessionInput): RadioSession {
  const { notify, notifyError } = useToast();
  const t = useT();

  const [session, setSession] = useState<RadioSessionState | null>(null);
  const [starting, setStarting] = useState(false);
  const [radio, setRadio] = useState<RadioState>("idle");
  const [revision, setRevision] = useState(0);
  const handledRevision = useRef(0);
  const generated = useRef(new Set<string>());
  const pinned = useRef(new Set<string>());
  const live = useRef({ session, autoplay, currentIndex, repeat });
  useLayoutEffect(() => {
    live.current = { session, autoplay, currentIndex, repeat };
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const progressed = new Set<string>();
    const unsubscribe = subscribePlaybackEvents((event) => {
      const active = live.current;
      if (!active.session && (!active.autoplay || generated.current.size === 0)) return;
      if (!radioReaction(event)) return;
      if (event.type === "trackPlayed") {
        if (progressed.has(event.trackId ?? "")) return;
        progressed.add(event.trackId ?? "");
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setRevision((value) => value + 1);
      }, 350);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);

  const radioRef = useRef<{ inFlight: boolean; seed: string | null }>({
    inFlight: false,
    seed: null,
  });

  const radioFromRef = useRef(Number.MAX_SAFE_INTEGER);
  const generationRef = useRef(0);

  const resetRadio = useCallback(() => {
    generationRef.current += 1;
    radioRef.current = { inFlight: false, seed: null };
    radioFromRef.current = Number.MAX_SAFE_INTEGER;
    setRadio("idle");
    generated.current.clear();
    pinned.current.clear();
    handledRevision.current = 0;
    setRevision(0);
  }, []);

  const setFocus = useCallback(
    (focus: RadioFocus) => {
      if (!session || session.focus === focus) return;

      generationRef.current += 1;
      radioRef.current = { inFlight: false, seed: null };
      setSession({ ...session, focus });

      setRevision((value) => value + 1);
    },
    [session],
  );

  const stop = useCallback(() => {
    generationRef.current += 1;
    setSession(null);
    setStarting(false);
    generated.current.clear();
    pinned.current.clear();
  }, []);

  const pin = useCallback((trackId: string) => {
    if (pinned.current.has(trackId)) return;
    pinned.current.add(trackId);
    const manualTrackIds = [...pinned.current];
    setSession((active) => (active ? { ...active, manualTrackIds } : active));
  }, []);

  const restore = useCallback((restored: RadioSessionState | null, radioFrom?: number) => {
    if (radioFrom !== undefined) radioFromRef.current = radioFrom;

    generationRef.current += 1;
    pinned.current = new Set(restored?.manualTrackIds ?? []);
    setSession(restored);
  }, []);

  const noteInsert = useCallback((at: number, queueLength: number) => {
    radioFromRef.current = radioStartAfterInsert(radioFromRef.current, at, queueLength);
  }, []);

  const radioFrom = useCallback(() => radioFromRef.current, []);

  const start = useCallback(
    async (seedTrack: Track | null = null) => {
      const generation = ++generationRef.current;
      radioRef.current = { inFlight: false, seed: null };
      setStarting(true);

      try {
        const batch = await api.radio({
          seedTrackId: seedTrack?.id ?? null,
          exclude: [],
          limit: RADIO_INITIAL_BATCH - (seedTrack ? 1 : 0),
        });
        if (generation !== generationRef.current) return null;

        if (batch.tracks.length === 0 && !seedTrack) {
          notify(t("radio.empty"), "info");
          return null;
        }

        setSession({
          seedTrackId: batch.seedTrackId,
          reasons: recommendationReasons(batch.tracks),
          signals: queueSignals(batch.tracks),
        });
        return [...(seedTrack ? [seedTrack] : []), ...batch.tracks.map((item) => item.track)];
      } catch (error) {
        if (generation === generationRef.current) notifyError(error, t("radio.failed"));
        return null;
      } finally {
        setStarting(false);
      }
    },
    [notify, notifyError, t],
  );

  useEffect(() => {
    if (starting || currentIndex < 0 || repeat !== "off" || (!autoplay && !session)) return;

    const order = orderRef.current;
    const position = order.indexOf(currentIndex);
    const refreshing = revision > handledRevision.current;
    if (position < 0 || (!refreshing && order.length - position - 1 > RADIO_PREFETCH_AT)) return;

    const seed = queue[currentIndex]?.id ?? session?.seedTrackId ?? null;
    if (radioRef.current.inFlight || (!refreshing && radioRef.current.seed === seed)) return;

    const requestedQueue = queueRef.current;
    const requestedOrder = orderRef.current;
    const plan = refreshing
      ? radioRefreshPlan(
          requestedQueue,
          requestedOrder,
          currentIndex,
          (track) =>
            sourceOf(track.id) !== "queue" &&
            !pinned.current.has(track.id) &&
            (generated.current.has(track.id) || Boolean(session?.reasons[track.id])),
        )
      : { queue: requestedQueue, order: requestedOrder, index: currentIndex };

    const generation = generationRef.current;
    const excluded = radioExclusions(plan.queue, plan.order, plan.index);
    radioRef.current = { inFlight: true, seed };
    setRadio("loading");

    void api
      .radio({
        seedTrackId: seed,
        exclude: excluded,
        focus: session?.focus,
      })
      .then((batch) => {
        if (generation !== generationRef.current) return;
        if (live.current.repeat !== "off" || (!live.current.autoplay && !live.current.session)) {
          radioRef.current = { inFlight: false, seed: null };
          return;
        }
        if (
          queueRef.current !== requestedQueue ||
          orderRef.current !== requestedOrder ||
          live.current.currentIndex !== currentIndex
        ) {
          radioRef.current = { inFlight: false, seed: null };
          setRevision((value) => value + 1);
          return;
        }

        const current = plan.queue;
        const merged = mergeRadioBatch(
          current,
          session?.reasons ?? {},
          session?.signals ?? {},
          batch.tracks,
          new Set(excluded),
        );

        if (merged.tracks.length === 0) {
          setRadio(batch.tracks.length === 0 ? "empty" : "idle");
          return;
        }

        radioFromRef.current = Math.min(radioFromRef.current, current.length);
        handledRevision.current = revision;
        merged.tracks.forEach((track) => generated.current.add(track.id));

        tagSource(
          merged.tracks.map((track) => track.id),
          session ? radioSource() : "radio:autoplay",
        );

        const next = appendTracks(current, plan.order, merged.tracks);
        applyQueue(next.queue, next.order);
        if (plan.index !== currentIndex) setCurrentIndex(plan.index);

        setSession((active) =>
          active
            ? {
                ...active,
                seedTrackId: batch.seedTrackId ?? active.seedTrackId,
                reasons: merged.reasons,
                signals: merged.signals,
              }
            : active,
        );
        setRadio("idle");
      })
      .catch(() => {
        if (generation === generationRef.current) setRadio("failed");
      })
      .finally(() => {
        if (generation === generationRef.current) {
          radioRef.current = { ...radioRef.current, inFlight: false };
        }
      });
  }, [
    session,
    starting,
    currentIndex,
    queue,
    repeat,
    autoplay,
    applyQueue,
    queueRef,
    orderRef,
    revision,
    setCurrentIndex,
  ]);

  return {
    session,
    radio,
    start,
    stop,
    setFocus,
    pin,
    resetRadio,
    restore,
    noteInsert,
    radioFrom,
  };
}
