// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { genreName } from "@/lib/format";
import Link from "next/link";
import type { Genre } from "@/lib/types";
import { AlbumCover, Cover } from "@/components/Cover";
import { useT } from "@/contexts/I18nContext";

export function GenreCategories({ genres }: { genres: Genre[] }) {
  const t = useT();
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
      {genres.map((genre) => (
        <Link
          key={genre.id}
          href={`/genres?id=${genre.id}`}
          className="flex min-h-28 min-w-0 flex-col gap-3 rounded-md bg-card p-4 hover:bg-raised hover:no-underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span className="text-body font-semibold wrap-anywhere">{genreName(genre.name)}</span>
          <span className="mt-auto flex items-end justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {t("count.tracks", { count: genre.trackCount })}
            </span>
            {genre.coverAlbumIds[0] ? (
              <AlbumCover
                album={{ id: genre.coverAlbumIds[0], title: genre.name, hasCover: true }}
                size={56}
              />
            ) : (
              <Cover name={genre.name} hasCover={false} size={56} />
            )}
          </span>
        </Link>
      ))}
    </div>
  );
}

export function GenreChips({ genres }: { genres: Genre[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {genres.map((genre) => (
        <Link
          key={genre.id}
          href={`/genres?id=${genre.id}`}
          className="flex items-center gap-2 rounded-full bg-raised px-4 py-2 text-sm font-medium text-muted-foreground transition-colors duration-150 ease-brand hover:bg-accent hover:text-foreground hover:no-underline"
        >
          {genreName(genre.name)}
          <span className="text-2xs text-faint tabular-nums">{genre.trackCount}</span>
        </Link>
      ))}
    </div>
  );
}
