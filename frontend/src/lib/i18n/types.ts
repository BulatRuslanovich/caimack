// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

export const LOCALES = ["en", "ru"] as const;

export type Locale = (typeof LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  ru: "Русский",
};

export type PluralPhrase = { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>;

export type Phrase = string | PluralPhrase;

export type TranslationValues = Record<string, string | number>;

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}
