// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import dynamic from "next/dynamic";
import { memo, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { activeLineAt } from "@/lib/lyrics";
import { queries } from "@/lib/queries";
import type { Track } from "@/lib/types";
import { usePlayerProgress } from "@/contexts/PlayerContext";
import { useAuth } from "@/contexts/AuthContext";
import { useT } from "@/contexts/I18nContext";
import { MicVocalIcon, PencilIcon } from "lucide-react";
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

  const query = useQuery(queries.lyrics(track.id));
  const lyrics = query.data ?? null;
  const lines = lyrics?.lines ?? [];
  const current = activeLineAt(lines, position * 1000);

  useEffect(() => {
    if (!query.isSuccess) return;

    const has = query.data !== null;
    if (has !== track.hasLyrics) onLyricsKnown(has);
  }, [query.isSuccess, query.data, track.hasLyrics, onLyricsKnown]);

  return (
    <>
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
    </>
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
        <p className="text-center leading-[1.7] whitespace-pre-wrap text-muted-foreground">
          {lyrics.plain}
        </p>
      );
    }

    return (
      <ol
        className="flex flex-col gap-10 pt-[22vh] pb-[78vh] text-center md:gap-14"
        onPointerEnter={() => setBrowsing(true)}
        onPointerLeave={() => setBrowsing(false)}
        onFocus={() => setBrowsing(true)}
        onBlur={() => setBrowsing(false)}
      >
        {lines.map((line, index) => (
          <LyricLine
            key={`${line.at}-${index}`}
            text={line.text}
            active={index === current}
            dim={visible(index - current, browsing)}
            onSeek={() => onSeek(line.at / 1000)}
          />
        ))}
      </ol>
    );
  }
}

const PASSED = [1, 0.12];
const UPCOMING = [1, 0.5, 0.34, 0.18];

const dim = (distance: number) => (distance < 0 ? PASSED : UPCOMING)[Math.abs(distance)] ?? 0;

const BROWSING_FLOOR = 0.4;

const visible = (distance: number, browsing: boolean) =>
  browsing ? Math.max(dim(distance), BROWSING_FLOOR) : dim(distance);

const LyricLine = memo(function LyricLine({
  text,
  active,
  dim,
  onSeek,
}: {
  text: string;
  active: boolean;
  dim: number;
  onSeek: () => void;
}) {
  const t = useT();
  const element = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (active) element.current?.scrollIntoView({ block: "start" });
  }, [active]);

  const styling = cn(
    "block w-full text-2xl leading-[1.15] font-bold tracking-tight text-balance text-foreground transition-transform duration-300 ease-brand sm:text-4xl md:text-5xl motion-reduce:transition-none",
    active && "scale-[1.02] motion-reduce:scale-100",
  );

  return (
    <li
      ref={element}
      aria-current={active}
      style={{ opacity: dim }}
      className="scroll-mt-[22vh] transition-opacity duration-300 ease-brand motion-reduce:transition-none"
    >
      {text ? (
        <button
          type="button"
          onClick={onSeek}
          aria-label={t("lyrics.seekTo", { line: text })}
          className={cn(
            styling,
            "rounded-md px-3 py-1 hover:bg-foreground/10 focus-visible:bg-foreground/10 focus-visible:outline-none",
          )}
        >
          {text}
        </button>
      ) : (
        <span className={styling}> </span>
      )}
    </li>
  );
});
