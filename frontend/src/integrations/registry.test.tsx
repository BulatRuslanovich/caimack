// SPDX-License-Identifier: AGPL-3.0-only

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { useAvailableIntegrations } from "./registry";

const state = vi.hoisted(() => ({
  isAdmin: true,
  supportedIntegrations: undefined as string[] | undefined,
  desktop: false,
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => state }));
vi.mock("@/desktop/runtime", () => ({
  get isDesktop() {
    return state.desktop;
  },
}));
vi.mock("./generated", () => ({
  integrations: [{ id: "one" }, { id: "two", webOnly: true }],
}));

function List() {
  const available = useAvailableIntegrations();
  return <div>{available.map(({ id }) => id).join(",")}</div>;
}

beforeEach(() => {
  state.isAdmin = true;
  state.supportedIntegrations = undefined;
  state.desktop = false;
});

it("exposes only compiled integrations advertised by the server to administrators", () => {
  expect(renderToStaticMarkup(<List />)).toBe("<div></div>");
  state.supportedIntegrations = ["one", "two", "server-only"];
  expect(renderToStaticMarkup(<List />)).toBe("<div>one,two</div>");
  state.supportedIntegrations = ["two"];
  expect(renderToStaticMarkup(<List />)).toBe("<div>two</div>");
  state.isAdmin = false;
  expect(renderToStaticMarkup(<List />)).toBe("<div></div>");
});

it("hides web-only integration settings in the desktop app", () => {
  state.desktop = true;
  state.supportedIntegrations = ["one", "two"];
  expect(renderToStaticMarkup(<List />)).toBe("<div>one</div>");
});
