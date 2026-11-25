// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useT } from "@/contexts/I18nContext";
import { usePlayerProgress, usePlayerClock, usePlayerState } from "@/contexts/PlayerContext";
import { activeLineAt, WordPainter } from "@/lib/lyrics";
import { queries } from "@/lib/queries";
import type { Track, LyricWord } from "@/lib/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MicVocalIcon, PencilIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { memo, useEffect, useRef, useState } from "react";
import { EmptyState } from "./EmptyState";
import { Loading } from "./Loading";
import { Button } from "./ui/button";

const EditLyricsDialog = dynamic(() =>
  import("./EditLyricsDialog").then((m) => m.EditLyricsDialog),
);

export function LyricsPane({
  track,
  onSeek,
  onLyricsKnown,
}: {
  track: Track;
  onSeek: (seconds: number) => void;
  onLyricsKnown: (hasLyrics: boolean) => void;
}) {
  const t = useT();
  const { position } = usePlayerProgress();
  const { isAdmin } = useAuth();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [following, setFollowing] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLOListElement>(null);
  const wordPainter = useRef<WordPainter | null>(null);
  const getPosition = usePlayerClock();
  const { isPlaying, buffering } = usePlayerState();

  const query = useQuery({
    ...queries.lyrics(track.id),
    refetchInterval: (query) => (query.state.data === null ? 15_000 : false),
  });
  const lyrics = query.data ?? null;
  const lines = lyrics?.lines ?? [];
  const current = activeLineAt(lines, position * 1000);

  useEffect(() => {
    const panel = scroller.current;
    const list = root.current;
    if (!following || !panel || !list) return;
    const line = list.children[current];
    const readingInset = Number.parseFloat(getComputedStyle(list).paddingBlockStart);
    const top = line
      ? panel.scrollTop +
        line.getBoundingClientRect().top -
        panel.getBoundingClientRect().top -
        readingInset
      : 0;
    panel.scrollTo({ top: Math.max(0, top) });
  }, [following, current, lyrics]);

  function pauseFollowing() {
    const panel = scroller.current;
    if (!following || !lines.length || !panel || panel.scrollHeight <= panel.clientHeight) return;
    panel.scrollTo({ top: panel.scrollTop, behavior: "instant" });
    setFollowing(false);
  }

  useEffect(() => {
    if (!root.current || !lyrics?.lines.some((line) => line.words?.length)) return;
    const rows = Array.from(
      root.current.querySelectorAll<HTMLLIElement>("li[data-lyric-index]"),
    ).map((row) => Array.from(row.querySelectorAll<HTMLElement>(".lyric-word")));
    const painter = new WordPainter(lyrics.lines, rows);
    wordPainter.current = painter;
    painter.paint(getPosition() * 1000, true);
    return () => {
      wordPainter.current = null;
    };
  }, [lyrics, getPosition]);

  useEffect(() => {
    const painter = wordPainter.current;
    if (!painter) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame: number | null = null;
    const paint = (force = false) => {
      const at = getPosition() * 1000;
      painter.paint(at, force);
      if (isPlaying && !buffering && !document.hidden && !reduced.matches) {
        frame = requestAnimationFrame(() => {
          frame = null;
          paint();
        });
      }
    };
    const resume = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      paint(true);
    };
    paint(true);
    document.addEventListener("visibilitychange", resume);
    reduced.addEventListener("change", resume);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", resume);
      reduced.removeEventListener("change", resume);
    };
  }, [lyrics, getPosition, isPlaying, buffering]);

  useEffect(() => {
    wordPainter.current?.paint(position * 1000);
  }, [position]);

  useEffect(() => {
    if (!query.isSuccess) return;

    const has = query.data !== null;
    if (has !== track.hasLyrics) onLyricsKnown(has);
  }, [query.isSuccess, query.data, track.hasLyrics, onLyricsKnown]);

  return (
    <div className="lyrics-pane relative flex min-h-0 min-w-0 flex-1">
      <div
        ref={scroller}
        tabIndex={0}
        role="region"
        aria-label={t("lyrics.title")}
        className="min-h-0 flex-1 overflow-y-auto scroll-smooth px-2 [scrollbar-width:none] sm:px-4 motion-reduce:scroll-auto [&::-webkit-scrollbar]:hidden"
        onWheel={(event) => {
          if (event.deltaY && !event.ctrlKey) pauseFollowing();
        }}
        onTouchMove={pauseFollowing}
        onKeyDown={(event) => {
          const scrollKey = ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(
            event.key,
          );
          if (scrollKey || (event.key === " " && event.target === event.currentTarget)) {
            pauseFollowing();
          }
        }}
      >
        {isAdmin && query.isSuccess && (
          <div className="sticky top-0 z-1 flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <PencilIcon size={14} />
              {t("lyrics.edit")}
            </Button>
          </div>
        )}

        {editing && (
          <EditLyricsDialog
            track={track}
            lyrics={lyrics}
            onClose={() => setEditing(false)}
            onSaved={(saved) => client.setQueryData(queries.lyrics(track.id).queryKey, saved)}
          />
        )}

        {body()}
        {lyrics?.provider && (
          <p className="lyrics-credit py-4 text-xs text-muted-foreground">
            {safeCreditUrl(lyrics.attribution?.url) ? (
              <a
                href={lyrics.attribution!.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4"
              >
                {lyrics.provider}
              </a>
            ) : (
              lyrics.provider
            )}
            {lyrics.attribution?.submitter && (
              <>
                {" "}
                ·{" "}
                {safeCreditUrl(lyrics.attribution.submitterUrl) ? (
                  <a
                    href={lyrics.attribution.submitterUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4"
                  >
                    {lyrics.attribution.submitter}
                  </a>
                ) : (
                  lyrics.attribution.submitter
                )}
              </>
            )}
          </p>
        )}
      </div>
      {!following && lines.length > 0 && (
        <Button
          variant="secondary"
          size="sm"
          className="absolute right-4 bottom-3 z-2 min-h-11 bg-popover shadow-lg"
          onClick={() => {
            scroller.current?.focus({ preventScroll: true });
            setFollowing(true);
          }}
        >
          {t("lyrics.follow")}
        </Button>
      )}
    </div>
  );

  function body() {
    if (query.isError) {
      return <EmptyState bare icon={<MicVocalIcon size={24} />} title={t("lyrics.failed")} />;
    }
    if (query.isPending) return <Loading />;
    if (!lyrics) {
      return <EmptyState bare icon={<MicVocalIcon size={24} />} title={t("lyrics.none")} />;
    }

    if (lines.length === 0) {
      return (
        <p className="lyrics-plain leading-[1.7] whitespace-pre-wrap text-muted-foreground">
          {lyrics.plain}
        </p>
      );
    }

    return (
      <ol
        ref={root}
        className="lyrics-lines"
        onPointerEnter={() => setBrowsing(true)}
        onPointerLeave={() => setBrowsing(false)}
        onFocus={() => setBrowsing(true)}
        onBlur={() => setBrowsing(false)}
      >
        {lines.map((line, index) => (
          <LyricLine
            key={`${line.at}-${index}`}
            text={line.text}
            words={line.words}
            index={index}
            background={line.background}
            active={index === current}
            dim={visible(index - current, browsing || !following)}
            at={line.at / 1000}
            onSeek={onSeek}
          />
        ))}
      </ol>
    );
  }
}

const PASSED = [1, 0.48, 0.38, 0.28, 0.22];
const UPCOMING = [1, 0.67, 0.53, 0.42, 0.33, 0.26];

const dim = (distance: number) => (distance < 0 ? PASSED : UPCOMING)[Math.abs(distance)] ?? 0.18;

const BROWSING_FLOOR = 0.62;

const visible = (distance: number, browsing: boolean) =>
  browsing ? Math.max(dim(distance), BROWSING_FLOOR) : dim(distance);

const LyricLine = memo(function LyricLine({
  text,
  words,
  index,
  background,
  active,
  dim,
  at,
  onSeek,
}: {
  text: string;
  words?: LyricWord[];
  index: number;
  background?: boolean;
  active: boolean;
  dim: number;
  at: number;
  onSeek: (seconds: number) => void;
}) {
  const t = useT();

  return (
    <li
      data-lyric-index={index}
      data-background-line={background || undefined}
      aria-current={active}
      style={{ opacity: dim }}
      className="lyric-line motion-reduce:transition-none"
    >
      {text ? (
        <button
          type="button"
          onClick={(event) => {
            const word = (event.target as HTMLElement).closest<HTMLElement>("[data-word-at]");
            onSeek(word ? Number(word.dataset.wordAt) / 1000 : at);
          }}
          aria-label={t("lyrics.seekTo", { line: text })}
          className="lyric-line-text"
        >
          {words?.length
            ? words.map((word, i) => (
                <span key={`${word.at}-${i}`} className="lyric-word" data-word-at={word.at}>
                  {word.text}
                </span>
              ))
            : text}
        </button>
      ) : (
        <span className="lyric-line-text" aria-hidden="true">
          &nbsp;
        </span>
      )}
    </li>
  );
});

function safeCreditUrl(value?: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "unison.betterlyrics.org";
  } catch {
    return false;
  }
}
