// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

import type { Translate } from "@/contexts/I18nContext";
import type { TranslationKey } from "@/lib/i18n";
import { moodLabel } from "@/lib/moods";

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
  if (source.startsWith("radio:mood:")) {
    return t("source.radioMood", { mood: moodLabel(source.slice("radio:mood:".length), t) });
  }

  return KNOWN.has(source) ? t(`source.${source}` as TranslationKey) : source;
}
