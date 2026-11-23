// SPDX-License-Identifier: AGPL-3.0-only

import { useT } from "@/contexts/I18nContext";
import { ToggleGroup, ToggleGroupButton } from "@/components/ui/toggle-group";
import { catalogTabs, type CatalogTab } from "@/lib/searchNavigation";
import { useEffect, useRef } from "react";

const labels = {
  tracks: "nav.tracks",
  audiobooks: "nav.audiobooks",
  albums: "nav.albums",
  artists: "nav.artists",
  playlists: "nav.playlists",
  genres: "nav.genres",
} as const;

export function SearchTabs({
  tab,
  audiobooksEnabled,
  onSelect,
  onIntent,
}: {
  tab: CatalogTab | null;
  audiobooksEnabled: boolean;
  onSelect: (tab: CatalogTab | null) => void;
  onIntent?: (tab: CatalogTab) => void;
}) {
  const t = useT();
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector('[aria-pressed="true"]');
    if (!list || !active) return;
    const item = active.getBoundingClientRect();
    const bounds = list.getBoundingClientRect();
    if (item.left < bounds.left) list.scrollLeft += item.left - bounds.left;
    else if (item.right > bounds.right) list.scrollLeft += item.right - bounds.right;
  }, [tab]);

  return (
    <ToggleGroup
      ref={listRef}
      aria-label={t("search.tabs")}
      className="max-sm:flex-wrap max-sm:gap-x-4"
    >
      <ToggleGroupButton
        active={tab === null}
        onClick={() => onSelect(null)}
        className="h-10 py-0 pointer-coarse:h-11"
      >
        {t("search.tab.all")}
      </ToggleGroupButton>
      {catalogTabs
        .filter((value) => audiobooksEnabled || value !== "audiobooks")
        .map((value) => (
          <ToggleGroupButton
            key={value}
            active={tab === value}
            className="h-10 py-0 pointer-coarse:h-11"
            onClick={() => onSelect(value)}
            onPointerEnter={() => onIntent?.(value)}
            onFocus={() => onIntent?.(value)}
          >
            {t(labels[value])}
          </ToggleGroupButton>
        ))}
    </ToggleGroup>
  );
}
