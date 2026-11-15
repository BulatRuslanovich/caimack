// SPDX-License-Identifier: AGPL-3.0-only
import { rectSortingStrategy, type SortingStrategy } from "@dnd-kit/sortable";

/** Hovering a folder is a potential move into it, not a request to make a new slot. */
export function librarySortingStrategy(keys: string[]): SortingStrategy {
  return (args) =>
    args.overIndex < 0 || keys[args.overIndex]?.startsWith("folder:")
      ? null
      : rectSortingStrategy(args);
}
