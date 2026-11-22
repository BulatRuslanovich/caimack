// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { genreName } from "@/lib/format";
import Link from "next/link";
import type { Genre } from "@/lib/types";
import { AlbumCover, Cover } from "@/components/Cover";
import { useT } from "@/contexts/I18nContext";

export function GenreCategories({ genres }: { genres: Genre[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
      {genres.map((genre) => (
        <GenreCategory key={genre.id} genre={genre} />
      ))}
    </div>
  );
}

function GenreCategory({ genre }: { genre: Genre }) {
  const t = useT();
  const name = genreName(genre.name);
  const albumId = genre.coverAlbumIds[0];

  return (
    <Link
      href={`/search?tab=genres&id=${genre.id}`}
      className="flex min-h-23 min-w-0 items-center justify-between gap-1.5 rounded-md border border-border bg-card px-2.5 py-3 hover:bg-raised hover:no-underline focus-visible:outline-2 focus-visible:outline-ring sm:min-h-30 sm:items-end sm:gap-3 sm:p-4"
    >
      <span className="flex min-w-0 flex-col gap-1">
        <span className="wrap-anywhere text-sm leading-tight font-semibold sm:text-base">
          {name}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("count.tracks", { count: genre.trackCount })}
        </span>
      </span>
      <span
        aria-hidden="true"
        className="size-11 shrink-0 overflow-hidden rounded-xs shadow-art min-[375px]:size-13 sm:size-22"
      >
        {albumId ? (
          <AlbumCover album={{ id: albumId, title: name, hasCover: true }} />
        ) : (
          <Cover name={name} hasCover={false} />
        )}
      </span>
    </Link>
  );
}

export function GenreChips({ genres }: { genres: Genre[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {genres.map((genre) => (
        <Link
          key={genre.id}
          href={`/search?tab=genres&id=${genre.id}`}
          className="flex items-center gap-2 rounded-full bg-raised px-4 py-2 text-sm font-medium text-muted-foreground transition-colors duration-150 ease-brand hover:bg-accent hover:text-foreground hover:no-underline"
        >
          {genreName(genre.name)}
          <span className="text-2xs text-faint tabular-nums">{genre.trackCount}</span>
        </Link>
      ))}
    </div>
  );
}
