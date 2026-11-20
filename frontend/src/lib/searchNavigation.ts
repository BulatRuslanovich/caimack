// SPDX-License-Identifier: AGPL-3.0-only

export const catalogTabs = [
  "tracks",
  "audiobooks",
  "albums",
  "artists",
  "playlists",
  "genres",
] as const;
export type CatalogTab = (typeof catalogTabs)[number];

export function isCatalogTab(value: string | null): value is CatalogTab {
  return catalogTabs.some((tab) => tab === value);
}
