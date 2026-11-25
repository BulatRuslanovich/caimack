// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useId, useState, type ReactNode } from "react";
import { SlidersHorizontalIcon } from "lucide-react";
import { cn } from "@/lib/cn";
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
  mobileFilters,
  children,
}: {
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  mobileFilters?: { active: boolean };
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
      {children && <ToolbarFilters mobileFilters={mobileFilters}>{children}</ToolbarFilters>}
    </div>
  );
}

export function ToolbarFilters({
  mobileFilters,
  children,
  compact = false,
}: {
  mobileFilters?: { active: boolean };
  children: ReactNode;
  compact?: boolean;
}) {
  const t = useT();
  const controlsId = useId();
  const [filtersOpen, setFiltersOpen] = useState(false);

  return (
    <>
      {mobileFilters && (
        <Button
          size={compact ? "icon" : "icon-lg"}
          className="shrink-0 md:hidden min-[24rem]:w-auto min-[24rem]:px-3 min-[24rem]:pointer-coarse:w-auto"
          data-active={mobileFilters.active}
          aria-expanded={filtersOpen}
          aria-controls={controlsId}
          title={t("filter.options")}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <SlidersHorizontalIcon size={18} />
          <span className="max-[24rem]:sr-only">{t("filter.options")}</span>
        </Button>
      )}
      <div
        id={mobileFilters ? controlsId : undefined}
        className={cn(
          "flex flex-wrap items-center gap-2.5 max-md:order-2 max-md:w-full max-md:gap-2",
          mobileFilters && !filtersOpen && "max-md:hidden",
        )}
      >
        {children}
      </div>
    </>
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
  scrollOnChange = scrollContentToTop,
}: {
  result: Paged<unknown>;
  onChange: (page: number) => void;
  scrollOnChange?: () => void;
}) {
  const t = useT();
  const { page, totalPages } = result;

  if (totalPages <= 1) return null;

  const goTo = (next: number) => {
    onChange(next);
    scrollOnChange();
  };

  return (
    <nav className="flex items-center justify-center gap-3 pt-2" aria-label={t("pagination.label")}>
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => goTo(page - 1)}>
        {t("pagination.previous")}
      </Button>
      <span className="text-sm text-muted-foreground tabular-nums">
        {t("pagination.pageOf", { page, totalPages })}
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => goTo(page + 1)}
      >
        {t("pagination.next")}
      </Button>
    </nav>
  );
}
