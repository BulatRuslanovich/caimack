// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useQuery } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { yandexQueries } from "./api";
import type { YandexAlbum, YandexTrack } from "./types";
import { CardGrid, Section } from "@/components/PageHeader";
import { Query } from "@/components/Query";
import { useT } from "@/contexts/I18nContext";
import { YandexImportButton } from "./YandexImportButton";
import { ProviderArtwork, ProviderTrack } from "../ui";

export function YandexSearchResults({ query }: { query: string }) {
  const t = useT();
  const result = useQuery(yandexQueries.yandexSearch(query));
  return (
    <Query
      result={result}
      isEmpty={(data) => data.tracks.length === 0 && data.albums.length === 0}
      empty={{ icon: <SearchIcon size={24} />, title: t("search.nothingFound") }}
    >
      {(data) => (
        <>
          {data.tracks.length > 0 && (
            <Section title={t("nav.tracks")} className="gap-2.5">
              <ul className="divide-y divide-border">
                {data.tracks.map((track) => (
                  <TrackRow key={track.id} track={track} />
                ))}
              </ul>
            </Section>
          )}
          {data.albums.length > 0 && (
            <Section title={t("nav.albums")} className="gap-2.5">
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

function TrackRow({ track }: { track: YandexTrack }) {
  return (
    <ProviderTrack
      title={track.title}
      artist={track.artist}
      album={track.album}
      coverUrl={track.coverUrl}
      duration={track.durationSeconds}
      action={
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
      }
    />
  );
}

function AlbumCard({ album }: { album: YandexAlbum }) {
  const t = useT();
  return (
    <article className="flex min-w-0 flex-col gap-2.5">
      <ProviderArtwork url={album.coverUrl} className="aspect-square w-full rounded-lg" />
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
