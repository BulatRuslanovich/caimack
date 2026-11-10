// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "./api";
import { queries } from "./queries";

// A session side effect, separate from reading settings. Deferring one microtask
// lets React's setup/cleanup probe cancel the duplicate StrictMode request.
export function useTimeZoneSync(userId: string | null) {
  const client = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void client
      .ensureQueryData(queries.settings())
      .then(async (saved) => {
        if (cancelled) return;
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (!timeZone || timeZone === saved.timeZone) return;
        const updated = await api.updateSettings({ timeZone });
        if (!cancelled) client.setQueryData(queries.settings().queryKey, updated);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, userId]);
}
