// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HlsConfig,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
  LoaderStats,
} from "hls.js";
import { createSessionAwareLoader } from "@/lib/playback/hlsSessionLoader";

const refreshSession = vi.hoisted(() => vi.fn<() => Promise<boolean>>());
vi.mock("@/lib/http", () => ({ refreshSession }));

class FakeLoader implements Loader<LoaderContext> {
  static statuses: number[] = [];
  static loads: string[] = [];

  context: LoaderContext | null = null;
  stats = { loading: { start: 0 } } as LoaderStats;
  private used = false;

  load(
    context: LoaderContext,
    _config: LoaderConfiguration,
    callbacks: LoaderCallbacks<LoaderContext>,
  ): void {
    if (this.used) throw new Error("Loader can only be used once.");
    this.used = true;
    this.context = context;
    FakeLoader.loads.push(context.url);

    const status = FakeLoader.statuses.shift() ?? 200;
    if (status >= 200 && status < 300) {
      callbacks.onSuccess(
        { url: context.url, data: "ok", code: status },
        this.stats,
        context,
        null,
      );
      return;
    }

    callbacks.onError({ code: status, text: "nope" }, context, null, this.stats);
  }

  abort(): void {}
  destroy(): void {}
}

const context = { url: "/api/tracks/x/hls/low/segment-00001.m4s" } as LoaderContext;
const configuration = {} as LoaderConfiguration;

function run() {
  const Loader = createSessionAwareLoader(FakeLoader as unknown as HlsConfig["loader"]);
  const onSuccess = vi.fn();
  const onError = vi.fn();

  const loader = new Loader({} as HlsConfig);
  loader.load(context, configuration, {
    onSuccess,
    onError,
    onTimeout: vi.fn(),
  });

  return { loader, onSuccess, onError };
}

describe("session aware hls loader", () => {
  beforeEach(() => {
    FakeLoader.statuses = [];
    FakeLoader.loads = [];
    refreshSession.mockReset();
  });

  it("renews the session and replays the request once on 401", async () => {
    FakeLoader.statuses = [401, 200];
    refreshSession.mockResolvedValue(true);

    const { onSuccess, onError } = run();
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());

    expect(onError).not.toHaveBeenCalled();
    expect(refreshSession).toHaveBeenCalledOnce();
    expect(FakeLoader.loads).toEqual([context.url, context.url]);
  });

  it("surrenders when the session cannot be renewed", async () => {
    FakeLoader.statuses = [401];
    refreshSession.mockResolvedValue(false);

    const { onError } = run();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());

    expect(FakeLoader.loads).toHaveLength(1);
  });

  it("surrenders on a second 401 instead of looping on refresh", async () => {
    FakeLoader.statuses = [401, 401];
    refreshSession.mockResolvedValue(true);

    const { onError } = run();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());

    expect(refreshSession).toHaveBeenCalledOnce();
    expect(FakeLoader.loads).toHaveLength(2);
  });

  it("leaves other failures to hls.js", async () => {
    FakeLoader.statuses = [404];

    const { onError } = run();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());

    expect(refreshSession).not.toHaveBeenCalled();
    expect(FakeLoader.loads).toHaveLength(1);
  });

  it("passes an accepted response to hls.js as a loading error", () => {
    FakeLoader.statuses = [202];
    const { onSuccess, onError } = run();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ code: 202 });
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("does not replay a request canceled while refreshing the session", async () => {
    FakeLoader.statuses = [401, 200];
    const renewal = Promise.withResolvers<boolean>();
    refreshSession.mockReturnValue(renewal.promise);
    const { loader, onSuccess, onError } = run();
    loader.abort();
    renewal.resolve(true);
    await renewal.promise;

    expect(FakeLoader.loads).toEqual([context.url]);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
