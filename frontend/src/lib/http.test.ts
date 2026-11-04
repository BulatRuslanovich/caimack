// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchWithSession, onSessionExpired, request } from "@/lib/http";

interface Call {
  url: string;
  credentials?: RequestCredentials;
}

function stubFetch(mediaStatuses: number[], refreshOk: boolean) {
  const calls: Call[] = [];
  let next = 0;

  vi.stubGlobal("fetch", (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, credentials: init.credentials });

    if (url.endsWith("/auth/refresh")) {
      return Promise.resolve(new Response(null, { status: refreshOk ? 204 : 401 }));
    }

    const status = mediaStatuses[Math.min(next++, mediaStatuses.length - 1)];
    return Promise.resolve(new Response(status === 204 ? null : "#EXTM3U", { status }));
  });

  return calls;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe("fetchWithSession", () => {
  it("renews the session once and repeats the request", async () => {
    const calls = stubFetch([401, 200], true);

    const response = await fetchWithSession("/api/tracks/1/hls/master.m3u8");

    expect(response.status).toBe(200);
    expect(calls.map((call) => call.url)).toEqual([
      "/api/tracks/1/hls/master.m3u8",
      "/api/auth/refresh",
      "/api/tracks/1/hls/master.m3u8",
    ]);
  });

  it("gives back the 401 when the session cannot be renewed", async () => {
    const calls = stubFetch([401, 200], false);

    const response = await fetchWithSession("/api/tracks/1/hls/master.m3u8");

    expect(response.status).toBe(401);
    expect(calls).toHaveLength(2);
  });

  it("passes anything but a 401 straight through", async () => {
    for (const status of [200, 202, 404, 500]) {
      const calls = stubFetch([status], true);

      expect((await fetchWithSession("/api/tracks/1/hls/master.m3u8")).status).toBe(status);
      expect(calls).toHaveLength(1);

      vi.unstubAllGlobals();
    }
  });

  it("sends cookies and keeps the caller's init", async () => {
    const calls = stubFetch([200], true);
    const controller = new AbortController();

    await fetchWithSession(new URL("https://example.test/segment.m4s"), {
      signal: controller.signal,
    });

    expect(calls[0].url).toBe("https://example.test/segment.m4s");
    expect(calls[0].credentials).toBe("include");
  });
});

describe("request", () => {
  it("takes a 401 from a sessionless request as the server's answer", async () => {
    const urls: string[] = [];
    const expired = vi.fn();
    const unsubscribe = onSessionExpired(expired);

    vi.stubGlobal("fetch", (input: string | URL) => {
      urls.push(String(input));
      return Promise.resolve(
        new Response(JSON.stringify({ detail: "Invalid username or password." }), { status: 401 }),
      );
    });

    const failure = await request("/auth/login", { method: "POST", sessionless: true }).catch(
      (reason: unknown) => reason,
    );
    unsubscribe();

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(401);
    expect((failure as ApiError).message).toBe("Invalid username or password.");
    expect(urls).toEqual(["/api/auth/login"]);
    expect(expired).not.toHaveBeenCalled();
  });
});
