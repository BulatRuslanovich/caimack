// SPDX-License-Identifier: AGPL-3.0-only

import "server-only";
import { QueryClient, dehydrate, type DehydratedState } from "@tanstack/react-query";
import { cookies, headers } from "next/headers";
import { ApiError } from "@/lib/http";
import { backendOrigin, requestContext } from "@/lib/server/requestContext";

export const prefetchInitialPage = (prefetch: (client: QueryClient) => Promise<unknown>) =>
  prefetchOnServer(prefetch, { initialOnly: true });

export async function prefetchOnServer(
  prefetch: (client: QueryClient) => Promise<unknown>,
  { initialOnly = false }: { initialOnly?: boolean } = {},
): Promise<DehydratedState> {
  const client = new QueryClient();
  // Fetch requests, including in-app navigation, already have a browser query
  // cache. Avoid blocking them on duplicate reads; document loads still get SSR.
  // Use standard Fetch Metadata because Next normalizes away Flight headers.
  if (initialOnly && (await headers()).get("sec-fetch-dest") === "empty") return dehydrate(client);
  const cookie = (await cookies()).toString();

  try {
    await requestContext.run({ cookie, origin: backendOrigin() }, () => prefetch(client));
  } catch (reason) {
    if (!(reason instanceof ApiError && reason.status === 401)) {
      console.warn(
        `[prefetch] server-side prefetch against ${backendOrigin()} failed:`,
        reason instanceof Error ? reason.message : reason,
      );
    }
  }

  return dehydrate(client);
}
