// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { PlaybackDevices } from "./PlaybackDevices";

import { useT } from "@/contexts/I18nContext";
import {
  useArtworkDirection,
  usePlayer,
  usePlayerClock,
  usePlayerState,
} from "@/contexts/PlayerContext";
import { cn } from "@/lib/cn";
import { displayTitleClass, formatArtists, formatDuration } from "@/lib/format";
import { leanBack } from "@/lib/leanBack";
import { planTransition } from "@/lib/playback/transitions";
import { useConnect } from "@/lib/playback/useConnectPlayback";
import { usePlaybackProgress } from "@/lib/playback/usePlaybackProgress";
import { prepareVinylDeck, releaseVinylDeck } from "@/lib/playback/vinylDeck";
import { reasonLabel } from "@/lib/recommendationReason";
import { SEEK_STEP } from "@/lib/shortcuts";
import { useTatarMafia } from "@/lib/tatarMafia";
import type { Track } from "@/lib/types";
import { useIdle } from "@/lib/useIdle";
import {
  EllipsisVerticalIcon,
  HeartIcon,
  ImageIcon,
  ListVideoIcon,
  MicVocalIcon,
  SofaIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { PlayerBackdrop } from "./ArtBackdrop";
import { ArtworkScene } from "./ArtworkScene";
import { ArtistLinks } from "./ArtistLinks";
import { PlayerEffectsBackdrop } from "./PlayerEffectsBackdrop";
import { PlayerTransport } from "./PlayerTransport";
import { PlayerPanelTransport } from "./PlayerPanelTransport";
import { PlayerOptionsMenu } from "./PlayerOptionsMenu";
import { PlayerVolume } from "./PlayerVolume";
import { RecordTransition } from "./RecordTransition";
import { SleepTimerButton } from "./SleepTimerButton";
import { StreamQuality } from "./StreamQuality";
import { TrackMenu } from "./TrackMenu";
import { Button } from "./ui/button";
import { WaveformSeekbar } from "./WaveformSeekbar";
import { Loading } from "./Loading";
import { FullPlayerLayout, fullPlayerStage, fullPlayerControls } from "./FullPlayerLayout";

const IDLE_MS = 2500;

// A cold panel chunk must suspend locally, keeping the fullscreen dialog mounted.
const DJControls = dynamic(() => import("./DJControls").then((m) => m.DJControls), {
  loading: () => null,
});
import { QueueList } from "./QueueList";
const LyricsPane = dynamic(() => import("./LyricsPane").then((m) => m.LyricsPane), {
  loading: () => <Loading />,
});
const ShareCardDialog = dynamic(() => import("./ShareCardDialog").then((m) => m.ShareCardDialog), {
  loading: () => null,
});

function FullScreenProgress({ track, chrome }: { track: Track; chrome: string }) {
  const t = useT();
  const progress = usePlaybackProgress(track.durationSeconds);
  const { nextTrack, crossfade, smartTransitions, repeat, sleepTimer } = usePlayerState();

  const plan =
    !smartTransitions || sleepTimer?.kind === "trackEnd"
      ? null
      : planTransition({
          crossfade,
          smart: smartTransitions,
          canFade: true,
          repeat,
          current: track,
          currentDuration: progress.total,
          next: nextTrack,
        });

  return (
    <div className="flex flex-col gap-0.5">
      <WaveformSeekbar
        trackId={track.id}
        cues={smartTransitions ? track.cues : null}
        transition={
          plan && nextTrack
            ? {
                at: plan.at,
                label: t("player.transitionAt", { title: nextTrack.title }),
              }
            : null
        }
        value={progress.position}
        max={progress.total}
        onSeek={progress.seek}
        ariaLabel={progress.seekLabel}
        valueText={progress.valueText}
        keyStep={SEEK_STEP}
        tooltip={formatDuration}
        commitOnRelease
      />
      <div
        className={cn("flex justify-between text-xs text-muted-foreground tabular-nums", chrome)}
      >
        <span>{formatDuration(progress.position)}</span>
        <button
          type="button"
          onClick={progress.toggleRemainingTime}
          aria-label={progress.toggleRemainingLabel}
          className="rounded-sm tabular-nums hover:text-foreground"
        >
          {progress.endLabel}
        </button>
      </div>
    </div>
  );
}

function ShareCardButton({ track }: { track: Track }) {
  const t = useT();
  const getPosition = usePlayerClock();
  const [sharing, setSharing] = useState<number | null>(null);

  return (
    <>
      <Button
        variant="ghost"
        size="icon-lg"
        onClick={() => setSharing(getPosition())}
        aria-label={t("share.card")}
        title={t("share.card")}
      >
        <ImageIcon size={20} />
      </Button>

      {sharing !== null && (
        <ShareCardDialog track={track} positionSeconds={sharing} onClose={() => setSharing(null)} />
      )}
    </>
  );
}

interface FullScreenPlayerProps {
  onClose: () => void;
  onToggleFavorite: () => void;
}

export function FullScreenPlayer(props: FullScreenPlayerProps) {
  const { currentTrack } = usePlayerState();
  const artworkDirection = useArtworkDirection();
  if (!currentTrack) return null;
  return (
    <ArtworkScene track={currentTrack} direction={artworkDirection}>
      <FullScreenPlayerContent {...props} />
    </ArtworkScene>
  );
}

function FullScreenPlayerContent({ onClose, onToggleFavorite }: FullScreenPlayerProps) {
  const player = usePlayer();
  const tatarMafia = useTatarMafia();
  const connect = useConnect();
  const djMode = tatarMafia && !connect.selectedId;
  const t = useT();
  const [panel, setPanel] = useState<"art" | "queue" | "lyrics">("art");
  const [menuOpen, setMenuOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const track = player.currentTrack;
  const trackId = track?.id;
  const trackDuration = track?.durationSeconds;
  const idle = useIdle(IDLE_MS, panel === "art" && !menuOpen && !optionsOpen && !djMode);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!trackId || trackDuration === undefined || connect.selectedId) return;
    const controller = new AbortController();
    void prepareVinylDeck(trackId, trackDuration, controller.signal);
    return () => {
      controller.abort();
      releaseVinylDeck();
    };
  }, [trackId, trackDuration, connect.selectedId]);

  const chrome = cn(
    "transition-opacity duration-300 ease-brand focus-within:opacity-100",
    idle && "opacity-0",
  );

  if (!track) return null;

  const reason = player.radioSession?.reasons[track.id];
  const secondaryActions = (
    <div className="flex items-center justify-between gap-2 lg:hidden">
      <PlaybackDevices compact />
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label={panel === "lyrics" ? t("lyrics.hide") : t("lyrics.show")}
        aria-pressed={panel === "lyrics"}
        onClick={() => setPanel(panel === "lyrics" ? "art" : "lyrics")}
      >
        <MicVocalIcon size={22} />
      </Button>
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label={t("queue.label")}
        aria-pressed={panel === "queue"}
        onClick={() => setPanel(panel === "queue" ? "art" : "queue")}
      >
        <ListVideoIcon size={22} />
      </Button>
    </div>
  );

  return (
    <FullPlayerLayout
      onClose={onClose}
      stage={stage}
      artworkShown={panel === "art"}
      chrome={chrome}
      backdrop={
        <>
          <PlayerBackdrop />
          <PlayerEffectsBackdrop playing={player.isPlaying && !player.buffering} />
        </>
      }
      actions={
        <>
          <div className="hidden justify-self-end max-lg:block">
            <PlayerOptionsMenu track={track} onOpenChange={setOptionsOpen}>
              {(close) => (
                <>
                  <div className="flex min-h-12 items-center justify-between gap-3">
                    <span>{t("share.card")}</span>
                    <ShareCardButton track={track} />
                  </div>
                  <Button
                    variant="ghost"
                    className="h-auto min-h-11 whitespace-normal py-3"
                    onClick={() => {
                      close();
                      setMenuOpen(true);
                    }}
                  >
                    {t("tracks.moreActions", { title: track.title })}
                  </Button>
                </>
              )}
            </PlayerOptionsMenu>
          </div>
          <div className="flex items-center gap-1 justify-self-end max-lg:hidden">
            <PlaybackDevices compact />
            <StreamQuality track={track} className="mr-1 max-sm:hidden" />

            <SleepTimerButton size="icon-lg" />

            <ShareCardButton track={track} />

            <Button
              variant="ghost"
              size="icon-lg"
              className="max-sm:hidden pointer-coarse:hidden"
              onClick={() => {
                onClose();
                leanBack.show();
              }}
              aria-label={t("leanBack.open")}
              title={t("leanBack.open")}
            >
              <SofaIcon size={20} />
            </Button>

            <Button
              variant="ghost"
              size="icon-lg"
              className={cn(panel === "lyrics" && "text-primary")}
              onClick={() => setPanel((open) => (open === "lyrics" ? "art" : "lyrics"))}
              aria-label={panel === "lyrics" ? t("lyrics.hide") : t("lyrics.show")}
              aria-pressed={panel === "lyrics"}
              title={t("lyrics.title")}
            >
              <MicVocalIcon size={20} />
            </Button>

            <Button
              variant="ghost"
              size="icon-lg"
              className={cn(panel === "queue" && "text-primary")}
              onClick={() => setPanel((open) => (open === "queue" ? "art" : "queue"))}
              aria-label={t("queue.label")}
              aria-pressed={panel === "queue"}
            >
              <ListVideoIcon size={20} />
            </Button>
          </div>
        </>
      }
    >
      <div
        ref={stage}
        className={cn(
          fullPlayerStage,
          panel === "art" ? "max-lg:overflow-y-auto" : "max-lg:gap-0 max-lg:overflow-hidden",
        )}
      >
        {panel === "art" && (
          <div className="flex min-h-0 flex-[1.2] items-center justify-end pr-[min(40%,20vh)] max-lg:flex-[1_0_auto] max-lg:justify-center max-lg:pt-[calc(min(76vw,22rem)*0.22+1rem)] max-lg:pr-0">
            <RecordTransition
              out
              spinning={player.isPlaying && !player.buffering}
              scratchable
              aura
              axis="responsive"
              sizes="(max-width: 1023px) min(76vw, 22rem), min(48vh, 28rem)"
              transitionCover
              className="w-[min(100%,48vh)] max-lg:w-[min(76vw,22rem)]"
            />
          </div>
        )}

        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col justify-center gap-6 max-lg:flex-none max-lg:pb-4",
            djMode &&
              "lg:overflow-x-hidden lg:overflow-y-auto lg:py-3 lg:[justify-content:safe_center]",
            panel !== "art" && "max-lg:hidden lg:max-w-[50%] lg:flex-none lg:basis-1/2",
          )}
        >
          <div className={cn(fullPlayerControls, panel !== "art" && "lg:mx-auto")}>
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <h2 className={cn("text-balance wrap-anywhere", displayTitleClass(track.title))}>
                  {track.title}
                </h2>
                <p className="text-muted-foreground">
                  <ArtistLinks
                    track={track}
                    onNavigate={onClose}
                    className="font-medium text-foreground"
                  />
                  {track.albumId && (
                    <>
                      {", "}
                      <Link href={`/albums/${track.albumId}`} onClick={onClose}>
                        {track.albumTitle}
                      </Link>
                    </>
                  )}
                </p>
                {reason && <p className="text-sm text-faint">{reasonLabel(reason, t)}</p>}
              </div>
              <Button
                variant="ghost"
                size="icon-lg"
                className={cn("shrink-0", track.isFavorite && "text-primary hover:text-primary")}
                onClick={onToggleFavorite}
                aria-label={
                  track.isFavorite ? t("tracks.removeFromFavorites") : t("tracks.addToFavorites")
                }
                aria-pressed={track.isFavorite}
              >
                <HeartIcon className={track.isFavorite ? "fill-current" : undefined} />
              </Button>
            </div>

            <FullScreenProgress track={track} chrome={chrome} />

            <PlayerTransport size="full" />
            {secondaryActions}

            {djMode && <DJControls key={track.id} track={track} />}

            {player.nextTrack && (
              <button
                type="button"
                onClick={() => setPanel("queue")}
                className={cn(
                  "-mt-2 truncate text-center text-sm text-muted-foreground hover:text-foreground",
                  chrome,
                )}
              >
                {t("player.upNextNamed", {
                  title: `${player.nextTrack.title} — ${formatArtists(player.nextTrack)}`,
                })}
              </button>
            )}

            <div className={cn("flex items-center gap-2", chrome)}>
              <Suspense fallback={null}>
                <TrackMenu
                  track={track}
                  open={menuOpen}
                  onOpenChange={setMenuOpen}
                  onNavigate={onClose}
                  isFavorite={track.isFavorite}
                  onToggleFavorite={onToggleFavorite}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon-lg"
                      className="max-lg:hidden"
                      aria-label={t("tracks.moreActions", { title: track.title })}
                    >
                      <EllipsisVerticalIcon />
                    </Button>
                  }
                />
              </Suspense>

              <div className="ml-auto flex w-[12.5rem] max-w-[50%] items-center gap-2 pointer-coarse:hidden">
                <PlayerVolume size="icon-lg" />
              </div>
            </div>
          </div>
        </div>

        {panel === "lyrics" && (
          <div className="min-h-0 flex-1 overflow-y-auto scroll-smooth px-4 [scrollbar-width:none] motion-reduce:scroll-auto [&::-webkit-scrollbar]:hidden">
            <LyricsPane
              key={track.id}
              track={track}
              onSeek={player.seek}
              onLyricsKnown={(hasLyrics) => player.patchTrack(track.id, { hasLyrics })}
            />
          </div>
        )}

        {panel === "queue" && (
          <div className="flex min-h-0 flex-1 flex-col pt-3 lg:max-w-[36rem]">
            <QueueList />
          </div>
        )}
      </div>

      {panel !== "art" && (
        <div className="relative z-1 -mx-5 shrink-0 border-t border-border bg-background/95 px-5 pt-2 lg:hidden">
          <PlayerPanelTransport onShowArtwork={() => setPanel("art")} />
          {secondaryActions}
        </div>
      )}
    </FullPlayerLayout>
  );
}

export { AudiobookFullScreenPlayer } from "./audiobooks/AudiobookFullScreenPlayer";
