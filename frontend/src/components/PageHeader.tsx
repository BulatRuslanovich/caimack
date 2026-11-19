// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useT } from "@/contexts/I18nContext";
import { cn } from "@/lib/cn";
import { ChevronRightIcon } from "lucide-react";
import type { Route } from "next";
import { PrefetchLink as Link } from "@/components/PrefetchLink";
import { Children, useMemo, type ReactNode, type Ref } from "react";
import { VirtualCardGrid } from "./VirtualCardGrid";
import { VirtualList } from "./VirtualList";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-5 max-md:items-start">
      <div className="min-w-0">
        {title && <h1 className="font-display text-title">{title}</h1>}
        {subtitle && (
          <p className={cn("text-sm text-muted-foreground", title && "mt-2")}>{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}

export function SectionHeader<T extends string, U extends string>({
  title,
  titleHref,
  note,
  href,
  actions,
}: {
  title: string;
  titleHref?: Route<U>;
  note?: string;
  href?: Route<T>;
  actions?: ReactNode;
}) {
  const t = useT();

  return (
    <div className="section-heading flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="line-clamp-2 font-sans text-heading font-semibold">
          {titleHref ? <Link href={titleHref}>{title}</Link> : title}
        </h2>
        {note && <p className="truncate text-sm text-muted-foreground">{note}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {actions}
        {href && (
          <Link
            href={href}
            className="flex items-center gap-0.5 text-sm text-muted-foreground transition-colors duration-150 ease-brand hover:text-foreground hover:no-underline"
          >
            {t("action.seeAll")}
            <ChevronRightIcon size={16} />
          </Link>
        )}
      </div>
    </div>
  );
}

export function Section<T extends string, U extends string>({
  title,
  titleHref,
  note,
  href,
  actions,
  className,
  ref,
  children,
}: {
  title?: string;
  titleHref?: Route<U>;
  note?: string;
  href?: Route<T>;
  actions?: ReactNode;
  className?: string;
  ref?: Ref<HTMLElement>;
  children: ReactNode;
}) {
  return (
    <section ref={ref} className={cn("group/section flex flex-col gap-4", className)}>
      {title && (
        <SectionHeader
          title={title}
          titleHref={titleHref}
          note={note}
          href={href}
          actions={actions}
        />
      )}
      {children}
    </section>
  );
}

const cardGrid = "library-card-grid";

export function CardGrid({
  children,
  className,
  layout = "grid",
  pinned = [],
}: {
  children: ReactNode;
  className?: string;
  layout?: "grid" | "list";
  pinned?: number[];
}) {
  const items = useMemo(() => Children.toArray(children), [children]);
  const grid = (
    <div className={cn(layout === "grid" ? cardGrid : "space-y-1", className)}>{children}</div>
  );
  if (items.length > 100)
    return layout === "grid" ? (
      <VirtualCardGrid items={items} className={className} pinned={pinned} />
    ) : (
      <VirtualList items={items} estimate={86} gap={4} pinned={pinned} />
    );
  return grid;
}

const SKELETON_CARDS = 12;

export function CardGridSkeleton({ round = false }: { round?: boolean }) {
  const t = useT();

  return (
    <div role="status" aria-label={t("common.loading")} className={cardGrid}>
      {Array.from({ length: SKELETON_CARDS }, (_, card) => (
        <div key={card} className={cn("flex flex-col gap-2", round && "items-center")}>
          <span
            className={cn(
              "mb-2 aspect-square w-full animate-pulse rounded-xs bg-raised",
              round && "rounded-full",
            )}
          />
          <span className="h-3 w-3/4 animate-pulse rounded-sm bg-raised" />
          <span className="h-3 w-1/2 animate-pulse rounded-sm bg-raised" />
        </div>
      ))}
    </div>
  );
}
