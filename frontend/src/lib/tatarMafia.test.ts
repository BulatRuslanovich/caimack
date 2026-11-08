// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, expect, it, vi } from "vitest";

vi.mock("react", () => ({
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
afterEach(() => vi.unstubAllGlobals());

it("is opt-in and remembers the switch across module reloads", async () => {
  const saved = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
    },
  });
  const mode = await import("./tatarMafia");
  expect(mode.useTatarMafia()).toBe(false);
  mode.setTatarMafia(true);
  expect(mode.useTatarMafia()).toBe(true);
  vi.resetModules();
  const reloaded = await import("./tatarMafia");
  expect(reloaded.useTatarMafia()).toBe(true);
  reloaded.setTatarMafia(false);
  expect(reloaded.useTatarMafia()).toBe(false);
});
