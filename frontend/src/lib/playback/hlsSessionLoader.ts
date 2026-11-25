// SPDX-License-Identifier: AGPL-3.0-only

import type {
  HlsConfig,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
  LoaderStats,
} from "hls.js";
import { refreshSession } from "@/lib/http";

const UNAUTHORIZED = 401;
const ACCEPTED = 202;

type LoaderConstructor = HlsConfig["loader"];

export function createSessionAwareLoader(BaseLoader: LoaderConstructor): LoaderConstructor {
  return class SessionAwareLoader implements Loader<LoaderContext> {
    private readonly hlsConfig: HlsConfig;
    private inner: Loader<LoaderContext>;
    private refreshed = false;
    private destroyed = false;
    private aborted = false;

    constructor(hlsConfig: HlsConfig) {
      this.hlsConfig = hlsConfig;
      this.inner = new BaseLoader(hlsConfig);
    }

    get context(): LoaderContext | null {
      return this.inner.context;
    }

    set context(value: LoaderContext | null) {
      this.inner.context = value;
    }

    get stats(): LoaderStats {
      return this.inner.stats;
    }

    set stats(value: LoaderStats) {
      this.inner.stats = value;
    }

    load(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>,
    ): void {
      this.refreshed = false;
      this.aborted = false;
      this.inner.load(context, config, this.reauthorizing(context, config, callbacks));
    }

    abort(): void {
      this.aborted = true;
      this.inner.abort();
    }

    destroy(): void {
      this.destroyed = true;
      this.inner.destroy();
    }

    getCacheAge(): number | null {
      return this.inner.getCacheAge?.() ?? null;
    }

    getResponseHeader(name: string): string | null {
      return this.inner.getResponseHeader?.(name) ?? null;
    }

    private reauthorizing(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>,
    ): LoaderCallbacks<LoaderContext> {
      const wrapped: LoaderCallbacks<LoaderContext> = {
        ...callbacks,
        onSuccess: (response, stats, responseContext, networkDetails) => {
          if (response.code === ACCEPTED) {
            callbacks.onError(
              { code: ACCEPTED, text: "HLS is being prepared" },
              responseContext,
              networkDetails,
              stats,
            );
            return;
          }
          callbacks.onSuccess(response, stats, responseContext, networkDetails);
        },
        onError: (error, errorContext, networkDetails, stats) => {
          const surrender = () => callbacks.onError(error, errorContext, networkDetails, stats);

          if (this.aborted || this.destroyed) return;
          if (error.code !== UNAUTHORIZED || this.refreshed) {
            surrender();
            return;
          }

          this.refreshed = true;
          void refreshSession().then((renewed) => {
            if (this.aborted || this.destroyed) return;
            if (!renewed) {
              surrender();
              return;
            }

            this.inner = new BaseLoader(this.hlsConfig);
            this.inner.load(context, config, wrapped);
          });
        },
      };

      return wrapped;
    }
  };
}
