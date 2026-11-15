// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/contexts/I18nContext";
import { cn } from "@/lib/cn";
import { catalogNav } from "@/lib/navigation";

/** Routes are the scope state, so Back restores the catalog after opening music. */
export function LibraryNavigation({ saved = false }: { saved?: boolean }) {
  const t = useT();
  const pathname = usePathname();
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <nav
        aria-label={t("collection.scope")}
        className="flex w-fit max-w-full flex-wrap gap-1 rounded-2xl bg-card p-1"
      >
        {(
          [
            { href: "/library", label: t("collection.savedScope"), active: saved },
            { href: "/tracks", label: t("collection.catalog"), active: !saved },
          ] as const
        ).map(({ href, label, active }) => (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-xl px-4 py-2.5 text-sm font-medium hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              active ? "bg-raised text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>
      {!saved && (
        <nav
          aria-label={t("collection.types")}
          className="flex flex-wrap gap-x-6 gap-y-1 border-b border-border"
        >
          {catalogNav.map(({ href, labelKey }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className={cn(
                "border-b-2 py-2.5 text-sm font-medium hover:no-underline focus-visible:outline-2 focus-visible:outline-ring",
                pathname === href
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t(labelKey)}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
