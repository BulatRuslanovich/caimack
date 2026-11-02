// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { Rows3Icon } from "lucide-react";
import { useT } from "@/contexts/I18nContext";
import {
  LIBRARY_DENSITIES,
  setLibraryDensity,
  useLibraryDensity,
  type LibraryDensity,
} from "@/lib/libraryDensity";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export function LibraryDensityMenu() {
  const t = useT();
  const density = useLibraryDensity();
  return (
    <Select value={density} onValueChange={(value) => setLibraryDensity(value as LibraryDensity)}>
      <SelectTrigger aria-label={t("library.density")}>
        <Rows3Icon size={16} className="text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LIBRARY_DENSITIES.map((value) => (
          <SelectItem key={value} value={value}>
            {t(`library.density.${value}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
