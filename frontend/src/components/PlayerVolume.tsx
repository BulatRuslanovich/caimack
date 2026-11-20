// SPDX-License-Identifier: AGPL-3.0-only

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
  return <VolumeControls {...player} size={size} seekbarClassName={seekbarClassName} />;
}

export function VolumeControls({
  muted,
  volume,
  setVolume,
  toggleMute,
  size = "icon",
  seekbarClassName,
}: {
  muted: boolean;
  volume: number;
  setVolume: (value: number) => void;
  toggleMute: () => void;
  size?: "icon" | "icon-lg";
  seekbarClassName?: string;
}) {
  const t = useT();

  const silent = muted || volume === 0;
  const wheelRef = useRef<HTMLSpanElement>(null);

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
        onClick={toggleMute}
        aria-label={muted ? t("player.unmute") : t("player.mute")}
      >
        {silent ? <VolumeXIcon size={20} /> : <Volume2Icon size={20} />}
      </Button>

      <Seekbar
        value={muted ? 0 : volume}
        max={1}
        step={0.01}
        onSeek={setVolume}
        ariaLabel={t("player.volume")}
        valueText={(value) => `${Math.round(value * 100)}%`}
        keyStep={SHORTCUT_VOLUME_STEP}
        className={cn("volume-seek", seekbarClassName)}
      />
    </span>
  );
}
