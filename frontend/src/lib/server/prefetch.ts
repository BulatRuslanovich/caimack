// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import "server-only";
import { QueryClient, dehydrate, type DehydratedState } from "@tanstack/react-query";
import { cookies } from "next/headers";
import { ApiError } from "@/lib/http";
import { backendOrigin, requestContext } from "@/lib/server/requestContext";

export async function prefetchOnServer(
  prefetch: (client: QueryClient) => Promise<unknown>,
): Promise<DehydratedState> {
  const client = new QueryClient();
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
