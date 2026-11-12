// SPDX-License-Identifier: AGPL-3.0-only
import type { LibraryFolder } from "./types";

export function folderTrail(folders: LibraryFolder[], id: string | null): LibraryFolder[] {
  const trail: LibraryFolder[] = [];
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = folders.find((f) => f.id === id);
    if (!folder) break;
    trail.unshift(folder);
    id = folder.parentId;
  }
  return trail;
}

export function canMoveFolder(folders: LibraryFolder[], id: string, destination: string | null) {
  return !folderTrail(folders, destination).some((f) => f.id === id);
}
