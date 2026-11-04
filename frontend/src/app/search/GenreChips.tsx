// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { genreName } from "@/lib/format";
import Link from "next/link";
import type { Genre } from "@/lib/types";

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
