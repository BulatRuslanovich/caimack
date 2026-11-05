// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useMutation } from "@tanstack/react-query";
import { PauseIcon, PlayIcon } from "lucide-react";
import { usePlayerActions, usePlayerState } from "@/contexts/PlayerContext";
import { useT } from "@/contexts/I18nContext";
import { TrackCover } from "@/components/Cover";
import { NowPlayingBars } from "@/components/PlaybackIndicators";
import { Button } from "@/components/ui/button";
import { formatArtists } from "@/lib/format";
import { trackCoverUrl } from "@/lib/media";
import type { Track } from "@/lib/types";
import { useCoverLight } from "@/lib/useCoverTone";

export function RadioHero({ tracks }: { tracks: Track[] }) {
  const t = useT();
  const state = usePlayerState();
  const player = usePlayerActions();
  const start = useMutation({ mutationFn: () => player.startRadio() });
  const active = Boolean(state.radioSession);
  const playing = active && state.isPlaying;
  const art =
    (active ? state.currentTrack : null) ?? tracks.find((track) => track.hasCover) ?? tracks[0];
  const light = useCoverLight(art ? trackCoverUrl(art, "thumb") : null);
  const sleeves = tracks
    .filter(
      (track, index, all) =>
        track.hasCover &&
        (track.albumId ?? track.id) !== (art?.albumId ?? art?.id) &&
        all.findIndex((other) => (other.albumId ?? other.id) === (track.albumId ?? track.id)) ===
          index,
    )
    .slice(0, 2);
  const next = active ? state.nextTrack : null;

  if (!art) return null;

  return (
    <section
      className="radio-hero"
      style={light}
      data-playing={playing && !state.buffering}
      aria-labelledby="personal-radio-title"
    >
      <div className="radio-copy">
        <h1 id="personal-radio-title" className="radio-title">
          {t("radio.mine")}
        </h1>
        <p className="radio-description">{t("radio.description")}</p>
        <Button
          variant="primary"
          size="auto"
          className="radio-start"
          disabled={start.isPending}
          aria-busy={start.isPending}
          aria-label={`${t("radio.mine")}: ${playing ? t("action.pause") : t("action.play")}`}
          onClick={() => (active ? player.toggle() : start.mutate())}
        >
          <span className="radio-start-icon">
            {playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
          </span>
          <span className="min-w-0 truncate">
            {start.isPending
              ? t("menu.radioStarting")
              : playing
                ? t("action.pause")
                : active
                  ? t("radio.resume")
                  : t("radio.start")}
          </span>
        </Button>
      </div>

      <div className="radio-scene" aria-hidden="true">
        <div className="radio-platter">
          <div className="record-spin">
            <div className="record-label">
              <TrackCover track={art} />
            </div>
          </div>
          <div className="record-sheen" />
        </div>
        <div className="radio-sleeves">
          {sleeves.map((track, index) => (
            <span key={track.id} className={`radio-sleeve radio-sleeve-${index}`}>
              <TrackCover track={track} />
            </span>
          ))}
        </div>
      </div>

      <div className="radio-foot">
        <span className="radio-status" role="status">
          {playing ? <NowPlayingBars /> : <span className="radio-status-dot" />}
          {active && state.currentTrack ? (
            <span
              className="radio-status-copy"
              title={`${state.currentTrack.title} — ${formatArtists(state.currentTrack)}`}
            >
              <span className="radio-status-track">{state.currentTrack.title}</span>
              <span className="radio-status-caption">
                {formatArtists(state.currentTrack)} ·{" "}
                {playing ? t("radio.onAir") : t("radio.paused")}
              </span>
            </span>
          ) : (
            t("radio.fromLibrary")
          )}
        </span>
        {next && (
          <span className="radio-next">
            <span className="radio-next-title">
              {t("player.upNextNamed", { title: next.title })}
            </span>
          </span>
        )}
      </div>
    </section>
  );
}
