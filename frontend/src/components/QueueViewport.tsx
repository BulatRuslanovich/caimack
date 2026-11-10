// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich
"use client";

import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export function QueueViewport({
  rows,
  activeId,
  initialIndex,
}: {
  rows: { key: string; content: ReactNode }[];
  activeId: string | null;
  initialIndex: number;
}) {
  const list = useRef<HTMLOListElement>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const windowed = rows.length > 150;
  const active = rows.findIndex((row) => row.key === activeId);
  const focus = rows.findIndex((row) => row.key === focused);
  // This component uses TanStack's imperative measurements; do not compiler-memoize it.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtual = useVirtualizer({
    count: rows.length,
    enabled: windowed,
    getScrollElement: () => list.current,
    estimateSize: () => 54,
    getItemKey: (index) => rows[index].key,
    overscan: 12,
    gap: 2,
    rangeExtractor: useCallback(
      (range) => {
        const indices = new Set(defaultRangeExtractor(range));
        if (active >= 0) indices.add(active);
        if (focus >= 0) indices.add(focus);
        return [...indices].sort((a, b) => a - b);
      },
      [active, focus],
    ),
  });
  const initial = useRef(initialIndex);
  useEffect(() => {
    if (windowed) virtual.scrollToIndex(initial.current, { align: "center" });
    else list.current?.querySelector("[data-current]")?.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ol
      ref={list}
      className="relative min-h-0 overflow-y-auto"
      onFocusCapture={(event) =>
        setFocused(
          (event.target as HTMLElement).closest<HTMLElement>("[data-entry]")?.dataset.entry ?? null,
        )
      }
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null);
      }}
    >
      {windowed ? (
        <>
          <li
            aria-hidden="true"
            style={{ height: virtual.getTotalSize(), pointerEvents: "none" }}
          />
          {virtual.getVirtualItems().map((row) => (
            <li
              key={row.key}
              data-entry={rows[row.index].key}
              data-index={row.index}
              ref={virtual.measureElement}
              className="absolute inset-x-0 top-0"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              {rows[row.index].content}
            </li>
          ))}
        </>
      ) : (
        rows.map((row) => (
          <li key={row.key} data-entry={row.key} className="mb-0.5">
            {row.content}
          </li>
        ))
      )}
    </ol>
  );
}
