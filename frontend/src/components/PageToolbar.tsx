// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import type { ReactNode } from "react";
import { scrollContentToTop } from "@/lib/scroll";
import type { Paged } from "@/lib/types";
import type { TranslationKey } from "@/lib/i18n";
import { useT } from "@/contexts/I18nContext";
import { SearchField } from "./SearchField";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export function PageToolbar({
  search,
  onSearch,
  placeholder,
  autoFocus = false,
  children,
}: {
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="library-toolbar flex flex-wrap items-center gap-2.5 max-md:gap-2">
      <SearchField
        value={search}
        onChange={onSearch}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="min-w-0 flex-[1_1_16rem] max-md:flex-1 max-md:basis-0"
      />
      {children && (
        <div className="flex flex-wrap items-center gap-2.5 max-md:order-2 max-md:w-full max-md:gap-2">
          {children}
        </div>
      )}
    </div>
  );
}

export function SortSelect<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Record<T, TranslationKey>;
  label?: string;
}) {
  const t = useT();

  return (
    <Select value={value} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger aria-label={label ?? t("sort.label")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.entries(options) as [T, TranslationKey][]).map(([key, phrase]) => (
          <SelectItem key={key} value={key}>
            {t(phrase)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function Pagination({
  result,
  onChange,
}: {
  result: Paged<unknown>;
  onChange: (page: number) => void;
}) {
  const t = useT();
  const { page, totalPages } = result;

  if (totalPages <= 1) return null;

  const goTo = (next: number) => {
    onChange(next);
    scrollContentToTop();
  };

  return (
    <nav className="flex items-center justify-center gap-3 pt-2" aria-label={t("pagination.label")}>
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => goTo(page - 1)}>
        {t("pagination.previous")}
      </Button>
      <span className="text-sm text-muted-foreground tabular-nums">
        {t("pagination.pageOf", { page, totalPages })}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => goTo(page + 1)}
      >
        {t("pagination.next")}
      </Button>
    </nav>
  );
}
