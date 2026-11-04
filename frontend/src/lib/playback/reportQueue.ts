// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

export function reportQueue<T extends { id: string }>(queue: T[], index: number) {
  const from = Math.max(0, index - 100);
  return { trackIds: queue.slice(from, index + 401).map((track) => track.id), index: index - from };
}
