// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

export type Daypart = "morning" | "day" | "evening" | "night";

export function daypartOf(hour: number): Daypart {
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 17) return "day";
  if (hour >= 17 && hour < 23) return "evening";
  return "night";
}

export const DAYPART_HOURS: Record<Daypart, [number, number]> = {
  morning: [5, 11],
  day: [11, 17],
  evening: [17, 23],
  night: [23, 5],
};

export function dominantDaypart(hourSeconds: number[]): { daypart: Daypart; share: number } | null {
  const totals: Record<Daypart, number> = { morning: 0, day: 0, evening: 0, night: 0 };
  hourSeconds.forEach((seconds, hour) => (totals[daypartOf(hour)] += seconds));

  const total = hourSeconds.reduce((sum, seconds) => sum + seconds, 0);
  if (total === 0) return null;

  const [daypart, seconds] = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
  return { daypart: daypart as Daypart, share: seconds / total };
}

export function busiestDay(daySeconds: number[]): { day: number; seconds: number } | null {
  let best: { day: number; seconds: number } | null = null;

  daySeconds.forEach((seconds, index) => {
    if (seconds > 0 && (!best || seconds > best.seconds)) best = { day: index + 1, seconds };
  });

  return best;
}

export function leadingBlanks(year: number, month: number): number {
  return (new Date(year, month - 1, 1).getDay() + 6) % 7;
}

export function intensity(seconds: number, max: number): number {
  return max > 0 && seconds > 0 ? Math.sqrt(seconds / max) : 0;
}

export function monthName(year: number, month: number, locale: string): string {
  return new Date(year, month - 1, 1).toLocaleDateString(locale, { month: "long" });
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
