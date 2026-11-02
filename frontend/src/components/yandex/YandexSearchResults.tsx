// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useQuery } from "@tanstack/react-query";
import { MusicIcon, SearchIcon } from "lucide-react";
import { queries } from "@/lib/queries";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { YandexAlbum, YandexTrack } from "@/lib/types";
import { CardGrid, Section } from "@/components/PageHeader";
import { Query } from "@/components/Query";
import { useT } from "@/contexts/I18nContext";
import { YandexImportButton } from "./YandexImportButton";

export function YandexSearchResults({ query }: { query: string }) {
  const t = useT();
  const result = useQuery(queries.yandexSearch(query));
  return (
    <Query
      result={result}
      isEmpty={(data) => data.tracks.length === 0 && data.albums.length === 0}
      empty={{ icon: <SearchIcon size={24} />, title: t("search.nothingFound") }}
    >
      {(data) => (
        <>
          {data.tracks.length > 0 && (
            <Section title={t("nav.tracks")}>
              <ul className="flex flex-col">
                {data.tracks.map((track) => (
                  <TrackRow key={track.id} track={track} />
                ))}
              </ul>
            </Section>
          )}
          {data.albums.length > 0 && (
            <Section title={t("nav.albums")}>
              <CardGrid>
                {data.albums.map((album) => (
                  <AlbumCard key={album.id} album={album} />
                ))}
              </CardGrid>
            </Section>
          )}
        </>
      )}
    </Query>
  );
}

function Artwork({ url, className }: { url?: string | null; className?: string }) {
  return url ? (
    <img src={url} alt="" loading="lazy" className={cn("bg-raised object-cover", className)} />
  ) : (
    <span
      aria-hidden="true"
      className={cn("grid place-items-center bg-raised text-faint", className)}
    >
      <MusicIcon size={22} />
    </span>
  );
}

function TrackRow({ track }: { track: YandexTrack }) {
  return (
    <li className="library-track-row flex min-h-14 items-center gap-3 rounded-md px-2.5 text-sm hover:bg-card max-md:gap-2 max-md:px-0">
      <Artwork url={track.coverUrl} className="library-track-cover size-10 shrink-0 rounded-xs" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("truncate font-semibold", !track.available && "text-muted-foreground")}>
          {track.title}
        </span>
        <span className="library-secondary truncate">{track.artist}</span>
        {track.album && (
          <span className="library-tertiary truncate text-xs md:hidden">{track.album}</span>
        )}
      </span>
      {track.album && (
        <span className="library-secondary min-w-0 flex-1 truncate max-lg:hidden">
          {track.album}
        </span>
      )}
      <span className="mr-3 shrink-0 text-muted-foreground tabular-nums max-md:hidden">
        {formatDuration(track.durationSeconds)}
      </span>
      <YandexImportButton
        source={{
          kind: "Track",
          id: track.id,
          title: track.title,
          artist: track.artist,
          coverUrl: track.coverUrl,
        }}
        inLibrary={track.inLibrary}
        unavailable={!track.available && !track.inLibrary}
      />
    </li>
  );
}

function AlbumCard({ album }: { album: YandexAlbum }) {
  const t = useT();
  return (
    <article className="flex min-w-0 flex-col gap-2.5">
      <Artwork url={album.coverUrl} className="aspect-square w-full rounded-xs" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 text-sm font-medium">{album.title}</span>
        <span className="truncate text-sm text-muted-foreground">{album.artist}</span>
        <span className="text-xs text-faint">
          {[album.year, album.trackCount ? t("count.tracks", { count: album.trackCount }) : null]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      <div className="max-w-full self-start">
        <YandexImportButton
          source={{
            kind: "Album",
            id: album.id,
            title: album.title,
            artist: album.artist,
            coverUrl: album.coverUrl,
          }}
        />
      </div>
    </article>
  );
}
