// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useCallback, useState } from "react";

export function usePage(deps: unknown[]): [number, (page: number) => void] {
  const key = JSON.stringify(deps);
  const [state, setState] = useState({ key, page: 1 });

  if (state.key !== key) setState({ key, page: 1 });

  const setPage = useCallback((page: number) => setState((current) => ({ ...current, page })), []);

  return [state.key === key ? state.page : 1, setPage];
}
