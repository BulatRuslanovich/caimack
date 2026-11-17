// SPDX-License-Identifier: AGPL-3.0-only
import { renderToStaticMarkup } from "react-dom/server";
import type { UseInfiniteQueryResult } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { InfiniteQuery } from "./InfiniteQuery";
import type { Paged } from "@/lib/types";

vi.mock("@/contexts/I18nContext", () => ({ useT: () => (key: string) => key }));

function render(overrides: Partial<UseInfiniteQueryResult<{ pages: Paged<string>[] }>> = {}) {
  const result = {
    data: { pages: [{ items: ["Cached album"], total: 2, totalPages: 2, page: 1, pageSize: 1 }] },
    error: null,
    isPending: false,
    isPlaceholderData: false,
    hasNextPage: true,
    isFetchingNextPage: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
    ...overrides,
  } as UseInfiniteQueryResult<{ pages: Paged<string>[] }>;
  return renderToStaticMarkup(
    <InfiniteQuery result={result} skeleton={<p>Loading cards</p>}>
      {(items) => <p>{items.join(", ")}</p>}
    </InfiniteQuery>,
  );
}

describe("catalog filtering", () => {
  it("retains the current cards while a new filter loads, without paging through the old filter", () => {
    const markup = render({ isPlaceholderData: true });
    expect(markup).toContain("Cached album");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).not.toContain("Loading cards");
    expect(markup).not.toContain("pagination.loadMore");
  });

  it("offers the next page again after the new filter resolves", () => {
    expect(render()).toContain("pagination.loadMore");
    expect(render()).not.toContain('aria-busy="true"');
  });

  it("still shows a skeleton when no cards have been loaded", () => {
    expect(render({ data: undefined, isPending: true })).toContain("Loading cards");
  });
});
