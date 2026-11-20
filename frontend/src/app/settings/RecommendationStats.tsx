// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, HeadphonesIcon, RadioIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { queries } from "@/lib/queries";
import { sourceLabel } from "@/lib/sourceLabel";
import type { RadioImpressionStats, RecommendationStats as Stats, SourceStats } from "@/lib/types";
import { useFormat } from "@/lib/useFormat";
import { useI18n, useT } from "@/contexts/I18nContext";
import { Query } from "@/components/Query";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupButton } from "@/components/ui/toggle-group";
import { TasteRules } from "./TasteRules";

const PERIODS = [7, 30, 90];
const percent = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 100) : null;
const percentLabel = (part: number, whole: number) => {
  const value = percent(part, whole);
  return value === null ? "—" : `${value}%`;
};
const completion = (rows: SourceStats[]) =>
  percent(
    rows.reduce((sum, row) => sum + row.completed, 0),
    rows.reduce((sum, row) => sum + row.completed + row.skipped, 0),
  );

export function RecommendationStats() {
  const t = useT();
  const [days, setDays] = useState(30);
  const stats = useQuery({ ...queries.recommendationStats(days), refetchInterval: 30 * 60_000 });
  return (
    <div className="recommendation-report">
      <header className="rec-heading">
        <div>
          <h2>{t("stats.title")}</h2>
          <p>{t("stats.intro")}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void stats.refetch()}
          disabled={stats.isFetching}
          aria-label={t("stats.refresh")}
          title={t("stats.refresh")}
        >
          <RefreshCwIcon size={18} aria-hidden="true" />
        </Button>
      </header>
      <div className="rec-period">
        <ToggleGroup aria-label={t("stats.period")}>
          {PERIODS.map((period) => (
            <ToggleGroupButton
              key={period}
              active={period === days}
              onClick={() => setDays(period)}
            >
              {t("stats.periodDays", { count: period })}
            </ToggleGroupButton>
          ))}
        </ToggleGroup>
        <span role="status">{stats.isFetching ? t("stats.updating") : t("stats.autoRefresh")}</span>
      </div>
      <Query
        result={stats}
        isEmpty={(data) =>
          data.listenedSeconds === 0 &&
          data.sources.length === 0 &&
          !data.radio?.some((row) => row.shown > 0) &&
          !data.behavior?.some(
            (row) => row.earlySkips + row.partial + row.nearComplete + row.unrated > 0,
          )
        }
        empty={{
          icon: <HeadphonesIcon size={30} />,
          title: t("stats.empty"),
          description: t("stats.emptyHint"),
          action: (
            <Button asChild size="sm">
              <Link href="/">{t("stats.listen")}</Link>
            </Button>
          ),
        }}
        skeleton={
          <div className="rec-loading" role="status" aria-label={t("common.loading")}>
            <div className="animate-pulse" />
            <div className="animate-pulse" />
          </div>
        }
      >
        {(data) => <Report stats={data} />}
      </Query>
      <TasteRules />
    </div>
  );
}

function Report({ stats }: { stats: Stats }) {
  const { t, locale } = useI18n();
  const format = useFormat();
  const number = (value: number) => value.toLocaleString(locale);
  const totals = (stats.behavior ?? []).reduce(
    (sum, row) => ({
      early: sum.early + row.earlySkips,
      partial: sum.partial + row.partial,
      near: sum.near + row.nearComplete,
      unrated: sum.unrated + row.unrated,
    }),
    { early: 0, partial: 0, near: 0, unrated: 0 },
  );
  const rated = totals.early + totals.partial + totals.near;
  const grades = [
    {
      key: "near",
      label: t("stats.outcomeNear"),
      hint: t("stats.outcomeNearHint"),
      count: totals.near,
    },
    {
      key: "partial",
      label: t("stats.outcomePartial"),
      hint: t("stats.outcomePartialHint"),
      count: totals.partial,
    },
    {
      key: "early",
      label: t("stats.outcomeEarly"),
      hint: t("stats.outcomeEarlyHint"),
      count: totals.early,
    },
  ];
  const recommendedSources = stats.sources.filter((row) => row.recommended);
  const otherSources = stats.sources.filter((row) => !row.recommended);
  const likes = recommendedSources.reduce((sum, row) => sum + row.liked, 0);
  const share = percent(stats.recommendedSeconds, stats.listenedSeconds);
  return (
    <>
      <section className="rec-response" aria-labelledby="rec-response-title">
        <div className="rec-response-main">
          <div className="rec-response-lead">
            <span className="rec-section-icon">
              <HeadphonesIcon size={21} aria-hidden="true" />
            </span>
            <h3 id="rec-response-title">{t("stats.responseTitle")}</h3>
            <p className="rec-response-value">{percentLabel(totals.near, rated)}</p>
            <p className="rec-response-caption">
              {t(rated > 0 ? "stats.responseCaption" : "stats.noGrades")}
            </p>
            <span className="rec-sample">{t("stats.ratedSample", { count: rated })}</span>
          </div>
          <div className="rec-outcomes">
            {grades.map((grade) => (
              <div className="rec-outcome" key={grade.key} data-outcome={grade.key}>
                <div className="rec-outcome-label">
                  <span>{grade.label}</span>
                  <strong>
                    {percentLabel(grade.count, rated)} <small>{number(grade.count)}</small>
                  </strong>
                </div>
                <div className="rec-meter" aria-hidden="true">
                  <span style={{ width: `${percent(grade.count, rated) ?? 0}%` }} />
                </div>
                <p>{grade.hint}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="rec-summary">
          <div>
            <span>{t("stats.recommendationTime")}</span>
            <strong>{format.totalDuration(stats.recommendedSeconds)}</strong>
            <small>
              {t("stats.totalTime", { total: format.totalDuration(stats.listenedSeconds) })}
            </small>
          </div>
          <div>
            <span>{t("stats.recommendationShare")}</span>
            <strong>{share === null ? "—" : `${share}%`}</strong>
            <small>{t("stats.shareHint")}</small>
          </div>
          <div>
            <span>{t("stats.recommendationLikes")}</span>
            <strong>{number(likes)}</strong>
            <small>{t("stats.likesHint")}</small>
          </div>
        </div>
      </section>
      <details className="rec-explainer">
        <summary>
          <span>{t("stats.howMeasured")}</span>
          <ChevronDownIcon size={16} aria-hidden="true" />
        </summary>
        <div>
          <p>{t("stats.measureIntro")}</p>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 leading-relaxed">
            <li>
              <strong>{t("stats.outcomeNear")}.</strong> {t("stats.measureNear")}
            </li>
            <li>
              <strong>{t("stats.outcomePartial")}.</strong> {t("stats.measurePartial")}
            </li>
            <li>
              <strong>{t("stats.outcomeEarly")}.</strong> {t("stats.measureEarly")}
            </li>
          </ul>
          <p>{t("stats.measureExample")}</p>
          <p>
            {t("stats.unratedNote", { count: totals.unrated })} {t("stats.unratedReason")}
          </p>
          <p>{t("stats.measureSeeks")}</p>
          <p>{t("stats.measureCaution")}</p>
        </div>
      </details>
      {stats.sources.length > 0 && (
        <section className="rec-section" aria-labelledby="rec-comparison-title">
          <div className="rec-section-heading">
            <h3 id="rec-comparison-title">{t("stats.comparisonTitle")}</h3>
            <p>{t("stats.comparisonNote")}</p>
          </div>
          <div className="rec-comparison">
            {[
              {
                key: "recommended",
                label: t("stats.recommendedMusic"),
                value: completion(recommendedSources),
              },
              { key: "other", label: t("stats.chosenMusic"), value: completion(otherSources) },
            ].map((item) => (
              <div key={item.key} data-kind={item.key}>
                <span>{item.label}</span>
                <strong>{item.value === null ? "—" : `${item.value}%`}</strong>
                <div className="rec-meter" aria-hidden="true">
                  <span style={{ width: `${item.value ?? 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {stats.radio?.some((row) => row.shown > 0) && <RadioOutcomes rows={stats.radio} />}
      {stats.sources.length > 0 && <Sources rows={stats.sources} />}
    </>
  );
}

function RadioOutcomes({ rows }: { rows: RadioImpressionStats[] }) {
  const { t, locale } = useI18n();
  return (
    <section className="rec-section" aria-labelledby="rec-radio-title">
      <div className="rec-section-heading">
        <h3 id="rec-radio-title">{t("stats.radioTitle")}</h3>
        <p>{t("stats.radioNote")}</p>
      </div>
      <div className="rec-radio-grid">
        {[...rows]
          .filter((row) => row.shown > 0)
          .sort((a, b) => Number(a.explore) - Number(b.explore))
          .map((row) => {
            const played = row.finished + row.partial + row.earlySkips;
            const outcomes = [
              { key: "near", label: t("stats.outcomeNear"), count: row.finished },
              { key: "partial", label: t("stats.outcomePartial"), count: row.partial },
              { key: "early", label: t("stats.outcomeEarly"), count: row.earlySkips },
              { key: "unplayed", label: t("stats.radioUnplayed"), count: row.unplayed },
              { key: "pending", label: t("stats.radioPending"), count: row.pending },
            ];
            return (
              <article key={String(row.explore)} className="rec-radio-card">
                <div className="rec-radio-heading">
                  <RadioIcon size={18} aria-hidden="true" />
                  <h4>{t(row.explore ? "stats.radioExplore" : "stats.radioRegular")}</h4>
                  <span>{t("stats.suggestedCount", { count: row.shown })}</span>
                </div>
                <p className="rec-radio-description">
                  {t(row.explore ? "stats.radioExploreHint" : "stats.radioRegularHint")}
                </p>
                <p className="rec-radio-value">
                  <strong>{percentLabel(row.finished, played)}</strong>
                  <span>{t("stats.radioRateNote")}</span>
                </p>
                <div className="rec-stacked" aria-hidden="true">
                  {outcomes.map((outcome) => (
                    <span
                      key={outcome.key}
                      data-outcome={outcome.key}
                      style={{ width: `${(100 * outcome.count) / row.shown}%` }}
                    />
                  ))}
                </div>
                <dl className="rec-radio-legend">
                  {outcomes.map((outcome) => (
                    <div key={outcome.key}>
                      <dt>
                        <i data-outcome={outcome.key} />
                        {outcome.label}
                      </dt>
                      <dd>{outcome.count.toLocaleString(locale)}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            );
          })}
      </div>
    </section>
  );
}

function Sources({ rows }: { rows: SourceStats[] }) {
  const t = useT();
  const format = useFormat();
  const [filter, setFilter] = useState<"all" | "recommended">("all");
  const sorted = [...rows].sort(
    (a, b) => b.listenedSeconds - a.listenedSeconds || b.starts - a.starts,
  );
  const filtered = sorted.filter((row) => filter === "all" || row.recommended);
  const maxTime = Math.max(...rows.map((row) => row.listenedSeconds), 1);
  const columns = [
    "stats.source",
    "stats.impressions",
    "stats.starts",
    "stats.completed",
    "stats.skippedEarly",
    "stats.liked",
    "stats.time",
  ] as const;
  return (
    <section className="rec-section" aria-labelledby="rec-sources-title">
      <div className="rec-section-heading">
        <h3 id="rec-sources-title">{t("stats.sourcesTitle")}</h3>
        <p>{t("stats.sourcesNote")}</p>
      </div>
      <ToggleGroup aria-label={t("stats.sourceFilter")}>
        <ToggleGroupButton active={filter === "all"} onClick={() => setFilter("all")}>
          {t("stats.allSources")}
        </ToggleGroupButton>
        <ToggleGroupButton
          active={filter === "recommended"}
          onClick={() => setFilter("recommended")}
        >
          {t("stats.onlyRecommended")}
        </ToggleGroupButton>
      </ToggleGroup>
      <div className="rec-source-list">
        {filtered.length === 0 && (
          <p className="rec-inline-empty">{t("stats.noRecommendedSources")}</p>
        )}
        {filtered.slice(0, 6).map((row) => (
          <div className="rec-source" key={row.source ?? ""}>
            <div className="rec-source-name">
              <span>{sourceLabel(row.source, t)}</span>
              {row.recommended && <small>{t("stats.recommended")}</small>}
            </div>
            <div className="rec-meter" aria-hidden="true">
              <span style={{ width: `${(100 * row.listenedSeconds) / maxTime}%` }} />
            </div>
            <strong>{format.totalDuration(row.listenedSeconds)}</strong>
          </div>
        ))}
      </div>
      <details className="rec-explainer rec-source-details">
        <summary>
          <span>{t("stats.allMetrics", { count: filtered.length })}</span>
          <ChevronDownIcon size={16} aria-hidden="true" />
        </summary>
        <p>{t("stats.tableNote")}</p>
        <div
          className="rec-table-scroll"
          role="region"
          aria-label={t("stats.allMetrics", { count: filtered.length })}
          tabIndex={0}
        >
          <table className="rec-table">
            <thead>
              <tr>
                {columns.map((key) => (
                  <th scope="col" key={key}>
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const ended = row.completed + row.skipped;
                const conversion = percent(row.starts, row.impressions);
                return (
                  <tr key={row.source ?? ""}>
                    <th scope="row">{sourceLabel(row.source, t)}</th>
                    <td>{row.impressions || "—"}</td>
                    <td>
                      {row.starts}
                      {conversion !== null && <small> ({conversion}%)</small>}
                    </td>
                    <td>{percentLabel(row.completed, ended)}</td>
                    <td>{percentLabel(row.skippedEarly, ended)}</td>
                    <td>{row.liked}</td>
                    <td>{format.totalDuration(row.listenedSeconds)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
