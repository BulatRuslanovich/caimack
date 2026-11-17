// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import { en } from "@/lib/i18n/en";
import { queries } from "@/lib/queries";
import type { RecommendationStats as Stats } from "@/lib/types";
import { RecommendationStats } from "./RecommendationStats";

const empty: Stats = { days: 30, listenedSeconds: 0, recommendedSeconds: 0, sources: [] };

function render(stats: Stats) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(queries.recommendationStats(30).queryKey, stats);
  client.setQueryData(queries.tasteRules().queryKey, []);
  return renderToStaticMarkup(
    <I18nProvider initialLocale="en" initialDictionary={en}>
      <QueryClientProvider client={client}>
        <RecommendationStats />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

describe("recommendation report", () => {
  it("guides a new listener and keeps taste controls available", () => {
    const html = render(empty);
    expect(html).toContain("Find something to play");
    expect(html).toContain("Nothing excluded");
    expect(html).not.toContain("rec-response-value");
  });

  it("does not count unrated attempts as negative feedback", () => {
    const html = render({
      ...empty,
      behavior: [{ source: "radio", nearComplete: 6, partial: 3, earlySkips: 1, unrated: 90 }],
    });
    expect(html).toContain('class="rec-response-value">60%');
    expect(html).toContain("Based on 10 graded listens");
    expect(html).toContain("90 listens are excluded from the percentage calculation.");
    expect(html).toContain("7 out of 10 counted listens");
    expect(html).not.toContain("Average grade");
  });

  it("shows pending radio suggestions even without source history", () => {
    const html = render({
      ...empty,
      radio: [
        {
          explore: true,
          shown: 8,
          finished: 0,
          partial: 0,
          earlySkips: 0,
          unplayed: 0,
          pending: 8,
        },
      ],
    });
    expect(html).toContain("Discoveries");
    expect(html).toContain("Not evaluated yet");
    expect(html).toContain("Not enough listening to measure yet");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
    expect(html).not.toContain("Find something to play");
  });

  it("does not show zero completion for a source with only starts", () => {
    const html = render({
      ...empty,
      sources: [
        {
          source: "radio",
          recommended: true,
          impressions: 5,
          starts: 1,
          completed: 0,
          skipped: 0,
          skippedEarly: 0,
          liked: 0,
          listenedSeconds: 0,
        },
      ],
    });
    expect(html).toContain("Other sources");
    expect(html).toContain("All source metrics (1)");
    expect(html).toContain("<strong>—</strong>");
    expect(html).not.toContain("NaN");
  });
});
