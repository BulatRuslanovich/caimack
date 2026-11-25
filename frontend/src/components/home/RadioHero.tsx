// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useRecommendations } from "@/lib/useRecommendations";
import { useMutation } from "@tanstack/react-query";
import { LoaderCircleIcon, PauseIcon, PlayIcon } from "lucide-react";
import { usePlayerActions, usePlayerState } from "@/contexts/PlayerContext";
import { useT } from "@/contexts/I18nContext";
import { TrackCover } from "@/components/Cover";
import { NowPlayingBars } from "@/components/PlaybackIndicators";
import { Button } from "@/components/ui/button";
import { formatArtists } from "@/lib/format";
import { trackCoverUrl } from "@/lib/media";
import type { Track } from "@/lib/types";
import { useCoverLight } from "@/lib/useCoverTone";

function EnabledRadioHero({ tracks, offline = false }: { tracks: Track[]; offline?: boolean }) {
  const t = useT();
  const state = usePlayerState();
  const player = usePlayerActions();
  const start = useMutation({ mutationFn: () => player.startRadio() });
  const active = Boolean(state.radioSession);
  const playing = active && state.isPlaying;
  const current = active ? state.currentTrack : null;
  const next = active ? state.nextTrack : null;
  const featured = tracks.find((track) => track.hasCover) ?? tracks[0];
  const art = current ?? featured;
  const sleeves = tracks
    .filter(
      (track, index, all) =>
        track.hasCover &&
        (track.albumId ?? track.id) !== (featured?.albumId ?? featured?.id) &&
        all.findIndex((other) => (other.albumId ?? other.id) === (track.albumId ?? track.id)) ===
          index,
    )
    .slice(0, 2);
  const lightTrack = sleeves[0] ?? featured;
  const light = useCoverLight(lightTrack ? trackCoverUrl(lightTrack, "thumb") : null);
  const action = start.isPending
    ? t("menu.radioStarting")
    : playing
      ? t("action.pause")
      : active
        ? t("radio.resume")
        : t("radio.start");

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
        <div className="radio-info">
          <p className="radio-description" aria-hidden={current ? true : undefined}>
            {t(offline ? "radio.localDescription" : "radio.description")}
          </p>
          <div className="radio-status" role="status">
            {current && (
              <>
                <span className="radio-status-indicator" aria-hidden="true">
                  {playing ? <NowPlayingBars /> : <span className="radio-status-dot" />}
                </span>
                <div className="radio-status-copy">
                  <span className="radio-status-track" title={current.title}>
                    {current.title}
                  </span>
                  <span className="radio-status-caption" title={formatArtists(current)}>
                    {formatArtists(current)} · {playing ? t("radio.onAir") : t("radio.paused")}
                  </span>
                  {next && (
                    <span className="radio-status-caption" title={next.title}>
                      {t("player.upNextNamed", { title: next.title })}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        <Button
          variant="primary"
          size="auto"
          className="radio-start"
          data-playing={playing}
          disabled={start.isPending}
          aria-busy={start.isPending}
          aria-label={`${t("radio.mine")}: ${action}`}
          onClick={() => (active ? player.toggle() : start.mutate())}
        >
          {start.isPending ? (
            <LoaderCircleIcon size={22} className="motion-safe:animate-spin" aria-hidden="true" />
          ) : playing ? (
            <PauseIcon size={22} className="fill-current" aria-hidden="true" />
          ) : (
            <PlayIcon size={22} className="translate-x-px fill-current" aria-hidden="true" />
          )}
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
    </section>
  );
}

export function RadioHero({
  offline = false,
  ...props
}: import("react").ComponentProps<typeof EnabledRadioHero> & { offline?: boolean }) {
  const enabled = useRecommendations();
  return offline || enabled ? <EnabledRadioHero {...props} offline={offline} /> : null;
}
