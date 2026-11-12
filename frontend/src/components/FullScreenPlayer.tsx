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
import { reasonLabel } from "@/lib/recommendationReason";
import { SEEK_STEP } from "@/lib/shortcuts";
import { useTatarMafia } from "@/lib/tatarMafia";
import type { Track } from "@/lib/types";
import { useIdle } from "@/lib/useIdle";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  ChevronDownIcon,
  EllipsisVerticalIcon,
  HeartIcon,
  ImageIcon,
  ListVideoIcon,
  MicVocalIcon,
  SofaIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PlayerBackdrop } from "./ArtBackdrop";
import { ArtworkScene } from "./ArtworkScene";
import { ArtistLinks } from "./ArtistLinks";
import { PlayerEffectsBackdrop } from "./PlayerEffectsBackdrop";
import { PlayerTransport } from "./PlayerTransport";
import { PlayerVolume } from "./PlayerVolume";
import { RecordTransition } from "./RecordTransition";
import { SleepTimerButton } from "./SleepTimerButton";
import { StreamQuality } from "./StreamQuality";
import { TrackMenu } from "./TrackMenu";
import { Button } from "./ui/button";
import { WaveformSeekbar } from "./WaveformSeekbar";

const IDLE_MS = 2500;

const SWIPE_CLOSE_PX = 120;

const DJControls = dynamic(() => import("./DJControls").then((m) => m.DJControls));
const QueueList = dynamic(() => import("./QueueList").then((m) => m.QueueList));
const LyricsPane = dynamic(() => import("./LyricsPane").then((m) => m.LyricsPane));
const ShareCardDialog = dynamic(() => import("./ShareCardDialog").then((m) => m.ShareCardDialog));

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

export function FullScreenPlayer({
  onClose,
  onToggleFavorite,
}: {
  onClose: () => void;
  onToggleFavorite: () => void;
}) {
  const player = usePlayer();
  const artworkDirection = useArtworkDirection();
  const tatarMafia = useTatarMafia();
  const connect = useConnect();
  const djMode = tatarMafia && !connect.selectedId;
  const t = useT();
  const [panel, setPanel] = useState<"art" | "queue" | "lyrics">("art");
  const [menuOpen, setMenuOpen] = useState(false);
  const track = player.currentTrack;
  const idle = useIdle(IDLE_MS, panel === "art" && !menuOpen && !djMode);
  const stage = useRef<HTMLDivElement>(null);
  const swipeFrom = useRef<number | null>(null);

  useEffect(() => {
    let lock: Promise<WakeLockSentinel | undefined> | undefined;
    const acquire = () => {
      if (document.visibilityState !== "visible") return;
      lock = navigator.wakeLock?.request("screen").catch(() => undefined);
    };

    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      document.removeEventListener("visibilitychange", acquire);
      void lock?.then((sentinel) => sentinel?.release());
    };
  }, []);

  const chrome = cn(
    "transition-opacity duration-300 ease-brand focus-within:opacity-100",
    idle && "opacity-0",
  );

  if (!track) return null;

  const reason = player.radioSession?.reasons[track.id];

  return (
    <ArtworkScene track={track} direction={artworkDirection}>
      <DialogPrimitive.Root open onOpenChange={(next) => !next && onClose()}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Content asChild aria-describedby={undefined}>
            <div
              data-player-fullscreen="true"
              data-aura-host
              onTouchStart={(event) => {
                const atTop = (stage.current?.scrollTop ?? 0) === 0;
                swipeFrom.current = panel === "art" && atTop ? event.touches[0].clientY : null;
              }}
              onTouchEnd={(event) => {
                const from = swipeFrom.current;
                swipeFrom.current = null;
                if (from !== null && event.changedTouches[0].clientY - from > SWIPE_CLOSE_PX)
                  onClose();
              }}
              className="fixed inset-0 z-90 flex flex-col overflow-hidden bg-background px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            >
              <DialogPrimitive.Title className="sr-only">
                {t("player.nowPlaying")}
              </DialogPrimitive.Title>

              <PlayerBackdrop />
              <PlayerEffectsBackdrop playing={player.isPlaying && !player.buffering} />

              <header
                className={cn(
                  "relative z-1 grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 max-sm:flex max-sm:justify-between max-sm:gap-0",
                  chrome,
                )}
              >
                <Button
                  variant="ghost"
                  size="icon-lg"
                  className="justify-self-start max-sm:size-10"
                  onClick={onClose}
                  aria-label={t("player.closeFull")}
                >
                  <ChevronDownIcon size={22} />
                </Button>

                <span className="text-sm text-muted-foreground max-sm:hidden">
                  {t("player.nowPlaying")}
                </span>

                <div className="flex items-center gap-1 justify-self-end max-sm:gap-0 max-sm:[&_button]:size-10">
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
              </header>

              <div
                ref={stage}
                className="relative z-1 flex min-h-0 flex-1 gap-[clamp(2rem,5vw,5rem)] max-lg:-mx-5 max-lg:flex-col max-lg:overflow-x-hidden max-lg:overflow-y-auto max-lg:px-5"
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
                  <div
                    className={cn(
                      "flex w-full max-w-[34rem] flex-col gap-6 max-lg:mx-auto",
                      panel !== "art" && "lg:mx-auto",
                    )}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <h2
                          className={cn(
                            "line-clamp-3 text-balance",
                            displayTitleClass(track.title),
                          )}
                        >
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
                        className={cn(
                          "shrink-0",
                          track.isFavorite && "text-primary hover:text-primary",
                        )}
                        onClick={onToggleFavorite}
                        aria-label={
                          track.isFavorite
                            ? t("tracks.removeFromFavorites")
                            : t("tracks.addToFavorites")
                        }
                        aria-pressed={track.isFavorite}
                      >
                        <HeartIcon className={track.isFavorite ? "fill-current" : undefined} />
                      </Button>
                    </div>

                    <FullScreenProgress track={track} chrome={chrome} />

                    <PlayerTransport size="full" />

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
                            aria-label={t("tracks.moreActions", { title: track.title })}
                          >
                            <EllipsisVerticalIcon />
                          </Button>
                        }
                      />

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
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </ArtworkScene>
  );
}
