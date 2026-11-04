// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { cn } from "@/lib/cn";
import { SHORTCUT_VOLUME_STEP } from "@/lib/shortcuts";
import { usePlayer } from "@/contexts/PlayerContext";
import { useT } from "@/contexts/I18nContext";
import { Seekbar } from "./Seekbar";
import { Button } from "./ui/button";
import { Volume2Icon, VolumeXIcon } from "lucide-react";
import { useEffect, useRef } from "react";

export function PlayerVolume({
  size = "icon",
  seekbarClassName,
}: {
  size?: "icon" | "icon-lg";
  seekbarClassName?: string;
}) {
  const player = usePlayer();
  const t = useT();

  const silent = player.muted || player.volume === 0;
  const wheelRef = useRef<HTMLSpanElement>(null);
  const { muted, volume, setVolume } = player;

  useEffect(() => {
    const element = wheelRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      const delta = event.deltaY || event.deltaX;
      if (delta === 0) return;
      event.preventDefault();
      setVolume(Math.min(1, Math.max(0, (muted ? 0 : volume) - Math.sign(delta) * 0.05)));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [muted, volume, setVolume]);

  return (
    <span ref={wheelRef} className="contents">
      <Button
        variant="ghost"
        size={size}
        onClick={player.toggleMute}
        aria-label={player.muted ? t("player.unmute") : t("player.mute")}
      >
        {silent ? <VolumeXIcon size={20} /> : <Volume2Icon size={20} />}
      </Button>

      <Seekbar
        value={player.muted ? 0 : player.volume}
        max={1}
        step={0.01}
        onSeek={player.setVolume}
        ariaLabel={t("player.volume")}
        valueText={(value) => `${Math.round(value * 100)}%`}
        keyStep={SHORTCUT_VOLUME_STEP}
        className={cn("volume-seek", seekbarClassName)}
      />
    </span>
  );
}
