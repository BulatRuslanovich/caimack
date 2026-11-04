// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useCallback, useRef, useState } from "react";

interface RowSelection {
  selected: ReadonlySet<string>;
  toggle: (id: string, index: number, extend: boolean) => void;
  toggleAll: () => void;
  clear: () => void;
}

export function useRowSelection(ids: readonly string[], listKey: string): RowSelection {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [knownKey, setKnownKey] = useState(listKey);
  const anchor = useRef<{ key: string; index: number } | null>(null);

  if (knownKey !== listKey) {
    setKnownKey(listKey);
    setSelected(new Set());
  }

  const toggle = useCallback(
    (id: string, index: number, extend: boolean) => {
      const from = extend && anchor.current?.key === listKey ? anchor.current.index : index;

      setSelected((current) => {
        const next = new Set(current);
        const turningOn = !next.has(id);

        for (let at = Math.min(from, index); at <= Math.max(from, index); at += 1) {
          const rowId = ids[at];
          if (!rowId) continue;

          if (turningOn) next.add(rowId);
          else next.delete(rowId);
        }

        return next;
      });

      anchor.current = { key: listKey, index };
    },
    [ids, listKey],
  );

  const toggleAll = useCallback(() => {
    setSelected((current) => (current.size === ids.length ? new Set() : new Set(ids)));
    anchor.current = null;
  }, [ids]);

  const clear = useCallback(() => {
    setSelected(new Set());
    anchor.current = null;
  }, []);

  return { selected, toggle, toggleAll, clear };
}
