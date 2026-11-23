// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from "react";
import { useT } from "@/contexts/I18nContext";
import { MusicSourceIcon } from "@/integrations/MusicSourceIcon";
import type { MusicSource, PlaylistSnapshot } from "@/integrations/music";
import { formatDuration } from "@/lib/format";

const PREVIEW_LIMIT = 20;

export function PlaylistImportPanel({
  title,
  source,
  preview,
  children,
}: {
  title: string;
  source?: MusicSource;
  preview?: PlaylistSnapshot;
  children: ReactNode;
}) {
  const t = useT();
  const count = preview?.tracks.length ?? 0;

  return (
    <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex min-w-0 items-center gap-3 px-4 py-4 sm:gap-4 sm:px-5">
        <MusicSourceIcon source={source?.id} size={44} />
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold leading-tight" title={title}>
            {title}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {source && <span>{source.name ?? source.id}</span>}
            {source && preview && <span aria-hidden>·</span>}
            {preview && <span>{t("count.tracks", { count })}</span>}
          </p>
        </div>
      </header>
      {preview && (preview.partial || preview.omitted > 0) && (
        <p className="px-4 pb-3 text-xs text-muted-foreground sm:px-5">
          {[
            preview.partial && t("music.partial"),
            preview.omitted > 0 && t("music.omitted", { count: preview.omitted }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {count > 0 && (
        <div className="border-t border-border">
          <ol
            aria-label={t("music.previewTracks")}
            tabIndex={count > 6 ? 0 : undefined}
            className="max-h-72 divide-y divide-border overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            {preview?.tracks.slice(0, PREVIEW_LIMIT).map((track, position) => (
              <li
                key={`${position}:${track.source}:${track.id}`}
                className="flex min-w-0 items-center gap-3 px-4 py-2.5 sm:px-5"
              >
                <span
                  className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground"
                  aria-hidden
                >
                  {position + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={track.title}>
                    {track.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground" title={track.artist}>
                    {track.artist}
                  </p>
                </div>
                {track.duration > 0 && (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatDuration(track.duration)}
                  </span>
                )}
              </li>
            ))}
          </ol>
          {count > PREVIEW_LIMIT && (
            <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground sm:px-5">
              {t("music.previewLimit", { count: PREVIEW_LIMIT })}
            </p>
          )}
        </div>
      )}
      <div className="grid min-w-0 gap-3 border-t border-border px-4 py-3 sm:px-5">{children}</div>
    </div>
  );
}
