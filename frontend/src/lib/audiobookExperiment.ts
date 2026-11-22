// SPDX-License-Identifier: AGPL-3.0-only

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { ApiError, request } from "@/lib/http";
import { readStored, writeStored } from "@/lib/storage";

interface AudiobookExperiment {
  enabled: boolean;
}

const queryKey = (scope: string | null) => ["audiobook-experiment", scope] as const;

export function useAudiobookExperiment(scope: string | null) {
  const client = useQueryClient();
  const storageKey = `caimack.server-audiobooks:${scope}`;
  const query = useQuery({
    queryKey: queryKey(scope),
    queryFn: async ({ signal }) => {
      try {
        return await request<AudiobookExperiment>("/experiments/audiobooks", { signal });
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return { enabled: false };
        throw error;
      }
    },
    enabled: scope !== null,
    networkMode: "always",
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: "always",
    meta: { handlesError: true },
  });
  const receive = useCallback(
    (enabled: boolean) => {
      if (!scope) return;
      const key = queryKey(scope);
      void client.cancelQueries({ queryKey: key });
      client.setQueryData<AudiobookExperiment>(key, { enabled });
    },
    [client, scope],
  );
  const serverValue = query.data?.enabled;
  useEffect(() => {
    if (scope && serverValue !== undefined) writeStored(storageKey, serverValue ? "on" : "off");
  }, [scope, serverValue, storageKey]);
  return {
    enabled: scope !== null && (serverValue ?? (query.isError && readStored(storageKey) === "on")),
    ready: scope !== null && serverValue !== undefined,
    receive,
  };
}

export function useSetAudiobookExperiment(scope: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      request<AudiobookExperiment>("/admin/experiments/audiobooks", {
        method: "PUT",
        body: { enabled },
      }),
    onSuccess: (value) => {
      const key = queryKey(scope);
      if (client.getQueryData<AudiobookExperiment>(key)?.enabled !== value.enabled) {
        return client.invalidateQueries({ queryKey: key });
      }
    },
  });
}
