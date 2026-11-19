// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { formatArtists, genreName } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import type { Route } from "next";
import { PrefetchLink as Link } from "@/components/PrefetchLink";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { queries } from "@/lib/queries";
import type { SearchTopResult } from "@/lib/types";
import { useT } from "@/contexts/I18nContext";
import { AlbumMosaic } from "@/components/collection/CoverMosaic";
import { AlbumCover, ArtistCover, TrackCover } from "@/components/Cover";
import { PlayAllButton } from "@/components/PlayAllButton";
import { Caption } from "@/components/ui/caption";
import { Section } from "@/components/PageHeader";

export function TopResult({ top }: { top: SearchTopResult }) {
  const t = useT();

  const albumId = top.kind === "Album" ? top.album?.id : undefined;
  const artistId = top.kind === "Artist" ? top.artist?.id : undefined;

  const album = useQuery({ ...queries.album(albumId ?? ""), enabled: albumId !== undefined });
  const artist = useQuery({ ...queries.artist(artistId ?? ""), enabled: artistId !== undefined });

  return (
    <Section title={t("search.topResult")} className="min-w-0 gap-2.5">
      {top.kind === "Track" && top.track ? (
        <Card
          kind={t("nav.tracks")}
          title={top.track.title}
          subtitle={formatArtists(top.track)}
          art={<TrackCover track={top.track} variant="full" />}
          action={
            <PlayAllButton
              tracks={[top.track]}
              name={top.track.title}
              className="size-10 pointer-coarse:size-11"
            />
          }
        />
      ) : top.kind === "Album" && top.album ? (
        <Card
          href={`/albums/${top.album.id}`}
          kind={t("albums.kind")}
          title={top.album.title}
          subtitle={top.album.artistName}
          art={<AlbumCover album={top.album} />}
          action={
            <PlayAllButton
              tracks={album.data?.tracks ?? []}
              name={top.album.title}
              className="size-10 pointer-coarse:size-11"
            />
          }
        />
      ) : top.kind === "Artist" && top.artist ? (
        <Card
          href={`/artists/${top.artist.id}`}
          kind={t("artists.kind")}
          title={top.artist.name}
          subtitle={t("count.tracks", { count: top.artist.trackCount })}
          round
          art={<ArtistCover artist={top.artist} />}
          action={
            <PlayAllButton
              tracks={artist.data?.tracks.items ?? []}
              name={top.artist.name}
              className="size-10 pointer-coarse:size-11"
            />
          }
        />
      ) : top.genre ? (
        <Card
          href={`/search?tab=genres&id=${top.genre.id}`}
          kind={t("field.genre")}
          title={genreName(top.genre.name)}
          subtitle={t("count.tracks", { count: top.genre.trackCount })}
          art={<AlbumMosaic albumIds={top.genre.coverAlbumIds} name={top.genre.name} />}
        />
      ) : null}
    </Section>
  );
}

function Card<T extends string>({
  href,
  kind,
  title,
  subtitle,
  art,
  round = false,
  action,
}: {
  href?: Route<T>;
  kind: string;
  title: string;
  subtitle: ReactNode;
  art: ReactNode;
  round?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className="listening-panel flex min-w-0 items-center gap-3 rounded-lg bg-card p-3">
      <span
        className={cn(
          "size-16 shrink-0 overflow-hidden rounded-xs shadow-art max-sm:size-12",
          round && "rounded-full",
        )}
      >
        {art}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Caption>{kind}</Caption>
        <span className="line-clamp-2 wrap-anywhere text-lg leading-tight font-semibold">
          {href ? <Link href={href}>{title}</Link> : title}
        </span>
        <span className="truncate text-sm text-muted-foreground">{subtitle}</span>
      </div>
      {action}
    </div>
  );
}
