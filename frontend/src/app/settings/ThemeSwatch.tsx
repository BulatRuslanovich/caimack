// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import type { ThemeChoice } from "@/lib/theme";
import type { Colorway, Palette } from "@/lib/themeScript";

export function ThemeSwatch({ choice, colorway }: { choice: ThemeChoice; colorway: Colorway }) {
  return (
    <span
      aria-hidden="true"
      className="mb-2 flex h-16 w-full overflow-hidden rounded-sm border border-border"
    >
      {choice !== "light" && <Miniature palette="dark" colorway={colorway} />}
      {choice !== "dark" && <Miniature palette="light" colorway={colorway} />}
    </span>
  );
}

export function ColorwaySwatch({ colorway, palette }: { colorway: Colorway; palette: Palette }) {
  return (
    <span
      aria-hidden="true"
      className="mb-2 flex h-16 w-full overflow-hidden rounded-sm border border-border"
    >
      <Miniature palette={palette} colorway={colorway} />
    </span>
  );
}

function Miniature({ palette, colorway }: { palette: Palette; colorway: Colorway }) {
  return (
    <span
      data-theme-preview={palette}
      data-colorway-preview={colorway}
      className="flex min-w-0 flex-1 gap-1.5 bg-background p-1.5"
    >
      <span className="w-1/4 rounded-xs bg-card" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="size-5 rounded-xs bg-(--sleeve-2)" />
        <span className="h-1 w-4/5 rounded-full bg-foreground" />
        <span className="h-1 w-3/5 rounded-full bg-muted-foreground" />
        <span className="mt-auto h-1 w-1/3 rounded-full bg-primary" />
      </span>
    </span>
  );
}
