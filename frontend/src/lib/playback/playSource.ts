// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { usePathname } from "next/navigation";
import { createContext, createElement, useContext, type ReactNode } from "react";

const sources = new Map<string, string>();

const MAX_TAGGED = 2000;

export function tagSource(trackIds: Iterable<string>, source: string | null | undefined): void {
  if (!source) return;

  for (const id of trackIds) {
    sources.delete(id);
    sources.set(id, source);
  }

  while (sources.size > MAX_TAGGED) {
    const oldest = sources.keys().next().value;
    if (oldest === undefined) break;
    sources.delete(oldest);
  }
}

export function sourceOf(trackId: string): string | undefined {
  return sources.get(trackId);
}

export function radioSource(seeded = false): string {
  return seeded ? "radio:track" : "radio";
}

export function sourceFromPath(pathname: string | null): string | null {
  if (!pathname) return null;
  if (pathname === "/") return "home";

  const [section, detail] = pathname.split("/").filter(Boolean);

  switch (section) {
    case "albums":
      return detail ? "album" : "albums";
    case "artists":
      return detail ? "artist" : "artists";
    case "playlists":
      return detail ? "playlist" : "playlists";
    case "mixes":
      return detail ? `mix:${detail}` : null;
    case "recently-played":
      return "history";
    case "favorites":
    case "search":
    case "tracks":
    case "genres":
    case "recap":
      return section;
    default:
      return null;
  }
}

const PlaySourceContext = createContext<string | null>(null);

export function PlaySource({ value, children }: { value: string; children: ReactNode }) {
  return createElement(PlaySourceContext.Provider, { value }, children);
}

export function usePlaySource(): string | null {
  const explicit = useContext(PlaySourceContext);
  const pathname = usePathname();

  return explicit ?? sourceFromPath(pathname);
}
