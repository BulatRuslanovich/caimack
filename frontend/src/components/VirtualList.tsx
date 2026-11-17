// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import {
  isValidElement,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";

export interface VirtualListHandle {
  scrollToIndex: (index: number) => void;
}

/** Window rows in the existing main scroller, including keyboard focus and an active drag. */
export function VirtualList({
  items,
  estimate = 72,
  gap = 0,
  pinned = [],
  role,
  ref,
}: {
  items: ReactNode[];
  estimate?: number;
  gap?: number;
  pinned?: number[];
  role?: "rowgroup";
  ref?: Ref<VirtualListHandle>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  const [focused, setFocused] = useState<number | null>(null);
  const pinnedKey = [...pinned, focused].filter((n): n is number => n !== null && n >= 0).join(",");
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => document.getElementById("content"),
    getItemKey: (index) => {
      const item = items[index];
      return isValidElement(item) && item.key != null ? item.key : index;
    },
    estimateSize: () => estimate,
    initialRect: { width: 1000, height: 800 },
    gap,
    scrollMargin: margin,
    overscan: 5,
    rangeExtractor: useCallback(
      (range) => {
        const indices = new Set(defaultRangeExtractor(range));
        for (const index of pinnedKey.split(",").filter(Boolean).map(Number)) {
          if (index < range.count) indices.add(index);
        }
        return [...indices].sort((a, b) => a - b);
      },
      [pinnedKey],
    ),
  });
  useImperativeHandle(
    ref,
    () => ({ scrollToIndex: (index) => virtual.scrollToIndex(index, { align: "auto" }) }),
    [virtual],
  );
  useLayoutEffect(() => {
    const element = root.current,
      scroll = document.getElementById("content");
    if (!element || !scroll) return;
    const measure = () =>
      setMargin(
        element.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop,
      );
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(scroll);
    measure();
    return () => observer.disconnect();
  }, [items]);
  return (
    <div
      ref={root}
      role={role}
      className="relative"
      data-virtual-list=""
      style={{ height: virtual.getTotalSize() }}
      onFocusCapture={(event) => {
        const row = (event.target as HTMLElement).closest<HTMLElement>("[data-virtual-index]");
        if (row) setFocused(Number(row.dataset.virtualIndex));
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null);
      }}
    >
      {virtual.getVirtualItems().map((row) => (
        <div
          key={row.key}
          data-index={row.index}
          data-virtual-index={row.index}
          ref={virtual.measureElement}
          role={role ? "presentation" : undefined}
          className="absolute inset-x-0 top-0"
          style={{ transform: `translateY(${row.start - margin}px)` }}
        >
          {items[row.index]}
        </div>
      ))}
    </div>
  );
}
