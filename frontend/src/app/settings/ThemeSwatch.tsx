// SPDX-License-Identifier: AGPL-3.0-only

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
      <span className="flex w-1/4 flex-col gap-1 rounded-xs border border-border bg-card p-1">
        <span className="h-1 rounded-full bg-primary" />
        <span className="h-0.5 rounded-full bg-border-strong" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-1 rounded-xs border border-border bg-card p-1">
          <span className="size-4 shrink-0 rounded-xs bg-(--sleeve-2)" />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="h-1 rounded-full bg-foreground" />
            <span className="h-0.5 w-2/3 rounded-full bg-muted-foreground" />
          </span>
        </span>
        <span className="flex min-w-0 flex-1 items-center justify-between gap-1">
          <span className="grid size-4 shrink-0 place-items-center rounded-full bg-action">
            <span className="border-y-[2.5px] border-l-4 border-y-transparent border-l-action-foreground" />
          </span>
          <span className="flex h-full w-1/2 flex-col justify-center gap-0.5 rounded-xs border border-border-strong bg-popover px-1">
            <span className="h-0.5 rounded-full bg-primary" />
            <span className="h-0.5 w-2/3 rounded-full bg-muted-foreground" />
          </span>
        </span>
      </span>
    </span>
  );
}
