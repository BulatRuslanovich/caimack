// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { createContext, useCallback, useEffect, useMemo, useState } from "react";

import {
  activateLocale,
  DEFAULT_LOCALE,
  detectLocale,
  loadDictionary,
  LOCALE_COOKIE,
  localeCookieValue,
  translateWith,
  type Dictionary,
  type Locale,
  type TranslationKey,
  type TranslationValues,
} from "@/lib/i18n";
import { useRequiredContext } from "@/lib/useRequiredContext";

export type Translate = (key: TranslationKey, values?: TranslationValues) => string;

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

const I18nContext = createContext<I18nState | null>(null);

export function I18nProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
  initialDictionary,
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
  initialDictionary?: Dictionary;
}) {
  const [active, setActive] = useState<{ locale: Locale; dictionary?: Dictionary }>(() => ({
    locale: initialLocale,
    dictionary: initialDictionary,
  }));

  useEffect(() => activateLocale(active.locale, active.dictionary), [active]);

  useEffect(() => {
    document.documentElement.lang = active.locale;
  }, [active.locale]);

  const setLocale = useCallback((next: Locale) => {
    void loadDictionary(next).then((dictionary) => {
      document.cookie = localeCookieValue(next);
      setActive({ locale: next, dictionary });
    });
  }, []);

  useEffect(() => {
    if (document.cookie.split("; ").some((pair) => pair.startsWith(`${LOCALE_COOKIE}=`))) return;

    const preferred = detectLocale();
    if (preferred === initialLocale) document.cookie = localeCookieValue(preferred);
    else setLocale(preferred);
  }, [initialLocale, setLocale]);

  const locale = active.locale;

  const t = useCallback<Translate>(
    (key, values) => translateWith(active.dictionary, active.locale, key, values),
    [active],
  );

  const value = useMemo<I18nState>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nState {
  return useRequiredContext(I18nContext, "useI18n", "I18nProvider");
}

export function useT(): Translate {
  return useI18n().t;
}
