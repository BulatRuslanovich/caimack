// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { ChevronRightIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/cn";
import { useT } from "@/contexts/I18nContext";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-5 max-md:items-start">
      <div className="min-w-0">
        <h1 className="font-display text-title">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
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
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="truncate font-display text-heading">
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

export function CardGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(cardGrid, className)}>{children}</div>;
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
              "mb-0.5 aspect-square w-full animate-pulse rounded-xs bg-raised",
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
