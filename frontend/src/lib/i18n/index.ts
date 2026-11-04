// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import type { Dictionary, TranslationKey } from "./en";
import { isLocale, type Locale, type Phrase, type TranslationValues } from "./types";

export { LOCALES, LOCALE_NAMES, isLocale } from "./types";
export type { Locale, TranslationValues } from "./types";
export type { Dictionary, TranslationKey } from "./en";

export const DEFAULT_LOCALE: Locale = "en";

let active: { locale: Locale; dictionary?: Dictionary } = { locale: DEFAULT_LOCALE };

export function activateLocale(locale: Locale, dictionary: Dictionary | undefined): void {
  active = { locale, dictionary };
}

export async function loadDictionary(locale: Locale): Promise<Dictionary> {
  if (locale === "ru") return (await import("./ru")).ru;
  return (await import("./en")).en;
}

const PLACEHOLDER = /\{(\w+)\}/g;

const pluralRules = new Map<Locale, Intl.PluralRules>();

function pluralRulesFor(locale: Locale): Intl.PluralRules {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules;
}

function selectForm(
  phrase: Phrase | undefined,
  locale: Locale,
  count: number | undefined,
): string | undefined {
  if (phrase === undefined) return undefined;
  if (typeof phrase === "string") return phrase;
  return phrase[pluralRulesFor(locale).select(count ?? 0)] ?? phrase.other;
}

export function translateWith(
  dictionary: Dictionary | undefined,
  locale: Locale,
  key: TranslationKey,
  values?: TranslationValues,
): string {
  const phrase = dictionary?.[key];
  const count = typeof values?.count === "number" ? values.count : undefined;

  if (process.env.NODE_ENV !== "production" && phrase === undefined) {
    console.warn(`[i18n] missing "${key}" in "${locale}"`);
  }

  const template = selectForm(phrase, locale, count) ?? key;

  if (!values) return template;

  return template.replace(PLACEHOLDER, (placeholder, name: string) => {
    const value = values[name];
    if (value === undefined) return placeholder;
    return typeof value === "number" ? value.toLocaleString(locale) : value;
  });
}

export const LOCALE_COOKIE = "ms_locale";

export function localeCookieValue(locale: Locale): string {
  const year = 60 * 60 * 24 * 365;
  return `${LOCALE_COOKIE}=${locale}; path=/; max-age=${year}; samesite=lax`;
}

export function requestLocale(cookie?: string): Locale {
  const source = cookie ?? (typeof document === "undefined" ? "" : document.cookie);
  const saved = source
    .split(/;\s*/)
    .find((pair) => pair.startsWith(`${LOCALE_COOKIE}=`))
    ?.slice(LOCALE_COOKIE.length + 1);

  return saved && isLocale(saved) ? saved : active.locale;
}

export function tr(key: TranslationKey, values?: TranslationValues): string {
  return translateWith(active.dictionary, active.locale, key, values);
}

export function detectLocale(): Locale {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;

  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }

  return DEFAULT_LOCALE;
}
