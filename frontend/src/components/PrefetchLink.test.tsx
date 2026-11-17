// SPDX-License-Identifier: AGPL-3.0-only
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrefetchLink } from "./PrefetchLink";
import { prefetchRouteData } from "@/lib/queries";

const calls = vi.hoisted(() => ({ props: {} as Record<string, unknown> }));
vi.mock("next/link", () => ({
  default: (props: Record<string, unknown>) => {
    calls.props = props;
    return null;
  },
}));
vi.mock("@/lib/queries", () => ({ prefetchRouteData: vi.fn(async () => {}) }));
beforeEach(() => vi.clearAllMocks());

describe("intent prefetch", () => {
  it.each(["onPointerEnter", "onFocus", "onTouchStart"])(
    "warms browser data on %s, without preloading every visible row",
    (event) => {
      const client = new QueryClient();
      renderToStaticMarkup(
        <QueryClientProvider client={client}>
          <PrefetchLink href="/artists/artist">Artist</PrefetchLink>
        </QueryClientProvider>,
      );
      expect(calls.props.prefetch).toBe(false);
      (calls.props[event] as (event: unknown) => void)({});
      expect(prefetchRouteData).toHaveBeenCalledWith(client, "/artists/artist");
    },
  );

  it("keeps caller handlers and leaves external links alone", () => {
    const focus = vi.fn();
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <PrefetchLink href="https://example.com" onFocus={focus}>
          External
        </PrefetchLink>
      </QueryClientProvider>,
    );
    (calls.props.onFocus as (event: unknown) => void)({});
    expect(focus).toHaveBeenCalledOnce();
    expect(prefetchRouteData).not.toHaveBeenCalled();
  });
});
