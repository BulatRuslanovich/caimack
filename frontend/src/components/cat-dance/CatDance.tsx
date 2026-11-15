// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { useI18n } from "@/contexts/I18nContext";
import { usePlayerActions, usePlayerClock, usePlayerState } from "@/contexts/PlayerContext";
import { CAT_CLIPS, CAT_SLIDESHOW, catPlaybackPosition, catPlaybackRate } from "@/lib/catSlideshow";
import type { Track } from "@/lib/types";
import { useMotionVisibility } from "@/lib/useMotionVisibility";
import { Button } from "../ui/button";
import { catDanceCopy } from "./copy";
import { useCatSlides } from "./useCatSlides";

export function CatDance({ onClose }: { onClose: () => void }) {
  const { currentTrack, isPlaying, buffering, muted, volume } = usePlayerState();
  const { toggle, previous, next } = usePlayerActions();
  const getPosition = usePlayerClock();
  return (
    <CatSlideshow
      track={currentTrack}
      playing={isPlaying}
      buffering={buffering}
      muted={muted || volume === 0}
      getPosition={getPosition}
      onToggle={toggle}
      onPrevious={previous}
      onNext={next}
      onClose={onClose}
    />
  );
}

interface CatSlideshowProps {
  track: Track | null;
  playing: boolean;
  buffering?: boolean;
  muted?: boolean;
  getPosition: () => number;
  onToggle: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}

export function CatSlideshow({
  track,
  playing,
  buffering = false,
  muted = false,
  getPosition,
  onToggle,
  onPrevious,
  onNext,
  onClose,
}: CatSlideshowProps) {
  const { locale } = useI18n();
  const copy = catDanceCopy(locale);
  const { reduced, visible } = useMotionVisibility();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [automatic, setAutomatic] = useState(true);
  const active = !!track && playing && !buffering && !muted && visible && !reduced;
  const { slides, select } = useCatSlides({
    trackId: track?.id ?? null,
    active,
    automatic,
    reduced,
    bpm: track?.cues?.bpm,
    audioStart: track?.cues?.audioStart,
    getPosition,
  });
  const status = !track
    ? null
    : buffering
      ? copy.buffering
      : muted
        ? copy.muted
        : !playing
          ? copy.paused
          : reduced
            ? copy.reduced
            : null;

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="cat-dance-overlay" />
        <Dialog.Content
          ref={dialogRef}
          className="cat-dance"
          data-testid="cat-dance"
          tabIndex={-1}
          style={{ "--cat-dissolve": `${CAT_SLIDESHOW.dissolveMs}ms` } as CSSProperties}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            dialogRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document.querySelector<HTMLElement>("#content")?.focus({ preventScroll: true });
          }}
          onKeyDown={(event) => {
            if (event.code === "Space" && event.target === event.currentTarget && track) {
              event.preventDefault();
              onToggle();
            }
          }}
        >
          <Dialog.Title className="sr-only">{copy.title}</Dialog.Title>
          <Dialog.Description className="sr-only">{copy.description}</Dialog.Description>
          <div className="cat-dance-top">
            <span>{copy.escape}</span>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-lg" aria-label={copy.close}>
                <X size={21} />
              </Button>
            </Dialog.Close>
          </div>
          <div className="cat-dance-stage" aria-hidden="true">
            {CAT_CLIPS.map((clip, index) => (
              <CatVideo
                key={clip.id}
                clip={clip}
                selected={slides.current === index}
                outgoing={!reduced && slides.previous === index}
                transitioning={slides.previous !== null && !reduced}
                active={active && slides.current === index}
                trackId={track?.id ?? null}
                bpm={track?.cues?.bpm}
                audioStart={track?.cues?.audioStart ?? 0}
                getPosition={getPosition}
              />
            ))}
          </div>
          <nav className="cat-dance-thumbnails" aria-label={copy.title}>
            {CAT_CLIPS.map((clip, index) => (
              <button
                key={clip.id}
                type="button"
                className="cat-dance-thumbnail"
                aria-label={`${copy.cat} ${index + 1}`}
                aria-pressed={slides.current === index}
                onClick={() => select(index)}
              >
                <Image src={clip.poster} alt="" width={64} height={64} unoptimized />
              </button>
            ))}
          </nav>
          <footer className="cat-dance-footer">
            <div className="cat-dance-track">
              <strong title={track?.title}>{track?.title ?? copy.noTrack}</strong>
              <span>
                {track?.artistName ?? ""}
                <span role="status">{status ? ` · ${status}` : null}</span>
              </span>
            </div>
            <div className="cat-dance-playback">
              <Button
                variant="ghost"
                size="icon-lg"
                disabled={!track}
                aria-label={copy.previous}
                onClick={onPrevious}
              >
                <SkipBack size={20} fill="currentColor" />
              </Button>
              <Button
                variant="play"
                size="play"
                disabled={!track}
                aria-label={playing ? copy.pause : copy.play}
                onClick={onToggle}
              >
                {playing ? (
                  <Pause size={23} fill="currentColor" />
                ) : (
                  <Play size={23} fill="currentColor" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon-lg"
                disabled={!track}
                aria-label={copy.next}
                onClick={onNext}
              >
                <SkipForward size={20} fill="currentColor" />
              </Button>
            </div>
            <div className="cat-dance-options">
              <Button
                variant="ghost"
                size="auto"
                className="cat-dance-auto"
                aria-label={copy.automaticLabel}
                aria-pressed={automatic}
                onClick={() => setAutomatic((value) => !value)}
              >
                <i aria-hidden="true" />
                {copy.automatic}
              </Button>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CatVideo({
  clip,
  selected,
  outgoing,
  transitioning,
  active,
  trackId,
  bpm,
  audioStart,
  getPosition,
}: {
  clip: (typeof CAT_CLIPS)[number];
  selected: boolean;
  outgoing: boolean;
  transitioning: boolean;
  active: boolean;
  trackId: string | null;
  bpm?: number | null;
  audioStart: number;
  getPosition: () => number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    const play = () => {
      if (!active || cancelled) return;
      const rate = catPlaybackRate(video.duration, bpm);
      video.playbackRate = rate;
      if (Number.isFinite(video.duration) && video.duration > 0)
        video.currentTime = catPlaybackPosition(getPosition(), audioStart, video.duration, rate);
      void video.play().catch(() => {
        /* The poster remains available if autoplay is blocked. */
      });
    };
    if (active) {
      if (video.readyState >= 1) play();
      else video.addEventListener("loadedmetadata", play, { once: true });
    } else video.pause();
    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", play);
      video.pause();
    };
  }, [active, trackId, bpm, audioStart, getPosition]);
  const state = selected ? "current" : outgoing ? "outgoing" : "hidden";
  return (
    <div className="cat-dance-clip" data-state={state} data-transition={transitioning}>
      <Image src={clip.poster} alt="" fill unoptimized sizes="100vw" />
      <video
        ref={videoRef}
        src={clip.video}
        poster={clip.poster}
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        data-ready={ready && !failed}
        onLoadedData={() => setReady(true)}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
