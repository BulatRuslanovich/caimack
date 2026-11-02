// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { ItemIndicator, RadioGroup, RadioItem } from "@radix-ui/react-dropdown-menu";
import { ArchiveIcon, CheckIcon, LayoutGridIcon, SlidersHorizontalIcon } from "lucide-react";
import { useT } from "@/contexts/I18nContext";
import {
  LIBRARY_DENSITIES,
  setLibraryDensity,
  useLibraryDensity,
  type LibraryDensity,
} from "@/lib/libraryDensity";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export interface LibraryViewLayout {
  value: "grid" | "crate";
  onChange: (value: "grid" | "crate") => void;
}

const itemClass =
  "relative flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md py-2 pr-9 pl-3 text-sm outline-none select-none focus:bg-accent data-[state=checked]:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-45";

function Selected() {
  return (
    <ItemIndicator className="absolute right-3 text-primary">
      <CheckIcon size={16} />
    </ItemIndicator>
  );
}

export function LibraryViewMenu({ layout }: { layout?: LibraryViewLayout }) {
  const t = useT();
  const density = useLibraryDensity();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="library-view-trigger h-11 gap-2 px-3.5 md:h-10 max-md:size-11 max-md:p-0"
          aria-label={t("view.label")}
          title={t("view.label")}
        >
          <SlidersHorizontalIcon size={16} />
          <span className="max-md:sr-only">{t("view.label")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60" collisionPadding={12} aria-label={t("view.label")}>
        {layout && (
          <>
            <DropdownMenuLabel>{t("view.layout")}</DropdownMenuLabel>
            <RadioGroup
              value={layout.value}
              onValueChange={(value) => layout.onChange(value as LibraryViewLayout["value"])}
              aria-label={t("view.layout")}
            >
              <RadioItem
                value="grid"
                className={itemClass}
                onSelect={(event) => event.preventDefault()}
              >
                <LayoutGridIcon size={16} className="text-muted-foreground" />
                {t("view.grid")}
                <Selected />
              </RadioItem>
              <RadioItem
                value="crate"
                className={itemClass}
                onSelect={(event) => event.preventDefault()}
              >
                <ArchiveIcon size={16} className="text-muted-foreground" />
                {t("view.crate")}
                <Selected />
              </RadioItem>
            </RadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel>{t("library.density")}</DropdownMenuLabel>
        <RadioGroup
          value={density}
          onValueChange={(value) => setLibraryDensity(value as LibraryDensity)}
          aria-label={t("library.density")}
        >
          {LIBRARY_DENSITIES.map((value) => (
            <RadioItem
              key={value}
              value={value}
              disabled={layout?.value === "crate"}
              className={itemClass}
              onSelect={(event) => event.preventDefault()}
            >
              {t(`library.density.${value}`)}
              <Selected />
            </RadioItem>
          ))}
        </RadioGroup>
        {layout?.value === "crate" && (
          <p className="px-3 py-2 text-xs text-muted-foreground">{t("view.densityGridOnly")}</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
