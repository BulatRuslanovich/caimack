// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import type { TranslationKey } from "@/lib/i18n";
import type { HomeMixSlug } from "@/lib/types";

export const MIXES = {
  daily: { title: "home.dailyMix" },
  new: { title: "home.newArrivals" },
  top: { title: "home.topThisWeek" },
} satisfies Record<HomeMixSlug, { title: TranslationKey }>;

export function isMixSlug(value: string): value is HomeMixSlug {
  return Object.hasOwn(MIXES, value);
}
