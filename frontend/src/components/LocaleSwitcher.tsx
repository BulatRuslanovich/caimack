// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { LanguagesIcon } from "lucide-react";
import { useI18n } from "@/contexts/I18nContext";
import { LOCALES, LOCALE_NAMES } from "@/lib/i18n";
import { Button } from "./ui/button";

export function LocaleSwitcher() {
  const { locale, setLocale, t } = useI18n();

  const next = LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length];
  const label = t("action.switchLanguage", { language: LOCALE_NAMES[next] });

  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-sm"
      onClick={() => setLocale(next)}
      aria-label={label}
      title={label}
    >
      <LanguagesIcon size={16} />
      {LOCALE_NAMES[next]}
    </Button>
  );
}
