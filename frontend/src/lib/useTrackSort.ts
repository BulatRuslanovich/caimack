// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useState } from "react";
import type { SortDirection } from "./types";

export function useTrackSort<T extends string>(
  initial: T,
  defaults: Partial<Record<T, SortDirection>>,
) {
  const [{ value, direction }, setSort] = useState<{ value: T; direction: SortDirection }>({
    value: initial,
    direction: defaults[initial] ?? "asc",
  });

  return {
    value,
    direction,
    onChange: (next: T) =>
      setSort((current) => ({
        value: next,
        direction:
          current.value === next
            ? current.direction === "asc"
              ? "desc"
              : "asc"
            : (defaults[next] ?? "asc"),
      })),
  };
}
