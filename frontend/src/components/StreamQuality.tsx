// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { AudioLinesIcon, ChevronDownIcon, Volume1Icon, Volume2Icon } from "lucide-react";
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
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

const QUALITIES = [
  { value: "Low", bitrate: 64, icon: Volume1Icon },
  { value: "Normal", bitrate: 128, icon: Volume2Icon },
  { value: "Original", bitrate: null, icon: AudioLinesIcon },
] as const;

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
        className={cn("quality-trigger group shrink-0", className)}
      >
        <AudioLinesIcon aria-hidden="true" size={13} className="text-primary" />
        {reduced && <span aria-hidden="true">↓</span>}
        {stream ?? "…"}
        <ChevronDownIcon
          aria-hidden="true"
          size={12}
          className="text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent className="w-72">
        <DropdownMenuLabel className="space-y-1 px-3 pt-3 pb-2">
          <span className="block text-sm font-semibold text-foreground">
            {t("settings.quality")}
          </span>
          {stream && (
            <span className="block text-xs font-normal">{t("player.quality", { stream })}</span>
          )}
        </DropdownMenuLabel>
        {reduced && (
          <p className="px-3 pb-2 text-xs leading-relaxed text-muted-foreground">
            {t("player.qualityReducedDetail")}
          </p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={settings.quality}
          onValueChange={(quality) => {
            if (quality !== settings.quality) settings.update({ quality: quality as AudioQuality });
          }}
        >
          {QUALITIES.map(({ value, bitrate, icon: Icon }) => (
            <DropdownMenuRadioItem
              key={value}
              value={value}
              textValue={t(`settings.quality.${value}`)}
              className="gap-3 py-3"
              onSelect={() => {
                if (settings.quality === value)
                  window.dispatchEvent(new Event("retry-stream-quality"));
              }}
            >
              <Icon aria-hidden="true" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-medium">{t(`settings.quality.${value}`)}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {bitrate
                    ? t("settings.qualityBitrate", { bitrate })
                    : t("settings.qualityOriginal")}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
