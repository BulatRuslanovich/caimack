// SPDX-License-Identifier: AGPL-3.0-only

import type Hls from "hls.js";
import type { ErrorData, HlsConfig } from "hls.js";
import { createSessionAwareLoader } from "@/lib/playback/hlsSessionLoader";
import { fetchWithSession } from "@/lib/http";
import { mediaUrl } from "@/lib/media";
import { localSource } from "@/desktop/api";
import type { AudioQuality } from "@/lib/types";

type AdaptiveQuality = Exclude<AudioQuality, "Original">;

interface PlaybackRequest {
  trackId: string;
  quality: AudioQuality;
  forceAdaptive: boolean;
  startAt: number;
  play: boolean;
}

interface PlaybackCallbacks {
  onFatalError: () => void;
  onPlayBlocked?: () => void;
}

const HLS_RETRY_DELAYS = [800, 2500, 6000];
const MANIFEST_TIMEOUT_MS = 5_000;

export const STREAM_CHANGE = "streamchange";

type HlsModule = typeof import("hls.js");

let hlsLoading: Promise<HlsModule | null> | null = null;
let sessionAwareLoader: HlsConfig["loader"] | null = null;

function loadHls(): Promise<HlsModule | null> {
  hlsLoading ??= import("hls.js")
    .then((module) => {
      sessionAwareLoader = createSessionAwareLoader(module.default.DefaultConfig.loader);
      return module;
    })
    .catch(() => {
      hlsLoading = null;
      return null;
    });

  return hlsLoading;
}

export function warmUpHls(): void {
  void loadHls();
}

function adaptiveCap(quality: AudioQuality): AdaptiveQuality {
  return quality === "Original" ? "Normal" : quality;
}

export function adaptiveWanted(
  request: Pick<PlaybackRequest, "quality" | "forceAdaptive">,
): boolean {
  return request.forceAdaptive || request.quality !== "Original";
}

export class AdaptivePlayback {
  private readonly audio: HTMLAudioElement;
  private readonly callbacks: PlaybackCallbacks;
  private hls: Hls | null = null;
  private hlsApi: HlsModule | null = null;
  private request: PlaybackRequest | null = null;
  private generation = 0;
  private retryTimer: number | null = null;
  private retries = 0;
  private nativeProbe: AbortController | null = null;
  private manifestParsed = false;
  private preloadSuspended = false;
  private metadataListener: (() => void) | null = null;
  private nativeErrorListener: (() => void) | null = null;

  private destroyed = false;

  constructor(audio: HTMLAudioElement, callbacks: PlaybackCallbacks) {
    this.audio = audio;
    this.callbacks = callbacks;
  }

  async load(request: PlaybackRequest): Promise<void> {
    if (this.destroyed) return;

    const generation = ++this.generation;
    this.request = request;
    this.retries = 0;
    this.audio.dataset.sourceLoading = "true";
    this.destroyDriver();
    this.audio.dataset.playbackMode = "progressive";

    this.audio.pause();

    const local = localSource(request.trackId);
    const adaptive = local ? local === "hls" : adaptiveWanted(request);
    if (adaptive) this.hlsApi = await loadHls();
    if (generation !== this.generation) return;

    if (adaptive) {
      const url = mediaUrl.hls(request.trackId, adaptiveCap(request.quality));
      if (this.hlsApi?.default.isSupported()) {
        this.attachAdaptive(url, request.startAt);
        return;
      }
      if (
        this.audio.canPlayType("application/vnd.apple.mpegurl") &&
        (await this.nativeHlsReady(url))
      ) {
        if (generation === this.generation) this.attachNativeAdaptive(url, request.startAt);
        return;
      }
    }

    if (generation === this.generation) this.attachProgressive(request.startAt);
  }

  destroy(): void {
    this.destroyed = true;
    this.generation += 1;
    this.request = null;
    this.destroyDriver();
  }

  setPlaying(play: boolean): void {
    if (this.request) this.request.play = play;
    if (play) this.playIfReady();
    else this.audio.pause();
  }

  suspendPreload(): boolean {
    // After parsing, hls.js can abort requests while keeping its media buffer.
    if (!this.hls || !this.manifestParsed) {
      // Keep a browser-managed source that already has data and is idle.
      return (
        this.audio.networkState === HTMLMediaElement.NETWORK_IDLE &&
        this.audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
      );
    }
    if (!this.preloadSuspended) {
      this.preloadSuspended = true;
      this.clearRetryTimer();
      this.hls.stopLoad();
    }
    return true;
  }

  resumePreload(): void {
    if (!this.hls || !this.preloadSuspended) return;
    this.preloadSuspended = false;
    this.hls.startLoad(this.audio.currentTime || this.request?.startAt || -1);
  }

  private playIfReady(): void {
    if (!this.request?.play || this.audio.dataset.sourceLoading === "true" || !this.audio.paused) {
      return;
    }

    const generation = this.generation;
    void this.audio.play().catch((error: unknown) => {
      // Source errors are handled by the media recovery path.
      if (
        error instanceof DOMException &&
        error.name === "NotAllowedError" &&
        generation === this.generation &&
        this.request?.play &&
        this.audio.paused
      ) {
        this.callbacks.onPlayBlocked?.();
      }
    });
  }

  private attachAdaptive(url: string, startAt: number): void {
    this.destroyDriver();

    if (!this.hlsApi) {
      this.attachProgressive(startAt);
      return;
    }

    this.audio.dataset.playbackMode = "hls.js";
    this.audio.dataset.sourceLoading = "true";
    this.audio.removeAttribute("src");
    this.audio.load();

    const { default: HlsCtor, Events } = this.hlsApi;
    const hls = new HlsCtor({
      loader: sessionAwareLoader ?? undefined,
      manifestLoadPolicy: {
        default: {
          maxTimeToFirstByteMs: MANIFEST_TIMEOUT_MS,
          maxLoadTimeMs: MANIFEST_TIMEOUT_MS,
          timeoutRetry: null,
          errorRetry: null,
        },
      },
      startLevel: -1,
      abrEwmaDefaultEstimate: 128_000,
      startFragPrefetch: true,
      testBandwidth: false,
      maxBufferLength: 180,
      maxMaxBufferLength: 300,
      backBufferLength: 30,
    });

    this.hls = hls;
    hls.on(Events.MANIFEST_PARSED, () => {
      this.manifestParsed = true;
      this.resumeAt(startAt);
    });
    hls.on(Events.ERROR, (_, data) => {
      if (data.fatal && !this.manifestParsed) {
        queueMicrotask(() => {
          if (this.hls === hls) this.attachProgressive(startAt);
        });
        return;
      }
      this.handleHlsError(data);
    });
    hls.on(Events.LEVEL_SWITCHED, (_, data) =>
      this.reportStream(Math.round((hls.levels[data.level]?.bitrate ?? 0) / 1000) || null),
    );
    hls.loadSource(url);
    hls.attachMedia(this.audio);
    this.reportStream(null);
  }

  private attachProgressive(startAt: number): void {
    this.destroyDriver();
    this.audio.dataset.playbackMode = "progressive";
    this.audio.dataset.sourceLoading = "true";
    this.audio.src = mediaUrl.stream(this.request!.trackId);
    this.audio.load();
    this.resumeAt(startAt);
    this.reportStream(null);
  }

  private attachNativeAdaptive(url: string, startAt: number): void {
    this.destroyDriver();
    this.audio.dataset.playbackMode = "native-hls";
    this.audio.dataset.sourceLoading = "true";
    this.nativeErrorListener = () => this.callbacks.onFatalError();
    this.audio.addEventListener("error", this.nativeErrorListener);
    this.audio.src = url;
    this.audio.load();
    this.resumeAt(startAt);
    this.reportStream(null);
  }

  private reportStream(kbps: number | null): void {
    if (kbps === null) delete this.audio.dataset.streamKbps;
    else this.audio.dataset.streamKbps = String(kbps);
    this.audio.dataset.streamReduced = String(
      this.request?.quality === "Original" && this.audio.dataset.playbackMode !== "progressive",
    );

    this.audio.dispatchEvent(new Event(STREAM_CHANGE));
  }

  private resumeAt(startAt: number): void {
    const apply = () => {
      this.audio.dataset.sourceLoading = "false";
      if (startAt > 0 && Number.isFinite(this.audio.duration)) {
        this.audio.currentTime = Math.min(startAt, this.audio.duration);
      }
      this.audio.dispatchEvent(new Event(STREAM_CHANGE));
      this.playIfReady();
    };

    if (this.audio.readyState >= HTMLMediaElement.HAVE_METADATA) apply();
    else {
      this.metadataListener = apply;
      this.audio.addEventListener("loadedmetadata", apply, { once: true });
    }
  }

  private handleHlsError(data: ErrorData): void {
    if (!data.fatal || !this.hls || !this.hlsApi || this.preloadSuspended) return;

    const { ErrorTypes } = this.hlsApi;

    if (data.type === ErrorTypes.MEDIA_ERROR && this.retries < HLS_RETRY_DELAYS.length) {
      this.retries += 1;
      this.hls.recoverMediaError();
      return;
    }

    if (data.type === ErrorTypes.NETWORK_ERROR && this.scheduleRetry(() => this.hls?.startLoad())) {
      return;
    }

    this.callbacks.onFatalError();
  }

  private scheduleRetry(action: () => void): boolean {
    if (this.retries >= HLS_RETRY_DELAYS.length) return false;
    const delay = HLS_RETRY_DELAYS[this.retries++];
    this.clearRetryTimer();
    this.retryTimer = window.setTimeout(action, delay);
    return true;
  }

  private async nativeHlsReady(url: string): Promise<boolean> {
    // Native media elements do not expose the manifest's HTTP status.
    const controller = (this.nativeProbe = new AbortController());
    const timeout = window.setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS);

    try {
      const response = await fetchWithSession(url, { signal: controller.signal });
      await response.body?.cancel().catch(() => {});
      return response.ok && response.status !== 202;
    } catch {
      return false;
    } finally {
      window.clearTimeout(timeout);
      if (this.nativeProbe === controller) this.nativeProbe = null;
    }
  }

  private destroyDriver(): void {
    this.nativeProbe?.abort();
    this.nativeProbe = null;
    this.manifestParsed = false;
    this.preloadSuspended = false;
    if (this.nativeErrorListener) {
      this.audio.removeEventListener("error", this.nativeErrorListener);
      this.nativeErrorListener = null;
    }
    if (this.metadataListener) {
      this.audio.removeEventListener("loadedmetadata", this.metadataListener);
      this.metadataListener = null;
    }
    this.clearRetryTimer();
    this.hls?.destroy();
    this.hls = null;
  }

  private clearRetryTimer(): void {
    if (this.retryTimer === null) return;
    window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}
