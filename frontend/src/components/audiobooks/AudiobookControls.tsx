// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useAudiobookClock, useAudiobooks } from "@/contexts/AudiobookContext";
import { useT } from "@/contexts/I18nContext";
import type { Audiobook } from "@/lib/audiobooks";
import { cn } from "@/lib/cn";
import { RotateCcwIcon, RotateCwIcon } from "lucide-react";
import { useState } from "react";
import { LibrarySaveIcon } from "../LibrarySaveButton";
import { PlayerProgress, PlayerProgressLine } from "../PlayerProgress";
import { TransportButtons } from "../PlayerTransport";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

export const BOOK_SKIP_MS = 15_000;
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

export function AudiobookTransport({ size = "bar" }: { size?: "bar" | "full" }) {
  const t = useT();
  const { player } = useAudiobooks();
  const active = player.active;
  const large = size === "full";
  const skipButton = (direction: -1 | 1) => {
    const label = t(direction === -1 ? "audiobooks.back15" : "audiobooks.forward15");
    const Icon = direction === -1 ? RotateCcwIcon : RotateCwIcon;
    return (
      <Button
        variant="ghost"
        size={large ? "icon-lg" : "icon"}
        className="relative"
        onClick={() => player.skip(direction * BOOK_SKIP_MS)}
        aria-label={label}
        title={label}
      >
        <Icon size={large ? 25 : 20} />
        <span aria-hidden="true" className="absolute text-[8px] font-semibold">
          15
        </span>
      </Button>
    );
  };
  if (!active) return null;

  return (
    <TransportButtons
      size={size}
      playing={player.playing}
      buffering={player.pending}
      toggle={() => !player.pending && player.toggle()}
      previous={{
        label: t("audiobooks.previousChapter"),
        run: () => player.changeChapter(-1),
        disabled: active.chapterIndex === 0,
      }}
      next={{
        label: t("audiobooks.nextChapter"),
        run: () => player.changeChapter(1),
        disabled: active.chapterIndex + 1 >= active.book.chapters.length,
      }}
      before={skipButton(-1)}
      after={skipButton(1)}
    />
  );
}

export function AudiobookProgress({ expanded, line }: { expanded?: boolean; line?: boolean }) {
  const t = useT();
  const { player } = useAudiobooks();
  const { durationMs, positionMs } = useAudiobookClock();
  const position = positionMs / 1000;
  const total = durationMs / 1000;

  return line ? (
    <PlayerProgressLine position={position} total={total} />
  ) : (
    <PlayerProgress
      expanded={expanded}
      position={position}
      total={total}
      seek={(seconds) => player.seek(seconds * 1000)}
      seekLabel={t("audiobooks.position")}
    />
  );
}

export function AudiobookSpeed() {
  const t = useT();
  const { player } = useAudiobooks();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("audiobooks.speed")}
          title={t("audiobooks.speed")}
          className="text-sm tabular-nums"
        >
          {player.speed}×
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup
          value={String(player.speed)}
          onValueChange={(value) => player.setSpeed(Number(value))}
        >
          {SPEEDS.map((value) => (
            <DropdownMenuRadioItem key={value} value={String(value)}>
              {value}×
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AudiobookSaveButton({
  book,
  className,
  size = "icon",
}: {
  book: Audiobook;
  className?: string;
  size?: "icon" | "icon-lg";
}) {
  const t = useT();
  const { save, online, books } = useAudiobooks();
  const [saving, setSaving] = useState(false);
  const current = books.find(({ id }) => id === book.id) ?? book;
  const label = t(current.saved ? "collection.remove" : "collection.add");
  return (
    <Button
      variant="ghost"
      size={size}
      className={cn(current.saved && "text-primary hover:text-primary", className)}
      aria-label={label}
      aria-pressed={current.saved}
      aria-busy={saving}
      title={label}
      disabled={!online || saving}
      onClick={() => {
        setSaving(true);
        void save(current).finally(() => setSaving(false));
      }}
    >
      <LibrarySaveIcon key={current.id} saved={current.saved} />
    </Button>
  );
}
