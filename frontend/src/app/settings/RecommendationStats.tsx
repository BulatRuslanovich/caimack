// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { queries } from "@/lib/queries";
import { sourceLabel } from "@/lib/sourceLabel";
import type { RadioImpressionStats, RecommendationStats as Stats, SourceStats } from "@/lib/types";
import { useFormat } from "@/lib/useFormat";
import { useT } from "@/contexts/I18nContext";
import { Query } from "@/components/Query";
import { ToggleGroup, ToggleGroupButton } from "@/components/ui/toggle-group";
import { TasteRules } from "./TasteRules";

const PERIODS = [7, 30, 90];

const percent = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 100) : null;

const percentLabel = (part: number, whole: number) => {
  const value = percent(part, whole);
  return value === null ? "—" : `${value}%`;
};

export function RecommendationStats() {
  const t = useT();
  const [days, setDays] = useState(30);
  const stats = useQuery(queries.recommendationStats(days));

  return (
    <div className="flex flex-col gap-5">
      <section className="settings-panel flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex max-w-[60ch] flex-col gap-1">
            <h2 className="font-sans text-heading font-semibold">{t("stats.title")}</h2>
          </div>
          <ToggleGroup>
            {PERIODS.map((period) => (
              <ToggleGroupButton
                key={period}
                active={period === days}
                onClick={() => setDays(period)}
              >
                {t("stats.days", { count: period })}
              </ToggleGroupButton>
            ))}
          </ToggleGroup>
        </div>

        <Query
          result={stats}
          isEmpty={(data) => data.sources.length === 0}
          empty={{ title: t("stats.empty") }}
        >
          {(data) => <Report stats={data} />}
        </Query>
      </section>

      <TasteRules />
    </div>
  );
}

function Report({ stats }: { stats: Stats }) {
  const t = useT();
  const format = useFormat();

  const share = percent(stats.recommendedSeconds, stats.listenedSeconds) ?? 0;
  const finished = (rows: SourceStats[]) =>
    percent(
      rows.reduce((sum, row) => sum + row.completed, 0),
      rows.reduce((sum, row) => sum + row.completed + row.skipped, 0),
    );
  const recommended = finished(stats.sources.filter((row) => row.recommended));
  const rest = finished(stats.sources.filter((row) => !row.recommended));

  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="font-display text-2xl font-semibold">{t("stats.share", { share })}</p>
        <div className="flex h-2 overflow-hidden rounded-full bg-raised" aria-hidden="true">
          <span className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
        </div>
        <p className="text-sm text-muted-foreground">
          {t("stats.shareNote", {
            recommended: format.totalDuration(stats.recommendedSeconds),
            total: format.totalDuration(stats.listenedSeconds),
          })}
        </p>
        {recommended !== null && rest !== null && (
          <p className="text-sm">{t("stats.completion", { recommended, rest })}</p>
        )}
      </div>

      {stats.radio && stats.radio.some((row) => row.shown > 0) && (
        <RadioOutcomes rows={stats.radio} />
      )}

      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[40rem] text-sm tabular-nums">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:font-medium">
              <th>{t("stats.source")}</th>
              <th className="text-right">{t("stats.impressions")}</th>
              <th className="text-right">{t("stats.starts")}</th>
              <th className="text-right">{t("stats.completed")}</th>
              <th className="text-right">{t("stats.skippedEarly")}</th>
              <th className="text-right">{t("stats.liked")}</th>
              <th className="text-right">{t("stats.time")}</th>
            </tr>
          </thead>
          <tbody>
            {stats.sources.map((row) => {
              const ended = row.completed + row.skipped;
              const conversion = percent(row.starts, row.impressions);

              return (
                <tr
                  key={row.source ?? ""}
                  className="border-t border-border [&>td]:px-2 [&>td]:py-2"
                >
                  <td>
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          row.recommended ? "bg-primary" : "bg-transparent",
                        )}
                        title={row.recommended ? t("stats.recommended") : undefined}
                      />
                      <span className={cn("truncate", !row.source && "text-muted-foreground")}>
                        {sourceLabel(row.source, t)}
                      </span>
                    </span>
                  </td>
                  <td className="text-right text-muted-foreground">{row.impressions || "—"}</td>
                  <td className="text-right">
                    {row.starts}
                    {conversion !== null && (
                      <span className="ml-1 text-xs text-muted-foreground">({conversion}%)</span>
                    )}
                  </td>
                  <td className="text-right">{percentLabel(row.completed, ended)}</td>
                  <td className="text-right">{percentLabel(row.skippedEarly, ended)}</td>
                  <td className="text-right">{row.liked || "—"}</td>
                  <td className="text-right text-muted-foreground">
                    {row.listenedSeconds > 0 ? format.totalDuration(row.listenedSeconds) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function RadioOutcomes({ rows }: { rows: RadioImpressionStats[] }) {
  const t = useT();

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{t("stats.radioTitle")}</h3>
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[32rem] text-sm tabular-nums">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:font-medium">
              <th />
              <th className="text-right">{t("stats.radioShown")}</th>
              <th className="text-right">{t("stats.radioFinished")}</th>
              <th className="text-right">{t("stats.radioEarly")}</th>
              <th className="text-right">{t("stats.radioUnplayed")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const played = row.finished + row.partial + row.earlySkips;
              const resolved = row.shown - row.pending;

              return (
                <tr
                  key={String(row.explore)}
                  className="border-t border-border [&>td]:px-2 [&>td]:py-2"
                >
                  <td>{t(row.explore ? "stats.radioExplore" : "stats.radioRegular")}</td>
                  <td className="text-right">{row.shown}</td>
                  <td className="text-right">{percentLabel(row.finished, played)}</td>
                  <td className="text-right">{percentLabel(row.earlySkips, played)}</td>
                  <td className="text-right text-muted-foreground">
                    {percentLabel(row.unplayed, resolved)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
