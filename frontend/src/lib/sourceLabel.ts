// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import type { Translate } from "@/contexts/I18nContext";
import type { TranslationKey } from "@/lib/i18n";

const KNOWN = new Set([
  "home",
  "home:forYou",
  "home:discover",
  "home:becauseYouListened",
  "home:artistsForYou",
  "home:dailyMix",
  "home:quickTiles",
  "home:newArrivals",
  "home:newAlbums",
  "home:yourPlaylists",
  "home:favorites",
  "home:topTracks",
  "mix:daily",
  "mix:new",
  "mix:top",
  "radio",
  "radio:track",
  "radio:autoplay",
  "queue",
  "album",
  "artist",
  "playlist",
  "favorites",
  "history",
  "search",
  "tracks",
  "genres",
  "genre",
  "recap",
  "downloads",
]);

export function sourceLabel(source: string | null | undefined, t: Translate): string {
  if (!source) return t("source.unknown");
  if (source.startsWith("radio:") && !KNOWN.has(source)) return t("source.radio");

  return KNOWN.has(source) ? t(`source.${source}` as TranslationKey) : source;
}
