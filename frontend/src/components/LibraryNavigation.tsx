// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useT } from "@/contexts/I18nContext";
import { cn } from "@/lib/cn";
import { catalogNav } from "@/lib/navigation";
import { navigationPrefetch } from "@/lib/queries";
import { useLibraryNavigation } from "@/contexts/LibraryNavigationContext";

/** Routes are the scope state, so Back restores the catalog after opening music. */
export function LibraryNavigation({ saved = false }: { saved?: boolean }) {
  const t = useT();
  const pathname = usePathname();
  const navigate = useLibraryNavigation();
  const client = useQueryClient();
  const warm = (href: string) => void navigationPrefetch[href]?.(client);
  useEffect(() => {
    // Warm first pages after the current view can render. Keep this in the
    // browser cache instead of revalidating an authenticated route on hover.
    // QueryClient deduplicates these reads with hover, focus and mounted views.
    const timer = window.setTimeout(() => {
      for (const { href } of catalogNav) {
        void navigationPrefetch[href]?.(client);
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [client]);
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
            prefetch={false}
            onNavigate={
              navigate
                ? (event) => {
                    event.preventDefault();
                    navigate(href);
                  }
                : undefined
            }
            onPointerEnter={() => warm(href)}
            onFocus={() => warm(href)}
            onTouchStart={() => warm(href)}
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
              prefetch={false}
              onNavigate={
                navigate
                  ? (event) => {
                      event.preventDefault();
                      navigate(href);
                    }
                  : undefined
              }
              onPointerEnter={() => warm(href)}
              onFocus={() => warm(href)}
              onTouchStart={() => warm(href)}
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
