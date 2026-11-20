// SPDX-License-Identifier: AGPL-3.0-only

import { PauseIcon, PlayIcon } from "lucide-react";
import {
  PlaybackRowNumber,
  playbackDurationClass,
  playbackGridClass,
  playbackHeaderClass,
  playbackListClass,
  playbackNumberClass,
  playbackRowClass,
  playbackTitleClass,
} from "@/components/PlaybackListRows";
import { Caption } from "@/components/ui/caption";
import { useAudiobooks } from "@/contexts/AudiobookContext";
import { useT } from "@/contexts/I18nContext";
import type { Audiobook } from "@/lib/audiobooks";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";

const chapterGrid = cn(
  playbackGridClass,
  "grid-cols-[2rem_minmax(0,1fr)_3.5rem] max-md:grid-cols-[2.125rem_minmax(0,1fr)_auto]",
);

export function AudiobookChapterList({ book }: { book: Audiobook }) {
  const t = useT();
  const { online, downloaded, player } = useAudiobooks();
  const playable = online || downloaded.has(book.id);

  return (
    <div className={playbackListClass}>
      <div className={cn(chapterGrid, playbackHeaderClass)} aria-hidden="true">
        <Caption className="max-md:invisible">#</Caption>
        <Caption>{t("column.title")}</Caption>
        <Caption className="text-right">{t("column.duration")}</Caption>
      </div>
      <ol role="list">
        {book.chapters.map((chapter, index) => {
          const current =
            player.active?.book.id === book.id && player.active.chapterIndex === index;
          const playing = current && player.playing;
          const Icon = playing ? PauseIcon : PlayIcon;
          return (
            <li key={chapter.id}>
              <button
                type="button"
                disabled={!playable}
                aria-current={current ? "true" : undefined}
                aria-label={t(playing ? "audiobooks.pauseNamed" : "action.playNamed", {
                  name: chapter.title,
                })}
                data-striped={index % 2 === 0 || undefined}
                className={cn(
                  chapterGrid,
                  playbackRowClass(current),
                  "w-full text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring disabled:opacity-55",
                )}
                onClick={() => player.play(book, chapter.id)}
              >
                <span className={cn(playbackNumberClass, "h-9 max-md:h-10 pointer-coarse:h-11")}>
                  <PlaybackRowNumber
                    number={index + 1}
                    current={current}
                    playing={playing}
                    className="group-focus-visible:hidden"
                  />
                  <span
                    className={cn("hidden [@media(hover:none)]:inline", current && "text-primary")}
                  >
                    {index + 1}
                  </span>
                  <span
                    aria-hidden="true"
                    className="hidden size-7 place-items-center rounded-full text-foreground hover:bg-accent group-hover:grid max-md:size-8 [@media(hover:hover)]:group-focus-visible:grid"
                  >
                    <Icon size={14} />
                  </span>
                </span>
                <span
                  className={cn(playbackTitleClass, current && "text-primary")}
                  title={chapter.title}
                >
                  {chapter.title}
                </span>
                <span className={playbackDurationClass}>
                  {chapter.durationMs > 0 && formatDuration(chapter.durationMs / 1000)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
