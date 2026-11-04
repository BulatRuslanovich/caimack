// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { CheckIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { formatAudioSpec } from "@/lib/format";
import { STREAM_CHANGE } from "@/lib/playback/adaptivePlayback";
import type { AudioQuality, Track } from "@/lib/types";
import { useSettings } from "@/lib/useSettings";
import { useT } from "@/contexts/I18nContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

const QUALITIES: AudioQuality[] = ["Low", "Normal", "Original"];

const AUDIO_EVENTS = [STREAM_CHANGE, "loadedmetadata", "playing"];

export function StreamQuality({ track, className }: { track: Track; className?: string }) {
  const t = useT();
  const settings = useSettings();
  const [stream, setStream] = useState<string | null>(null);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const read = () => {
      const audio = [...document.querySelectorAll<HTMLAudioElement>("audio[data-track-id]")].find(
        (element) => element.dataset.trackId === track.id,
      );
      setReduced(audio?.dataset.streamReduced === "true");

      if (!audio || audio.dataset.sourceLoading === "true") setStream(null);
      else if (
        audio.dataset.playbackMode === "hls.js" ||
        audio.dataset.playbackMode === "native-hls"
      ) {
        setStream(audio.dataset.streamKbps ? `AAC ${audio.dataset.streamKbps}k` : "AAC");
      } else setStream(formatAudioSpec(track) ?? t("settings.quality.Original"));
    };

    read();
    for (const name of AUDIO_EVENTS) document.addEventListener(name, read, true);
    return () => {
      for (const name of AUDIO_EVENTS) document.removeEventListener(name, read, true);
    };
  }, [track, t]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("player.quality", { stream: stream ?? "…" })}
        title={reduced ? t("player.qualityReducedDetail") : undefined}
        className={cn(
          "inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-border-strong px-2.5 text-2xs font-semibold whitespace-nowrap text-muted-foreground tabular-nums transition-colors hover:border-foreground hover:text-foreground",
          className,
        )}
      >
        {reduced && <span aria-hidden="true">↓</span>}
        {stream ?? "…"}
      </DropdownMenuTrigger>

      <DropdownMenuContent>
        <DropdownMenuLabel>{t("settings.quality")}</DropdownMenuLabel>
        {reduced && (
          <DropdownMenuLabel className="max-w-64 whitespace-normal font-normal">
            {t("player.qualityReducedDetail")}
          </DropdownMenuLabel>
        )}
        {QUALITIES.map((quality) => (
          <DropdownMenuItem
            key={quality}
            onSelect={() => {
              if (settings.quality === quality)
                window.dispatchEvent(new Event("retry-stream-quality"));
              else settings.update({ quality });
            }}
          >
            <CheckIcon className={cn(settings.quality !== quality && "invisible")} />
            {t(`settings.quality.${quality}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
