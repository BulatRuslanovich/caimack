// SPDX-License-Identifier: AGPL-3.0-only

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { ApiError, request } from "@/lib/http";
import { readStored, writeStored } from "@/lib/storage";

interface AudiobookExperiment {
  enabled: boolean;
}

const queryKey = (scope: string | null) => ["audiobook-experiment", scope] as const;

export function useAudiobookExperiment(scope: string | null) {
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
    refetchInterval: 4_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    meta: { handlesError: true },
  });
  const serverValue = query.data?.enabled;
  useEffect(() => {
    if (scope && serverValue !== undefined) writeStored(storageKey, serverValue ? "on" : "off");
  }, [scope, serverValue, storageKey]);
  return {
    enabled: scope !== null && (serverValue ?? (query.isError && readStored(storageKey) === "on")),
    ready: scope !== null && serverValue !== undefined,
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
    onSuccess: async (value) => {
      const key = queryKey(scope);
      await client.cancelQueries({ queryKey: key });
      client.setQueryData(key, value);
    },
  });
}
