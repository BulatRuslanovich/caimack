// SPDX-License-Identifier: AGPL-3.0-only

import { useT } from "@/contexts/I18nContext";
import { ToggleGroup, ToggleGroupButton } from "@/components/ui/toggle-group";
import { catalogTabs, type CatalogTab } from "@/lib/searchNavigation";

const labels = {
  tracks: "nav.tracks",
  albums: "nav.albums",
  artists: "nav.artists",
  playlists: "nav.playlists",
  genres: "nav.genres",
} as const;

export function SearchTabs({
  tab,
  onSelect,
  onIntent,
}: {
  tab: CatalogTab | null;
  onSelect: (tab: CatalogTab | null) => void;
  onIntent?: (tab: CatalogTab) => void;
}) {
  const t = useT();
  return (
    <ToggleGroup aria-label={t("search.tabs")}>
      <ToggleGroupButton active={tab === null} onClick={() => onSelect(null)}>
        {t("search.tab.all")}
      </ToggleGroupButton>
      {catalogTabs.map((value) => (
        <ToggleGroupButton
          key={value}
          active={tab === value}
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
