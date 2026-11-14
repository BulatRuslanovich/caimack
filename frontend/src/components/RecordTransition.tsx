// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { useArtworkScene } from "./ArtworkScene";
import { Record } from "./Record";

type RecordProps = ComponentProps<typeof Record>;

export function RecordTransition({ className, ...props }: Omit<RecordProps, "track">) {
  const { current, previous, direction, trackId, onAnimationEnd } = useArtworkScene();
  const active = current.item.id === trackId;

  return (
    <div className={cn("record-transition", className)} data-direction={direction}>
      {previous && (
        <div
          key={previous.key}
          className="record-transition-layer"
          data-state="leaving"
          aria-hidden="true"
          inert
        >
          <Record
            {...props}
            track={previous.item}
            spinning={false}
            scratchable={false}
            auraFrozen
            transitionCover={false}
            className="w-full"
          />
        </div>
      )}
      <div
        key={current.key}
        className="record-transition-layer"
        data-state={previous ? "entering" : "settled"}
        onAnimationEnd={onAnimationEnd}
      >
        <Record
          {...props}
          track={current.item}
          spinning={props.spinning && active}
          auraFrozen={!active}
          scratchable={props.scratchable && active && !previous}
          className="w-full"
        />
      </div>
    </div>
  );
}
