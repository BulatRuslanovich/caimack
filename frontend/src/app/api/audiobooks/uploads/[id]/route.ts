// SPDX-License-Identifier: AGPL-3.0-only

import type { NextRequest } from "next/server";
import { backendOrigin } from "@/lib/server/requestContext";

const requestHeaders = [
  "accept-language",
  "authorization",
  "content-length",
  "content-type",
  "cookie",
  "origin",
  "sec-fetch-site",
];
const responseHeaders = ["cache-control", "content-language", "content-type", "retry-after"];

function pickHeaders(from: Headers, names: string[]): Headers {
  const headers = new Headers();
  for (const name of names) {
    const value = from.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

// The development rewrite clones the request body and truncates large uploads.
export async function PUT(request: NextRequest) {
  if (process.env.NODE_ENV !== "development" || process.env.NEXT_DISABLE_API_PROXY === "1") {
    return new Response(null, { status: 404 });
  }

  const headers = pickHeaders(request.headers, requestHeaders);
  headers.set("x-forwarded-host", request.headers.get("host") ?? request.nextUrl.host);
  const options: RequestInit & { duplex: "half" } = {
    method: "PUT",
    body: request.body,
    duplex: "half",
    headers,
    signal: request.signal,
    cache: "no-store",
    redirect: "manual",
  };

  try {
    const upstream = await fetch(new URL(request.nextUrl.pathname, backendOrigin()), options);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: pickHeaders(upstream.headers, responseHeaders),
    });
  } catch (error) {
    if (!request.signal.aborted) console.error("Audiobook upload proxy failed", error);
    return new Response(null, { status: 502 });
  }
}
