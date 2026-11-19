// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from "react";

export function CatalogToolbar({
  summary,
  actions,
  children,
}: {
  summary?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  if (!summary && !actions && !children) return null;

  return (
    <div className="search-catalog-toolbar flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
      {children}
      {summary && <p className="min-w-0 text-sm text-muted-foreground">{summary}</p>}
      {actions && <div className="ms-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}
