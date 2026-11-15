// SPDX-License-Identifier: AGPL-3.0-only
import type { QueryClient } from "@tanstack/react-query";
import type { LibraryChange, LibraryFolder, LibraryItem } from "./types";

/** Update the visible folder immediately and retain a rollback for rejected mutations. */
export async function optimisticLibraryChange(client: QueryClient, change: LibraryChange) {
  const queryKey =
    change.operation === "reorder"
      ? ["libraryOrder"]
      : change.operation === "moveItem"
        ? ["savedLibrary"]
        : change.operation === "moveFolder"
          ? ["libraryFolders"]
          : null;
  if (!queryKey) return;
  await client.cancelQueries({ queryKey });
  const previous = client.getQueryData(queryKey);
  if (change.operation === "reorder") {
    client.setQueryData<Record<string, string[]>>(queryKey, (order) => ({
      ...order,
      [change.folderId ?? "root"]: change.order,
    }));
  } else if (change.operation === "moveItem") {
    client.setQueryData<LibraryItem[]>(queryKey, (items) =>
      items?.map((item) =>
        item.id === change.id && item.kind === change.kind
          ? { ...item, folderId: change.folderId }
          : item,
      ),
    );
  } else if (change.operation === "moveFolder") {
    client.setQueryData<LibraryFolder[]>(queryKey, (folders) =>
      folders?.map((folder) =>
        folder.id === change.id ? { ...folder, parentId: change.folderId } : folder,
      ),
    );
  }
  return { queryKey, previous };
}
