// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { formatArtists } from "@/lib/format";
import { activeLineAt } from "@/lib/lyrics";
import { trackCoverUrl } from "@/lib/media";
import { queries } from "@/lib/queries";
import { SHARE_CARD_SIZES, renderShareCard, type ShareCardFormat } from "@/lib/shareCard";
import { useToast } from "@/lib/useToast";
import type { Track } from "@/lib/types";
import { saveFile } from "@/lib/download";
import { useT } from "@/contexts/I18nContext";
import { Loading } from "./Loading";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";
import { Switch } from "./ui/switch";
import { ToggleGroup, ToggleGroupButton } from "./ui/toggle-group";
import { CopyIcon, DownloadIcon, Share2Icon } from "lucide-react";

const FORMATS: ShareCardFormat[] = ["story", "square"];

export function ShareCardDialog({
  track,
  positionSeconds = 0,
  onClose,
}: {
  track: Track;
  positionSeconds?: number;
  onClose: () => void;
}) {
  const t = useT();
  const { notify, notifyError } = useToast();
  const [format, setFormat] = useState<ShareCardFormat>("story");
  const [withLyric, setWithLyric] = useState(true);
  const [card, setCard] = useState<{ blob: Blob; url: string } | null>(null);

  const lyrics = useQuery({ ...queries.lyrics(track.id), enabled: track.hasLyrics });
  const waveform = useQuery(queries.waveform(track.id));

  const lines = lyrics.data?.lines ?? [];
  const lineIndex = activeLineAt(lines, positionSeconds * 1000);
  const lyric =
    (lineIndex >= 0
      ? lines[lineIndex]?.text
      : lines.find((line) => line.text.trim())?.text
    )?.trim() || null;

  const ready = !lyrics.isFetching && !waveform.isFetching;
  const fileName = `${track.title} — ${formatArtists(track)}.png`.replace(/[\\/:*?"<>|]/g, "_");

  useEffect(() => {
    if (!ready) return;

    let cancelled = false;
    let url: string | null = null;

    void renderShareCard(
      {
        title: track.title,
        artist: formatArtists(track),
        album: track.albumTitle,
        coverUrl: trackCoverUrl(track, "full"),
        lyric: withLyric ? lyric : null,
        peaks: waveform.data,
        progress: track.durationSeconds > 0 ? positionSeconds / track.durationSeconds : 0,
        caption: t("share.caption"),
      },
      format,
    )
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setCard({ blob, url });
      })
      .catch((error: unknown) => {
        if (!cancelled) notifyError(error);
      });

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [ready, format, withLyric, lyric, waveform.data, track, positionSeconds, t, notifyError]);

  const file = card ? new File([card.blob], fileName, { type: "image/png" }) : null;
  const canShareFile =
    file !== null &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] });
  const canCopy = typeof ClipboardItem !== "undefined" && !!navigator.clipboard?.write;

  const share = async () => {
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: track.title });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      notifyError(error, t("menu.shareFailed"));
    }
  };

  const copy = async () => {
    if (!card) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": card.blob })]);
      notify(t("share.copied"), "success");
    } catch (error) {
      notifyError(error, t("menu.shareFailed"));
    }
  };

  const { width, height } = SHARE_CARD_SIZES[format];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={t("share.title")}
        footer={
          <>
            {canShareFile && (
              <Button variant="primary" disabled={!card} onClick={() => void share()}>
                <Share2Icon size={16} /> {t("menu.share")}
              </Button>
            )}
            <Button
              variant={canShareFile ? "outline" : "primary"}
              disabled={!card}
              onClick={() => card && saveFile({ blob: card.blob, fileName })}
            >
              <DownloadIcon size={16} /> {t("share.download")}
            </Button>
            {canCopy && (
              <Button variant="outline" disabled={!card} onClick={() => void copy()}>
                <CopyIcon size={16} /> {t("share.copy")}
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ToggleGroup aria-label={t("share.format")}>
              {FORMATS.map((value) => (
                <ToggleGroupButton
                  key={value}
                  active={format === value}
                  onClick={() => setFormat(value)}
                >
                  {t(`share.format.${value}`)}
                </ToggleGroupButton>
              ))}
            </ToggleGroup>

            {lyric && format === "story" && (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Switch checked={withLyric} onCheckedChange={setWithLyric} />
                {t("share.withLyric")}
              </label>
            )}
          </div>

          <div
            className="mx-auto grid w-full max-w-[20rem] place-items-center overflow-hidden rounded-md bg-raised"
            style={{ aspectRatio: `${width} / ${height}` }}
          >
            {card ? (
              <img
                src={card.url}
                alt={t("share.preview")}
                className="h-full w-full object-contain"
              />
            ) : (
              <Loading />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
