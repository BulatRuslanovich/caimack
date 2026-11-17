// SPDX-License-Identifier: AGPL-3.0-only

import type { ListeningWeek } from "./types";
import type { Route } from "next";

export type ListeningView =
  "overview" | "minutes" | "artists" | "songs" | "decade" | "artistShare" | "variety";
export const LISTENING_VIEWS: ListeningView[] = [
  "overview",
  "minutes",
  "artists",
  "songs",
  "decade",
  "artistShare",
  "variety",
];

export function listeningDate(date: string): Date {
  // Calendar dates belong to the server's listening zone, not the browser's.
  return new Date(`${date}T12:00:00Z`);
}

export function listeningRange(
  week: Pick<ListeningWeek, "startDate" | "endDate">,
  locale: string,
): string {
  const from = listeningDate(week.startDate);
  const to = listeningDate(week.endDate);
  const format = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    ...(from.getUTCFullYear() !== to.getUTCFullYear() ? { year: "numeric" as const } : {}),
  });
  return format.formatRange(from, to);
}

export function listeningLink(week: string, view: ListeningView = "overview"): Route {
  const query = new URLSearchParams({ tab: "listening" });
  if (week) query.set("week", week);
  if (view !== "overview") query.set("view", view);
  return `/settings?${query}` as Route;
}
