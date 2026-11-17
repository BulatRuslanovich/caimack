// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { UseQueryResult } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Query } from "./Query";

const retry = vi.hoisted(() => ({ click: undefined as ComponentProps<"button">["onClick"] }));
vi.mock("@/contexts/I18nContext", () => ({ useT: () => (key: string) => key }));
vi.mock("./ui/button", () => ({
  Button: (props: ComponentProps<"button">) => {
    retry.click = props.onClick;
    return <button>{props.children}</button>;
  },
}));

function render(overrides: Partial<UseQueryResult<string[]>> = {}) {
  const refetch = vi.fn();
  const result = {
    data: ["Cached album"],
    error: null,
    isPending: false,
    isPlaceholderData: false,
    refetch,
    ...overrides,
  } as UseQueryResult<string[]>;
  return {
    refetch,
    markup: renderToStaticMarkup(
      <Query
        result={result}
        skeleton={<p>Loading cards</p>}
        empty={{ title: "Saved music is empty" }}
      >
        {(items) => <p>{items.join(", ")}</p>}
      </Query>,
    ),
  };
}

beforeEach(() => {
  retry.click = undefined;
});
describe("query loading and retained content", () => {
  it("retains loaded music and exposes retry after a refresh fails", () => {
    const { markup, refetch } = render({ error: new Error("Offline") });
    expect(markup).toContain("Cached album");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("error.refresh");
    retry.click!({} as never);
    expect(refetch).toHaveBeenCalledOnce();
  });
  it("shows initial errors instead of pretending to keep loading", () => {
    const { markup } = render({ data: undefined, error: new Error("Offline") });
    expect(markup).toContain("Offline");
    expect(markup).not.toContain("Loading cards");
    expect(markup).not.toContain("Saved music is empty");
  });
  it("uses the caller's loading geometry while waiting for the first result", () => {
    expect(render({ data: undefined, isPending: true }).markup).toContain("Loading cards");
  });
  it("keeps an empty cached collection distinguishable from a failed refresh", () => {
    const { markup } = render({ data: [], error: new Error("Offline") });
    expect(markup).toContain("Saved music is empty");
    expect(markup).toContain("error.refresh");
  });

  it("retains the same content structure while the next page is loading", () => {
    const loaded = render().markup;
    const loading = render({ isPlaceholderData: true }).markup;
    expect(loading).toContain('aria-busy="true"');
    expect(loading.replace(' aria-busy="true"', "")).toBe(loaded);
  });
});
