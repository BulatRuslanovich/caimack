// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { ArrowDownIcon, ArrowUpIcon, ListFilterIcon } from "lucide-react";
import { useT } from "@/contexts/I18nContext";
import type { TranslationKey } from "@/lib/i18n";
import type { SortDirection } from "@/lib/types";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export function TrackSortMenu<T extends string>({
  value,
  direction,
  options,
  onChange,
  manual,
}: {
  value: T;
  direction: SortDirection;
  options: Record<T, TranslationKey>;
  onChange: (value: T) => void;
  manual?: T;
}) {
  const t = useT();
  const showDirection = value !== manual;
  const DirectionIcon = direction === "asc" ? ArrowUpIcon : ArrowDownIcon;
  const directionLabel = direction === "asc" ? "sort.ascending" : "sort.descending";
  const label = [t("sort.label"), t(options[value]), showDirection && t(directionLabel)]
    .filter(Boolean)
    .join(" · ");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={label}>
          <ListFilterIcon size={16} />
          {t(options[value])}
          {showDirection && <DirectionIcon size={14} className="text-primary" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>{t("sort.label")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} aria-label={t("sort.label")}>
          {(Object.entries(options) as [T, TranslationKey][]).map(([key, phrase]) => {
            const active = key === value && showDirection;
            return (
              <DropdownMenuRadioItem
                key={key}
                value={key}
                aria-label={active ? `${t(phrase)} · ${t(directionLabel)}` : undefined}
                indicator={key === manual ? undefined : <DirectionIcon size={17} />}
                onSelect={(event) => {
                  if (key !== manual) event.preventDefault();
                  onChange(key);
                }}
              >
                {t(phrase)}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
