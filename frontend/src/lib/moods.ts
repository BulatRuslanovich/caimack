// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import {
  CloudRainIcon,
  CoffeeIcon,
  DumbbellIcon,
  MoonIcon,
  PartyPopperIcon,
  RadioIcon,
  SunIcon,
  type LucideIcon,
} from "lucide-react";
import type { Translate } from "@/contexts/I18nContext";
import type { TranslationKey } from "@/lib/i18n";

const LABELS: Record<string, TranslationKey> = {
  workout: "radio.mood.workout",
  party: "radio.mood.party",
  chill: "radio.mood.chill",
  sleep: "radio.mood.sleep",
  happy: "radio.mood.happy",
  sad: "radio.mood.sad",
};

export function moodLabel(key: string, t: Translate): string {
  const label = LABELS[key];
  return label ? t(label) : key.charAt(0).toUpperCase() + key.slice(1);
}

const ICONS: Record<string, LucideIcon> = {
  workout: DumbbellIcon,
  party: PartyPopperIcon,
  chill: CoffeeIcon,
  sleep: MoonIcon,
  happy: SunIcon,
  sad: CloudRainIcon,
};

export function moodIcon(key: string): LucideIcon {
  return ICONS[key] ?? RadioIcon;
}

const HUES: Record<string, number> = {
  workout: 30,
  happy: 90,
  chill: 150,
  sad: 230,
  sleep: 298,
  party: 350,
};

export function moodHue(key: string): number {
  return HUES[key] ?? [...key].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 7);
}
