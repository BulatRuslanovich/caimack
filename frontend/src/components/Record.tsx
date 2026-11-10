// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useT } from "@/contexts/I18nContext";
import { usePlayerActions, usePlayerClock, usePlayerState } from "@/contexts/PlayerContext";
import { cn } from "@/lib/cn";
import { trackCoverUrl } from "@/lib/media";
import { endVinylScratch, moveVinylScratch, startVinylScratch } from "@/lib/playback/equalizer";
import { useConnect } from "@/lib/playback/useConnectPlayback";
import { VINYL_TURN_SECONDS } from "@/lib/playback/vinylDeck";
import { useTatarMafia } from "@/lib/tatarMafia";
import type { Track } from "@/lib/types";
import { useVisualizer } from "@/lib/visualizer";
import { useCallback, useEffect, useRef, useState } from "react";
import { TrackCover } from "./Cover";
import { RecordAura } from "./RecordAura";

type RecordTrack = Pick<Track, "id" | "title" | "albumId" | "albumTitle" | "hasCover"> & {
  cues?: Track["cues"];
};

const TURN_MS = VINYL_TURN_SECONDS * 1000;
const SPIN_UP_MS = 500;
const SPIN_DOWN_MS = 1100;
const SCRATCH_SECONDS_PER_TURN = 10;

export function Record({
  track,
  out,
  spinning,
  scratchable = false,
  aura = false,
  axis = "x",
  sizes,
  transitionCover = false,
  className,
}: {
  track: RecordTrack;
  out: boolean;
  spinning: boolean;
  scratchable?: boolean;
  aura?: boolean;
  axis?: "x" | "y" | "responsive";
  sizes?: string;
  transitionCover?: boolean;
  className?: string;
}) {
  const { scrubBy, holdScrub, commitScrub, getDuration } = usePlayerActions();
  const getPosition = usePlayerClock();
  const { volume, muted } = usePlayerState();
  const connect = useConnect();
  const tatarMafia = useTatarMafia();
  const djMode = scratchable && tatarMafia && !connect.selectedId;
  const t = useT();
  const visualizer = useVisualizer();
  const spinElement = useRef<HTMLDivElement>(null);
  const spin = useRef<Animation | null>(null);
  const scratchAngle = useRef<number | null>(null);
  const scratchPointer = useRef<number | null>(null);
  const scratchTime = useRef(0);
  const needlePosition = useRef(0);
  const audibleScratch = useRef(false);
  const [scratching, setScratching] = useState(false);

  const endScratch = useCallback(() => {
    if (scratchAngle.current === null) return;
    scratchAngle.current = null;
    scratchPointer.current = null;
    audibleScratch.current = false;
    endVinylScratch();
    spin.current?.play();
    setScratching(false);
    commitScrub();
  }, [commitScrub]);

  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState !== "visible") endScratch();
    };
    window.addEventListener("blur", endScratch);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("blur", endScratch);
      document.removeEventListener("visibilitychange", hidden);
      endScratch();
    };
  }, [endScratch, track.id, djMode, scratchable]);

  useEffect(() => {
    const animation = spinElement.current?.animate(
      [{ transform: "rotate(0turn)" }, { transform: "rotate(1turn)" }],
      { duration: TURN_MS, iterations: Infinity },
    );
    if (!animation) return;

    animation.playbackRate = 0;
    spin.current = animation;
    return () => animation.cancel();
  }, [track.id]);

  useEffect(() => {
    const animation = spin.current;
    if (!animation) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = animation.playbackRate;
    const to = spinning && !reduceMotion ? 1 : 0;
    const duration = to > from ? SPIN_UP_MS : SPIN_DOWN_MS;
    const start = performance.now();
    let frame = 0;

    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      animation.playbackRate = from + (to - from) * progress;
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);

    return () => cancelAnimationFrame(frame);
  }, [spinning, track.id]);

  function angleAt(event: React.PointerEvent<HTMLElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return Math.atan2(
      event.clientY - (box.top + box.height / 2),
      event.clientX - (box.left + box.width / 2),
    );
  }

  return (
    <div
      className={cn("record", className)}
      data-out={out}
      data-scratchable={scratchable}
      data-dj-scratching={djMode && scratching}
      data-axis={axis}
    >
      <div
        key={track.id}
        className="record-disc"
        aria-hidden="true"
        title={djMode ? t("player.djHint") : undefined}
        onTouchStart={(event) => scratchable && event.stopPropagation()}
        onDragStart={(event) => scratchable && event.preventDefault()}
        onPointerDown={(event) => {
          if (!scratchable || event.button !== 0 || scratchPointer.current !== null) return;

          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          scratchPointer.current = event.pointerId;
          scratchTime.current = event.timeStamp;
          needlePosition.current = getPosition();
          scratchAngle.current = angleAt(event);
          spin.current?.pause();
          audibleScratch.current =
            djMode && !muted && volume > 0 && startVinylScratch(track.id, needlePosition.current);
          setScratching(true);
          holdScrub();
        }}
        onPointerMove={(event) => {
          if (scratchAngle.current === null || event.pointerId !== scratchPointer.current) return;

          const angle = angleAt(event);
          let delta = angle - scratchAngle.current;
          if (delta > Math.PI) delta -= 2 * Math.PI;
          if (delta < -Math.PI) delta += 2 * Math.PI;
          scratchAngle.current = angle;

          const turns = delta / (2 * Math.PI);
          const elapsed = Math.max(4, event.timeStamp - scratchTime.current) / 1000;
          scratchTime.current = event.timeStamp;
          const seconds = turns * (djMode ? VINYL_TURN_SECONDS : SCRATCH_SECONDS_PER_TURN);
          const position = Math.max(
            0,
            Math.min(getDuration() || Infinity, needlePosition.current + seconds),
          );
          const moved = position - needlePosition.current;
          needlePosition.current = position;
          if (audibleScratch.current) {
            moveVinylScratch(position, elapsed);
          }
          const animation = spin.current;
          if (animation) {
            const time = Number(animation.currentTime ?? 0) + turns * TURN_MS;
            animation.currentTime = ((time % TURN_MS) + TURN_MS) % TURN_MS;
          }
          scrubBy(moved);
        }}
        onPointerUp={(event) => {
          if (event.pointerId !== scratchPointer.current) return;
          endScratch();
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={endScratch}
        onLostPointerCapture={endScratch}
      >
        {aura && visualizer && (
          <RecordAura playing={spinning} bpm={track.cues?.bpm} offset={track.cues?.audioStart} />
        )}

        <div ref={spinElement} className="record-spin">
          <div className="record-label">
            <TrackCover track={track} />
          </div>
        </div>
        <div className="record-sheen" />
      </div>

      <div
        className="record-sleeve"
        style={{ viewTransitionName: transitionCover ? "player-artwork" : undefined }}
      >
        <TrackCover
          track={track}
          variant={sizes ? "full" : "thumb"}
          sizes={sizes}
          preview={sizes ? trackCoverUrl(track, "thumb") : undefined}
        />
      </div>
    </div>
  );
}
