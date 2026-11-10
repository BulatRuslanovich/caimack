// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich
"use client";

import { cn } from "@/lib/cn";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function VirtualCardGrid({ items, className }: { items: ReactNode[]; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ columns: 1, estimate: 240, gap: 24, margin: 0 });
  const [focused, setFocused] = useState<number | null>(null);

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtual = useVirtualizer({
    count: Math.ceil(items.length / layout.columns),
    getScrollElement: () => document.getElementById("content"),
    estimateSize: () => layout.estimate,
    gap: layout.gap,
    scrollMargin: layout.margin,
    overscan: 3,
    rangeExtractor: useCallback(
      (range) => {
        const indices = defaultRangeExtractor(range);
        if (focused !== null && focused < range.count && !indices.includes(focused))
          indices.push(focused);
        return indices.sort((a, b) => a - b);
      },
      [focused],
    ),
  });

  useLayoutEffect(() => {
    const element = root.current;
    const scroll = document.getElementById("content");
    if (!element || !scroll) return;
    const measure = () => {
      const css = getComputedStyle(element);
      const columns = css.gridTemplateColumns.split(" ").filter(Boolean).length;
      const gap = parseFloat(css.columnGap) || 0;
      const width = (element.clientWidth - (columns - 1) * gap) / columns;
      const margin =
        element.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
      const next = { columns, gap, estimate: width + 80, margin };
      setLayout((previous) =>
        Object.keys(next).every(
          (key) => next[key as keyof typeof next] === previous[key as keyof typeof next],
        )
          ? previous
          : next,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(scroll);
    measure();
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={root}
      className={cn("library-card-grid relative", className)}
      style={{ height: virtual.getTotalSize() }}
      onFocusCapture={(event) => {
        const row = (event.target as HTMLElement).closest<HTMLElement>("[data-index]");
        if (row) setFocused(Number(row.dataset.index));
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null);
      }}
    >
      {virtual.getVirtualItems().map((row) => (
        <div
          key={row.key}
          data-index={row.index}
          ref={virtual.measureElement}
          className="absolute inset-x-0 top-0 grid"
          style={{
            transform: `translateY(${row.start - layout.margin}px)`,
            gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
            columnGap: layout.gap,
          }}
        >
          {items.slice(row.index * layout.columns, (row.index + 1) * layout.columns)}
        </div>
      ))}
    </div>
  );
}
