// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queries } from "@/lib/queries";
import type { UserSettings } from "@/lib/types";
import { useAuth } from "@/contexts/AuthContext";

const DEFAULTS: UserSettings = { quality: "Normal", timeZone: "UTC" };

const DEFAULT_MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const DEFAULT_MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;

export function useSettings() {
  const signedIn = useAuth().user !== null;
  const client = useQueryClient();
  const key = queries.settings().queryKey;

  const config = useQuery({ ...queries.config(), enabled: signedIn });
  const saved = useQuery({ ...queries.settings(), enabled: signedIn });

  const { mutate: update } = useMutation({
    mutationFn: (changes: Partial<UserSettings>) => api.updateSettings(changes),
    onMutate: (changes) => {
      const previous = client.getQueryData(key);
      client.setQueryData(key, { ...(previous ?? DEFAULTS), ...changes });
      return previous;
    },
    onError: (_, __, previous) => client.setQueryData(key, previous),
    onSuccess: (settings) => client.setQueryData(key, settings),
  });

  const settings = saved.data ?? DEFAULTS;
  return {
    ...settings,
    maxUploadBytes: config.data?.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES,
    maxImageUploadBytes: config.data?.maxImageUploadBytes ?? DEFAULT_MAX_IMAGE_UPLOAD_BYTES,
    update,
  };
}
