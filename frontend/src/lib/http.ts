// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { takePreloaded } from "@/lib/earlyFetch";
import { requestLocale, tr } from "@/lib/i18n";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const API_BASE = "/api";

interface ServerRequest {
  cookie: string;
  origin: string;
}

function serverRequest(): ServerRequest | null {
  if (typeof window !== "undefined") return null;

  const holder = (
    globalThis as unknown as Record<string, { getStore(): ServerRequest | undefined }>
  ).__msServerRequest;

  return holder?.getStore() ?? null;
}

let refreshInFlight: Promise<boolean> | null = null;

type SessionExpiredListener = () => void;
const sessionExpiredListeners = new Set<SessionExpiredListener>();

export function onSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

export async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();

  return refreshInFlight;
}

export async function fetchWithSession(
  url: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const request = () => fetch(url, { ...init, credentials: "include" });

  const response = await request();
  if (response.status !== 401) return response;

  await response.body?.cancel().catch(() => {});

  return (await refreshSession()) ? request() : response;
}

export interface DownloadedFile {
  blob: Blob;
  fileName: string;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  isRetry?: boolean;
  allowUnauthenticated?: boolean;
  sessionless?: boolean;
  headers?: Record<string, string>;
}

export const GATEWAY_STATUSES = new Set([
  502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530,
]);

const RETRY_DELAYS_MS = [400, 1200];

function isAbort(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "AbortError";
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retryable: boolean,
): Promise<Response> {
  let lastReason: unknown = null;

  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, init);

      if (
        !retryable ||
        !GATEWAY_STATUSES.has(response.status) ||
        attempt >= RETRY_DELAYS_MS.length
      ) {
        return response;
      }
    } catch (reason) {
      if (isAbort(reason) || !retryable || attempt >= RETRY_DELAYS_MS.length) throw reason;
      lastReason = reason;
    }

    await delay(RETRY_DELAYS_MS[attempt], init.signal ?? undefined);

    if (init.signal?.aborted) {
      throw lastReason ?? new DOMException("Aborted", "AbortError");
    }
  }
}

async function send(path: string, options: RequestOptions = {}): Promise<Response> {
  const {
    method = "GET",
    body,
    signal,
    isRetry = false,
    allowUnauthenticated = false,
    sessionless = false,
    headers: extraHeaders,
  } = options;

  const init: RequestInit = { method, credentials: "include", signal };

  const url = `${API_BASE}${path}`;
  const server = serverRequest();
  const headers: Record<string, string> = {
    ...extraHeaders,
    "Accept-Language": requestLocale(server?.cookie),
  };
  init.headers = headers;

  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  if (server) {
    headers.cookie = server.cookie;
    init.cache = "no-store";
    delete init.credentials;
  }

  const target = server ? `${server.origin}${url}` : url;

  const response =
    (method === "GET" && !isRetry && !server ? await takePreloaded(url) : null) ??
    (await fetchWithRetry(target, init, method === "GET"));

  if (response.status === 401 && server) {
    throw new ApiError(401, tr("error.sessionExpired"));
  }

  if (response.status === 401 && !isRetry && !sessionless) {
    if (await refreshSession()) {
      return send(path, { ...options, isRetry: true });
    }

    if (!allowUnauthenticated) {
      sessionExpiredListeners.forEach((listener) => listener());
    }

    throw new ApiError(401, tr("error.sessionExpired"));
  }

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorMessage(response));
  }

  return response;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options);

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function requestFile(path: string, fallbackName: string): Promise<DownloadedFile> {
  const response = await send(path);

  return {
    blob: await response.blob(),
    fileName: fileNameFromDisposition(response.headers.get("Content-Disposition")) ?? fallbackName,
  };
}

function fileNameFromDisposition(header: string | null): string | null {
  if (!header) return null;

  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      return null;
    }
  }

  return /filename="([^"]+)"/i.exec(header)?.[1] ?? null;
}

async function readErrorMessage(response: Response): Promise<string> {
  if (GATEWAY_STATUSES.has(response.status)) {
    return tr("error.unreachable");
  }

  try {
    const text = await response.text();
    if (!text) {
      if (response.status === 403) return tr("error.forbidden");
      return response.statusText || tr("error.requestFailed", { status: response.status });
    }

    const parsed = JSON.parse(text) as { detail?: string; title?: string };
    return parsed.detail ?? parsed.title ?? text;
  } catch {
    return response.statusText || tr("error.requestFailed", { status: response.status });
  }
}

export function fileForm(file: File): FormData {
  const form = new FormData();
  form.append("file", file);
  return form;
}

export function qs(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const asString = search.toString();
  return asString ? `?${asString}` : "";
}
