// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { invalidates } from "@/lib/queries";

export function useInvalidate(): (...scopes: (keyof typeof invalidates)[]) => void {
  const client = useQueryClient();

  return useCallback(
    (...scopes: (keyof typeof invalidates)[]) => {
      for (const scope of scopes) {
        for (const queryKey of invalidates[scope]) {
          void client.invalidateQueries({ queryKey });
        }
      }
    },
    [client],
  );
}
