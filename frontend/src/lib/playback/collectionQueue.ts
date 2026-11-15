// SPDX-License-Identifier: AGPL-3.0-only

/** A collection remains active after shuffling or reordering its occurrences. */
export function matchesCollection(
  collection: string[],
  queue: string[],
  current: string | null,
  automatic: string[] = [],
): boolean {
  const members = new Set(collection);
  const generated = new Set(automatic);
  queue = queue.filter((id) => members.has(id) || !generated.has(id));
  if (
    current === null ||
    collection.length === 0 ||
    collection.length !== queue.length ||
    !collection.includes(current)
  )
    return false;
  const counts = new Map<string, number>();
  for (const id of collection) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const id of queue) {
    const count = counts.get(id) ?? 0;
    if (count === 0) return false;
    counts.set(id, count - 1);
  }
  return true;
}
