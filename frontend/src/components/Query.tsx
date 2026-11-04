// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useT } from "@/contexts/I18nContext";
import { Button } from "./ui/button";
import { EmptyState } from "./EmptyState";

export function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useT();

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-5 py-3"
    >
      <p className="flex-1">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t("action.tryAgain")}
        </Button>
      )}
    </div>
  );
}

const SKELETON_ROWS = 6;

interface EmptyCopy {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

function looksEmpty(data: unknown): boolean {
  if (Array.isArray(data)) return data.length === 0;

  if (data && typeof data === "object" && "items" in data) {
    const paged = data as { items: unknown[]; total?: number };
    return (paged.total ?? paged.items.length) === 0;
  }

  return false;
}

export function Query<T>({
  result,
  empty,
  isEmpty = looksEmpty,
  children,
}: {
  result: UseQueryResult<T>;
  empty?: EmptyCopy;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  const t = useT();
  const { data, error, isPending, isPlaceholderData, refetch } = result;

  if (error && data === undefined) {
    return (
      <LoadError
        message={error instanceof Error ? error.message : t("error.load")}
        onRetry={() => void refetch()}
      />
    );
  }

  if (isPending) {
    return (
      <div role="status" aria-label={t("common.loading")} className="flex flex-col gap-1">
        {Array.from({ length: SKELETON_ROWS }, (_, row) => (
          <div key={row} className="flex items-center gap-3 px-2.5 py-2">
            <span className="size-10 shrink-0 animate-pulse rounded-xs bg-raised" />
            <span className="flex flex-1 flex-col gap-2">
              <span className="h-3 w-2/5 animate-pulse rounded-sm bg-raised" />
              <span className="h-3 w-1/4 animate-pulse rounded-sm bg-raised" />
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (data === undefined) return null;

  if (empty && isEmpty(data)) {
    return (
      <EmptyState
        icon={empty.icon}
        title={empty.title}
        description={empty.description}
        action={empty.action}
      />
    );
  }

  if (isPlaceholderData) {
    return (
      <div
        aria-busy="true"
        className="contents [&>*]:opacity-85 [&>*]:transition-opacity [&>*]:duration-200 [&>*]:ease-brand"
      >
        {children(data)}
      </div>
    );
  }

  return <>{children(data)}</>;
}
