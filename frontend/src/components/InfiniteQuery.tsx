// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useT } from "@/contexts/I18nContext";
import type { Paged } from "@/lib/types";
import type { UseInfiniteQueryResult } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { EmptyState } from "./EmptyState";
import { Loading } from "./Loading";
import { LoadError } from "./Query";

export function InfiniteQuery<T>({
  result,
  empty,
  skeleton,
  children,
}: {
  result: UseInfiniteQueryResult<{ pages: Paged<T>[] }>;
  empty?: { icon?: ReactNode; title: string; description?: string };
  skeleton?: ReactNode;
  children: (items: T[]) => ReactNode;
}) {
  const t = useT();
  const { data, error, isPending, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } =
    result;
  const items = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);

  if (error && data === undefined) {
    return (
      <LoadError
        message={error instanceof Error ? error.message : t("error.load")}
        onRetry={() => void refetch()}
      />
    );
  }

  if (isPending) return skeleton ?? <Loading />;
  if (data === undefined) return null;

  const total = data.pages[0]?.total ?? items.length;

  if (empty && total === 0) {
    return <EmptyState icon={empty.icon} title={empty.title} description={empty.description} />;
  }

  return (
    <>
      {children(items)}

      {hasNextPage && <LoadMore busy={isFetchingNextPage} onReach={() => void fetchNextPage()} />}
    </>
  );
}

function LoadMore({ busy, onReach }: { busy: boolean; onReach: () => void }) {
  const t = useT();
  const sentinel = useRef<HTMLDivElement>(null);

  const latest = useRef({ busy, onReach });

  useEffect(() => {
    latest.current = { busy, onReach };
  });

  useEffect(() => {
    const element = sentinel.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !latest.current.busy) latest.current.onReach();
      },
      { rootMargin: "600px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={sentinel} className="flex justify-center pt-2 pb-6">
      <button
        type="button"
        onClick={onReach}
        disabled={busy}
        className="rounded-full px-4 py-2 text-sm font-medium text-muted-foreground transition-colors duration-150 ease-brand hover:text-foreground disabled:opacity-60"
      >
        {busy ? <Loading size="s" /> : t("pagination.loadMore")}
      </button>
    </div>
  );
}
