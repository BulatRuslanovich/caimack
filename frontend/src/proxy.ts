// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_HINT_COOKIE } from "@/lib/earlyFetch";
import { sessionGate } from "@/lib/session/sessionGate";
import { decodeBase64Url } from "@/lib/session/sessionHint";

const ACCESS_COOKIE = "ms_access";
const REFRESH_COOKIE = "ms_refresh";

const LOGIN_PATH = "/login";
const INVITE_PATH = "/invite/";

const RENEW_WINDOW_MS = 30_000;

function backendUrl(): string {
  return process.env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:5199";
}

function expiresAt(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;

  try {
    const exp = (decodeBase64Url(payload) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function needsRenewal(request: NextRequest): boolean {
  if (!request.cookies.has(REFRESH_COOKIE)) return false;

  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  if (!access) return true;

  const deadline = expiresAt(access);
  return deadline === null ? false : deadline - Date.now() < RENEW_WINDOW_MS;
}

type Renewal =
  | { status: "renewed"; cookie: string; setCookie: string[] }
  | { status: "rejected"; setCookie: string[] }
  | { status: "unavailable" };

async function renew(request: NextRequest): Promise<Renewal> {
  try {
    const response = await fetch(`${backendUrl()}/api/auth/refresh`, {
      method: "POST",
      headers: { cookie: request.headers.get("cookie") ?? "" },
      cache: "no-store",
    });

    if (response.status === 401) {
      return { status: "rejected", setCookie: response.headers.getSetCookie() };
    }

    if (!response.ok) return { status: "unavailable" };

    const setCookie = response.headers.getSetCookie();
    if (setCookie.length === 0) return { status: "unavailable" };

    const merged = new Map<string, string>();
    for (const cookie of request.cookies.getAll()) merged.set(cookie.name, cookie.value);
    for (const raw of setCookie) {
      const [pair] = raw.split(";");
      const separator = pair.indexOf("=");
      if (separator > 0) merged.set(pair.slice(0, separator).trim(), pair.slice(separator + 1));
    }

    return {
      status: "renewed",
      cookie: [...merged].map(([name, value]) => `${name}=${value}`).join("; "),
      setCookie,
    };
  } catch {
    return { status: "unavailable" };
  }
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const onLoginPage = pathname === LOGIN_PATH;
  const onPublicPage = onLoginPage || pathname.startsWith(INVITE_PATH);

  const renewal: Renewal = needsRenewal(request) ? await renew(request) : { status: "unavailable" };

  const goTo = (path: string) => {
    const target = request.nextUrl.clone();
    target.pathname = path;
    target.search = "";
    return NextResponse.redirect(target);
  };

  const gate = sessionGate({
    renewal: renewal.status,
    hasRefreshCookie: request.cookies.has(REFRESH_COOKIE),
    hasSessionHint: request.cookies.has(SESSION_HINT_COOKIE),
  });

  if (gate === "sessionEnded" && renewal.status === "rejected") {
    const response = onPublicPage ? NextResponse.next() : goTo(LOGIN_PATH);
    for (const cookie of renewal.setCookie) response.headers.append("set-cookie", cookie);
    return response;
  }

  if (gate === "signedOut" && !onPublicPage) return goTo(LOGIN_PATH);
  if (gate === "signedIn" && onLoginPage) return goTo("/");

  if (renewal.status !== "renewed") return NextResponse.next();

  const headers = new Headers(request.headers);
  headers.set("cookie", renewal.cookie);

  const response = NextResponse.next({ request: { headers } });
  for (const cookie of renewal.setCookie) response.headers.append("set-cookie", cookie);

  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|icons|.*\\.[^/]+$).*)"],
};
