// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { artistImageUrl, trackCoverUrl } from "@/lib/media";
import { queries } from "@/lib/queries";
import { busiestDay, dominantDaypart, monthName } from "@/lib/recap";
import type { Recap, Track } from "@/lib/types";
import { useI18n, useT } from "@/contexts/I18nContext";
import { ArtBackdrop } from "@/components/ArtBackdrop";
import { Loading } from "@/components/Loading";
import {
  BusiestDay,
  Discoveries,
  Hours,
  Intro,
  Mood,
  Sound,
  Summary,
  Time,
  TopArtist,
  TopTrack,
} from "@/components/recap/slides";
import { Button } from "@/components/ui/button";

const SLIDE_MS = 7000;

const segment = "block h-full rounded-full bg-foreground";

const HOLD_MS = 250;

interface Slide {
  key: string;
  art: string | null;
  body: ReactNode;
}

export default function RecapPage() {
  const router = useRouter();
  const recap = useQuery(queries.recap());

  const missing = recap.isError || recap.data === null;

  useEffect(() => {
    if (missing) router.replace("/");
  }, [missing, router]);

  return (
    <div className="fixed inset-0 z-95 overflow-hidden bg-background text-foreground">
      {recap.data ? (
        <Story recap={recap.data} onClose={() => router.push("/")} />
      ) : (
        <div className="grid h-full place-items-center">
          <Loading />
        </div>
      )}
    </div>
  );
}

function Story({ recap, onClose }: { recap: Recap; onClose: () => void }) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const slides = useSlides(recap, onClose, () => setIndex(0));

  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const hidden = useDocumentHidden();
  const downAt = useRef(0);

  const last = slides.length - 1;
  const slide = slides[Math.min(index, last)];
  const running = !paused && !held && !hidden;

  const go = useCallback(
    (step: number) => setIndex((current) => Math.min(Math.max(current + step, 0), last)),
    [last],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") go(1);
      else if (event.key === "ArrowLeft") go(-1);
      else if (event.key === " ") {
        event.preventDefault();
        setPaused((value) => !value);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const zone = (step: number) => ({
    onPointerDown: () => {
      downAt.current = Date.now();
      setHeld(true);
    },
    onPointerUp: () => setHeld(false),
    onPointerLeave: () => setHeld(false),
    onPointerCancel: () => setHeld(false),
    onClick: () => {
      if (Date.now() - downAt.current < HOLD_MS) go(step);
    },
  });

  return (
    <DialogPrimitive.Root open onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Content asChild aria-describedby={undefined}>
        <section className="h-full outline-none">
          <DialogPrimitive.Title className="sr-only">{t("recap.title")}</DialogPrimitive.Title>
          <ArtBackdrop src={slide.art} mode="stage" />

          <div className="relative mx-auto flex h-full max-w-xl flex-col gap-4 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <div className="flex gap-1" aria-hidden="true">
              {slides.map((item, position) => (
                <span
                  key={item.key}
                  className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/20"
                >
                  {position < index && <span className={segment} />}
                  {position === index && (
                    <span
                      key={index}
                      className={cn(segment, "recap-progress")}
                      style={{
                        animationDuration: `${SLIDE_MS}ms`,
                        animationPlayState: running ? "running" : "paused",
                      }}
                      onAnimationEnd={() => go(1)}
                    />
                  )}
                </span>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">{t("recap.title")}</span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setPaused((value) => !value)}
                  aria-label={paused ? t("recap.resume") : t("recap.pause")}
                >
                  {paused ? <PlayIcon size={18} /> : <PauseIcon size={18} />}
                </Button>
                <Button variant="ghost" size="icon" onClick={onClose} aria-label={t("recap.close")}>
                  <XIcon size={20} />
                </Button>
              </div>
            </div>

            <div className="relative min-h-0 flex-1">
              <button
                type="button"
                aria-label={t("recap.previous")}
                className="absolute inset-y-0 left-0 w-1/3 cursor-w-resize outline-none"
                {...zone(-1)}
              />
              <button
                type="button"
                aria-label={t("recap.next")}
                className="absolute inset-y-0 right-0 w-2/3 cursor-e-resize outline-none"
                {...zone(1)}
              />

              <div
                key={slide.key}
                className={cn(
                  "pointer-events-none relative flex h-full flex-col justify-center gap-6 overflow-y-auto",
                  "animate-in duration-500 fade-in-0 slide-in-from-bottom-4 motion-reduce:animate-none",
                  "[&_a]:pointer-events-auto [&_button]:pointer-events-auto",
                )}
              >
                {slide.body}
              </div>
            </div>
          </div>

          {index > 0 && (
            <SideArrow side="left" label={t("recap.previous")} onClick={() => go(-1)} />
          )}
          {index < last && <SideArrow side="right" label={t("recap.next")} onClick={() => go(1)} />}
        </section>
      </DialogPrimitive.Content>
    </DialogPrimitive.Root>
  );
}

function SideArrow({
  side,
  label,
  onClick,
}: {
  side: "left" | "right";
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="secondary"
      size="icon-lg"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "absolute top-1/2 -translate-y-1/2 max-md:hidden",
        side === "left"
          ? "left-[max(1.5rem,calc(50%-22rem))]"
          : "right-[max(1.5rem,calc(50%-22rem))]",
      )}
    >
      {side === "left" ? <ChevronLeftIcon /> : <ChevronRightIcon />}
    </Button>
  );
}

function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return hidden;
}

function useSlides(recap: Recap, onClose: () => void, onRestart: () => void): Slide[] {
  const { locale } = useI18n();
  const month = monthName(recap.year, recap.month, locale);

  const artist = recap.topArtists[0]?.artist;
  const track = recap.topTracks[0]?.track;
  const artistArt = artist
    ? artistImageUrl({ artistId: artist.id, hasImage: artist.hasImage, variant: "thumb" })
    : null;
  const trackArt = (item?: Track | null) => (item ? trackCoverUrl(item, "thumb") : null);
  const fallbackArt = artistArt ?? trackArt(track);
  const peak = busiestDay(recap.daySeconds);
  const hours = dominantDaypart(recap.hourSeconds);

  const slides: Slide[] = [
    {
      key: "intro",
      art: trackArt(track) ?? fallbackArt,
      body: <Intro recap={recap} month={month} />,
    },
    { key: "time", art: fallbackArt, body: <Time recap={recap} /> },
  ];

  if (artist) slides.push({ key: "artist", art: artistArt, body: <TopArtist recap={recap} /> });
  if (track)
    slides.push({
      key: "track",
      art: trackArt(track) ?? fallbackArt,
      body: <TopTrack recap={recap} />,
    });
  if (peak)
    slides.push({ key: "day", art: fallbackArt, body: <BusiestDay recap={recap} peak={peak} /> });
  if (hours)
    slides.push({
      key: "hours",
      art: fallbackArt,
      body: <Hours hourSeconds={recap.hourSeconds} {...hours} />,
    });
  if (recap.moods.length > 0)
    slides.push({ key: "mood", art: fallbackArt, body: <Mood recap={recap} /> });
  if (recap.soundOfMonth) {
    slides.push({
      key: "sound",
      art: trackArt(recap.soundOfMonth) ?? fallbackArt,
      body: <Sound track={recap.soundOfMonth} />,
    });
  }
  if (recap.newArtists != null)
    slides.push({
      key: "discoveries",
      art: fallbackArt,
      body: <Discoveries count={recap.newArtists} picks={recap.newArtistPicks} />,
    });

  slides.push({
    key: "summary",
    art: fallbackArt,
    body: <Summary recap={recap} month={month} onClose={onClose} onRestart={onRestart} />,
  });

  return slides;
}
