// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useEffect, useRef } from "react";
import type { Track } from "@/lib/types";
import { cn } from "@/lib/cn";
import { useVisualizer } from "@/lib/visualizer";
import { trackCoverUrl } from "@/lib/media";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { TrackCover } from "./Cover";
import { RecordAura } from "./RecordAura";

type RecordTrack = Pick<Track, "id" | "title" | "albumId" | "albumTitle" | "hasCover"> & {
  cues?: Track["cues"];
};

const TURN_MS = 1800;
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
  axis?: "x" | "y";
  sizes?: string;
  transitionCover?: boolean;
  className?: string;
}) {
  const { scrubBy, holdScrub, commitScrub } = usePlayerActions();
  const visualizer = useVisualizer();
  const spinElement = useRef<HTMLDivElement>(null);
  const spin = useRef<Animation | null>(null);
  const scratchAngle = useRef<number | null>(null);

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

  function endScratch() {
    if (scratchAngle.current === null) return;

    scratchAngle.current = null;
    spin.current?.play();
    commitScrub();
  }

  return (
    <div
      className={cn("record", className)}
      data-out={out}
      data-scratchable={scratchable}
      data-axis={axis}
    >
      <div
        key={track.id}
        className="record-disc"
        aria-hidden="true"
        onTouchStart={(event) => scratchable && event.stopPropagation()}
        onDragStart={(event) => scratchable && event.preventDefault()}
        onPointerDown={(event) => {
          if (!scratchable || event.button !== 0) return;

          event.currentTarget.setPointerCapture(event.pointerId);
          scratchAngle.current = angleAt(event);
          spin.current?.pause();
          holdScrub();
        }}
        onPointerMove={(event) => {
          if (scratchAngle.current === null) return;

          const angle = angleAt(event);
          let delta = angle - scratchAngle.current;
          if (delta > Math.PI) delta -= 2 * Math.PI;
          if (delta < -Math.PI) delta += 2 * Math.PI;
          scratchAngle.current = angle;

          const turns = delta / (2 * Math.PI);
          const animation = spin.current;
          if (animation) {
            const time = Number(animation.currentTime ?? 0) + turns * TURN_MS;
            animation.currentTime = ((time % TURN_MS) + TURN_MS) % TURN_MS;
          }
          scrubBy(turns * SCRATCH_SECONDS_PER_TURN);
        }}
        onPointerUp={endScratch}
        onPointerCancel={endScratch}
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
