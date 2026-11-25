// SPDX-License-Identifier: AGPL-3.0-only

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
  const anchor = useRef<{ key: string; id: string } | null>(null);

  if (knownKey !== listKey) {
    setKnownKey(listKey);
    setSelected(new Set());
  }

  const toggle = useCallback(
    (id: string, index: number, extend: boolean) => {
      const anchored =
        extend && anchor.current?.key === listKey ? ids.indexOf(anchor.current.id) : -1;
      const from = anchored < 0 ? index : anchored;

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

      anchor.current = { key: listKey, id };
    },
    [ids, listKey],
  );

  const toggleAll = useCallback(() => {
    setSelected((current) => (ids.every((id) => current.has(id)) ? new Set() : new Set(ids)));
    anchor.current = null;
  }, [ids]);

  const clear = useCallback(() => {
    setSelected(new Set());
    anchor.current = null;
  }, []);

  return { selected, toggle, toggleAll, clear };
}
