// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useMemo } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { calendarDaysAgo } from "@/lib/format";
import type { TranslationKey } from "@/lib/i18n";

const BYTE_UNITS: TranslationKey[] = [
  "unit.byte",
  "unit.kilobyte",
  "unit.megabyte",
  "unit.gigabyte",
  "unit.terabyte",
];

// Intl constructors load locale data. Share them across rows rather than
// constructing two formatters for every date on every list render.
const dateFormats = new Map<string, ReturnType<typeof createDateFormats>>();
function createDateFormats(locale: string) {
  return {
    time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }),
    weekday: new Intl.DateTimeFormat(locale, { weekday: "long" }),
    date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }),
    year: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }),
  };
}
function formatsFor(locale: string) {
  let formats = dateFormats.get(locale);
  if (!formats) {
    formats = createDateFormats(locale);
    dateFormats.set(locale, formats);
  }
  return formats;
}

export function useFormat() {
  const { locale, t } = useI18n();

  return useMemo(() => {
    const calendarDate = (date: Date) =>
      (date.getFullYear() === new Date().getFullYear()
        ? formatsFor(locale).date
        : formatsFor(locale).year
      ).format(date);

    return {
      totalDuration(totalSeconds: number) {
        if (totalSeconds < 60) return t("unit.seconds", { count: Math.round(totalSeconds) });

        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.round((totalSeconds % 3600) / 60);

        if (hours === 0) return t("unit.minutes", { count: minutes });
        if (minutes === 0) return t("unit.hours", { count: hours });
        return t("unit.hoursMinutes", { hours, minutes });
      },

      bytes(value: number) {
        if (value <= 0) return `0 ${t("unit.byte")}`;

        const exponent = Math.min(
          Math.floor(Math.log(value) / Math.log(1024)),
          BYTE_UNITS.length - 1,
        );
        const scaled = value / 1024 ** exponent;
        const digits = scaled >= 10 || exponent === 0 ? 0 : 1;

        return `${scaled.toLocaleString(locale, {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        })} ${t(BYTE_UNITS[exponent])}`;
      },

      relativeDate(isoDate: string) {
        const date = new Date(isoDate);
        if (Number.isNaN(date.getTime())) return "";

        const days = calendarDaysAgo(date);

        if (days <= 0) return t("date.today");
        if (days === 1) return t("date.yesterday");
        if (days < 7) return formatsFor(locale).weekday.format(date);

        return calendarDate(date);
      },

      playedAt(isoDate: string) {
        const date = new Date(isoDate);
        if (Number.isNaN(date.getTime())) return "";

        const days = calendarDaysAgo(date);
        const time = formatsFor(locale).time.format(date);

        if (days <= 0) return `${t("date.today")}, ${time}`;
        if (days === 1) return `${t("date.yesterday")}, ${time}`;
        if (days < 7) return `${formatsFor(locale).weekday.format(date)}, ${time}`;

        return calendarDate(date);
      },

      timeOfDay(isoDate: string) {
        const date = new Date(isoDate);
        if (Number.isNaN(date.getTime())) return "";

        return formatsFor(locale).time.format(date);
      },
    };
  }, [locale, t]);
}
