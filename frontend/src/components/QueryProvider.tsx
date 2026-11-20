// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { isDesktop } from "@/desktop/api";
import { useT } from "@/contexts/I18nContext";
import { ApiError, GATEWAY_STATUSES } from "@/lib/http";
import { useToast } from "@/lib/useToast";

const STALE_MS = 5 * 60 * 1000;

const GC_MS = 24 * 60 * 60 * 1000;

export function QueryProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const { notifyError } = useToast();

  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error, query) => {
            if (query.meta?.handlesError) return;
            if (
              query.meta?.hasOfflineFallback &&
              (error instanceof TypeError ||
                (error instanceof ApiError && GATEWAY_STATUSES.has(error.status)))
            )
              return;
            notifyError(error, t("error.load"));
          },
        }),
        mutationCache: new MutationCache({
          onError: (error, _variables, _context, mutation) => {
            if (!mutation.options.meta?.handlesError) notifyError(error);
          },
        }),
        defaultOptions: {
          queries: {
            staleTime: STALE_MS,
            gcTime: GC_MS,
            retry: false,
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
            networkMode: "offlineFirst",
          },
          mutations: { networkMode: "always" },
        },
      }),
  );

  useEffect(() => {
    if (!isDesktop) return;
    const refresh = () => void client.invalidateQueries();
    window.addEventListener("caimack:refetch", refresh);
    return () => window.removeEventListener("caimack:refetch", refresh);
  }, [client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
