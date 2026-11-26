// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useAudiobooks } from "@/contexts/AudiobookContext";
import { PlaybackDevices } from "../PlaybackDevices";
import { useT } from "@/contexts/I18nContext";
import { audiobookHref } from "@/lib/audiobooks";
import { cn } from "@/lib/cn";
import { displayTitleClass } from "@/lib/format";
import { ListVideoIcon, XIcon } from "lucide-react";
import { useRef } from "react";
import { ArtBackdrop } from "../ArtBackdrop";
import { FullPlayerLayout, fullPlayerControls, fullPlayerStage } from "../FullPlayerLayout";
import { VolumeControls } from "../PlayerVolume";
import { PrefetchLink } from "../PrefetchLink";
import { SleepTimerControl } from "../SleepTimerButton";
import { Button } from "../ui/button";
import {
  AudiobookProgress,
  AudiobookSaveButton,
  AudiobookSpeed,
  AudiobookTransport,
} from "./AudiobookControls";
import { AudiobookCover } from "./AudiobookViews";

export function AudiobookFullScreenPlayer({
  artwork,
  onClose,
  restoreFocus,
}: {
  artwork: string | null;
  onClose: () => void;
  restoreFocus?: () => void;
}) {
  const t = useT();
  const { player } = useAudiobooks();
  const stage = useRef<HTMLDivElement>(null);
  const active = player.active;
  if (!active) return null;
  const { book, chapterIndex } = active;
  const chapter = book.chapters[chapterIndex];
  const credits = [
    book.author,
    book.narrator && t("audiobooks.narrator", { name: book.narrator }),
  ].filter(Boolean);

  return (
    <FullPlayerLayout
      onClose={onClose}
      restoreFocus={restoreFocus}
      stage={stage}
      backdrop={<ArtBackdrop src={artwork} mode="player" />}
      actions={
        <div className="flex justify-self-end">
          {player.setSleepTimer && (
            <SleepTimerControl
              audiobook
              size="icon-lg"
              sleepTimer={player.sleepTimer}
              setSleepTimer={player.setSleepTimer}
            />
          )}
          <Button asChild variant="ghost" size="icon-lg">
            <PrefetchLink
              href={audiobookHref(book.id)}
              onClick={onClose}
              aria-label={t("audiobooks.chapters")}
              title={t("audiobooks.chapters")}
            >
              <ListVideoIcon size={22} />
            </PrefetchLink>
          </Button>
        </div>
      }
    >
      <div ref={stage} className={cn(fullPlayerStage, "max-lg:overflow-y-auto")}>
        <div className="flex min-h-0 min-w-0 flex-[1.2] items-center justify-end max-lg:flex-[1_0_auto] max-lg:justify-center max-lg:pt-5">
          <AudiobookCover
            book={book}
            artwork={artwork}
            className="w-[min(100%,72dvh)] rounded-2xl shadow-art max-lg:w-[min(100%,88vw,54dvh)]"
            style={{ viewTransitionName: "player-artwork" }}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col justify-center max-lg:flex-none max-lg:pb-4">
          <div className={fullPlayerControls}>
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <h2 className={cn("text-balance wrap-anywhere", displayTitleClass(book.title))}>
                  {book.title}
                </h2>
                {credits.length > 0 && (
                  <p className="text-muted-foreground">{credits.join(" · ")}</p>
                )}
                <p className="text-sm text-faint">{chapter.title}</p>
              </div>
              <AudiobookSaveButton book={book} size="icon-lg" className="shrink-0" />
            </div>

            <AudiobookProgress expanded />
            <AudiobookTransport size="full" />

            <div className="flex items-center justify-between gap-2">
              <PlaybackDevices compact transferBook={player.transferTo} />
              <AudiobookSpeed />
              <div className="ml-auto flex w-[12.5rem] max-w-[50%] items-center gap-2 pointer-coarse:hidden">
                <VolumeControls {...player} size="icon-lg" />
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={player.close}
                aria-label={t("audiobooks.closePlayer")}
                title={t("audiobooks.closePlayer")}
              >
                <XIcon size={18} />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </FullPlayerLayout>
  );
}
