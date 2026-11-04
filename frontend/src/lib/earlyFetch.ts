// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

const PRELOAD_GLOBAL = "__msPreload";

export const SESSION_HINT_COOKIE = "ms_session";

const PRELOAD = "/api/auth/me";

export const EARLY_FETCH_SCRIPT = `try {
  if (document.cookie.indexOf("${SESSION_HINT_COOKIE}=") !== -1) {
    window.${PRELOAD_GLOBAL} = {
      "${PRELOAD}": fetch("${PRELOAD}", { credentials: "include" }).catch(function () {
        return null;
      }),
    };
  }
} catch (e) {}`;

type PreloadStore = Record<string, Promise<Response | null> | undefined>;

export async function takePreloaded(url: string): Promise<Response | null> {
  if (typeof window === "undefined") return null;

  const store = (window as unknown as Record<string, PreloadStore | undefined>)[PRELOAD_GLOBAL];
  const pending = store?.[url];
  if (!store || !pending) return null;

  delete store[url];

  const response = await pending;
  return response ?? null;
}
