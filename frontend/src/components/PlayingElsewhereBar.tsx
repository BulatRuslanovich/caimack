// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MonitorSpeakerIcon, XIcon } from "lucide-react";
import { api } from "@/lib/api";
import { deviceId } from "@/lib/events";
import { formatArtists, formatDuration } from "@/lib/format";
import { readStored, writeStored } from "@/lib/storage";
import { usePlayerActions, usePlayerState } from "@/contexts/PlayerContext";
import { useT } from "@/contexts/I18nContext";
import { Button } from "./ui/button";

const REFRESH_MS = 30_000;
const DISMISSED_KEY = "music-streaming.handoff-dismissed";

export function PlayingElsewhereBar() {
  const t = useT();
  const { isPlaying } = usePlayerState();
  const { continueHere } = usePlayerActions();
  const [dismissed, setDismissed] = useState(() => readStored(DISMISSED_KEY, "session"));
  const [taking, setTaking] = useState(false);

  const { data: elsewhere } = useQuery({
    queryKey: ["playingElsewhere"],
    queryFn: async ({ signal }) => (await api.playingElsewhere(deviceId(), signal)) ?? null,
    enabled: !isPlaying,
    staleTime: 0,
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
  });

  if (isPlaying || !elsewhere) return null;

  const key = `${elsewhere.deviceId}@${elsewhere.reportedAt}`;
  if (dismissed === key) return null;

  const { track, deviceName } = elsewhere;
  const device = deviceName || t("player.anotherDevice");

  const dismiss = () => {
    writeStored(DISMISSED_KEY, key, "session");
    setDismissed(key);
  };

  const take = async () => {
    setTaking(true);
    await continueHere();
    setTaking(false);
  };

  return (
    <section aria-label={t("handoff.region")} className="handoff-shell">
      <span className="handoff-icon" aria-hidden="true">
        <MonitorSpeakerIcon className="size-4" />
      </span>

      <p className="min-w-0" title={`${track.title} — ${formatArtists(track)} · ${device}`}>
        <span className="block truncate text-sm font-medium">
          {track.title}
          <span className="font-normal text-muted-foreground max-md:hidden">
            {" — "}
            {formatArtists(track)}
          </span>
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {t(elsewhere.isPlaying ? "handoff.playingOn" : "handoff.pausedOn", { device })}
          {!elsewhere.isPlaying && ` · ${formatDuration(elsewhere.positionSeconds)}`}
        </span>
      </p>

      <Button
        variant="secondary"
        size="sm"
        className="handoff-continue h-9 shrink-0"
        onClick={take}
        disabled={taking}
        aria-busy={taking}
      >
        {t("handoff.continueHere")}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-8"
        onClick={dismiss}
        aria-label={t("handoff.dismiss")}
      >
        <XIcon aria-hidden className="size-4" />
      </Button>
    </section>
  );
}
