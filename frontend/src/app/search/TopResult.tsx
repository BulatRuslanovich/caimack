// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { genreName } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatArtists } from "@/lib/format";
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
    <Section title={t("search.topResult")} className="h-full min-w-0">
      {top.kind === "Track" && top.track ? (
        <TrackTop track={top.track} />
      ) : top.kind === "Album" && top.album ? (
        <Card
          href={`/albums/${top.album.id}`}
          kind={t("albums.kind")}
          title={top.album.title}
          subtitle={top.album.artistName}
          art={<AlbumCover album={top.album} />}
          action={<PlayAllButton tracks={album.data?.tracks ?? []} name={top.album.title} />}
        />
      ) : top.kind === "Artist" && top.artist ? (
        <Card
          href={`/artists/${top.artist.id}`}
          kind={t("artists.kind")}
          title={top.artist.name}
          subtitle={t("count.tracks", { count: top.artist.trackCount })}
          round
          art={<ArtistCover artist={top.artist} />}
          action={<PlayAllButton tracks={artist.data?.tracks.items ?? []} name={top.artist.name} />}
        />
      ) : top.genre ? (
        <Card
          href={`/genres?id=${top.genre.id}`}
          kind={t("field.genre")}
          title={genreName(top.genre.name)}
          subtitle={t("count.tracks", { count: top.genre.trackCount })}
          art={<AlbumMosaic albumIds={top.genre.coverAlbumIds} name={top.genre.name} />}
        />
      ) : null}
    </Section>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="listening-panel relative flex min-w-0 flex-1 items-center gap-5 rounded-lg bg-card p-5 max-md:gap-4 max-md:p-4 lg:group-data-beside/top:flex-col lg:group-data-beside/top:items-start lg:group-data-beside/top:justify-between">
      {children}
    </div>
  );
}

const actionClass =
  "mt-2 lg:group-data-beside/top:absolute lg:group-data-beside/top:right-5 lg:group-data-beside/top:bottom-5 lg:group-data-beside/top:mt-0";

function Card<T extends string>({
  href,
  kind,
  title,
  subtitle,
  art,
  round = false,
  action,
}: {
  href: Route<T>;
  kind: string;
  title: string;
  subtitle: ReactNode;
  art: ReactNode;
  round?: boolean;
  action?: ReactNode;
}) {
  return (
    <Shell>
      <span
        className={cn(
          "size-28 shrink-0 overflow-hidden rounded-xs shadow-art max-md:size-20 lg:group-data-beside/top:size-32",
          round && "rounded-full",
        )}
      >
        {art}
      </span>

      <span className="flex min-w-0 max-w-full flex-1 flex-col gap-1 lg:group-data-beside/top:w-full lg:group-data-beside/top:pr-16">
        <Caption>{kind}</Caption>
        <Link
          href={href}
          className="line-clamp-2 wrap-anywhere text-title font-semibold hover:no-underline"
        >
          {title}
        </Link>
        <span className="truncate text-muted-foreground">{subtitle}</span>
        {action && <span className={actionClass}>{action}</span>}
      </span>
    </Shell>
  );
}

function TrackTop({ track }: { track: NonNullable<SearchTopResult["track"]> }) {
  const t = useT();

  return (
    <Shell>
      <span className="size-28 shrink-0 overflow-hidden rounded-xs shadow-art max-md:size-20 lg:group-data-beside/top:size-32">
        <TrackCover track={track} variant="full" />
      </span>

      <span className="flex min-w-0 max-w-full flex-1 flex-col gap-1 lg:group-data-beside/top:w-full lg:group-data-beside/top:pr-16">
        <Caption>{t("nav.tracks")}</Caption>
        <span className="line-clamp-2 wrap-anywhere text-title font-semibold">{track.title}</span>
        <span className="truncate text-muted-foreground">{formatArtists(track)}</span>
        <span className={actionClass}>
          <PlayAllButton tracks={[track]} name={track.title} />
        </span>
      </span>
    </Shell>
  );
}
