// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { isActivePath, libraryTabs, mobileNav, serviceNav } from "@/lib/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useUpload } from "@/contexts/UploadContext";
import { useT } from "@/contexts/I18nContext";
import { BrandMark, BrandWordmark } from "./Brand";
import { Pin } from "./Pin";
import { AccountRow, NavLink } from "./Sidebar";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";

const tabClass =
  "flex min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 text-2xs hover:no-underline";

const chipClass =
  "shrink-0 border-b-2 border-transparent pt-1 pb-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground hover:no-underline";

function inLibrary(pathname: string): boolean {
  return libraryTabs.some((entry) => isActivePath(pathname, entry.href));
}

export function MobileHeader() {
  const t = useT();
  const { user, isAdmin } = useAuth();
  const { progress } = useUpload();
  const [accountOpen, setAccountOpen] = useState(false);

  return (
    <header
      className="hidden items-center justify-between border-b border-border px-4 [grid-area:mobile-header] max-md:flex"
      style={{
        minHeight: "calc(3.5rem + env(safe-area-inset-top))",
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      <Link
        href="/"
        aria-label={t("nav.home")}
        className="flex items-center gap-2 hover:no-underline"
      >
        <Pin>
          <BrandMark className="size-7" />
        </Pin>
        <BrandWordmark />
      </Link>

      <button
        type="button"
        onClick={() => setAccountOpen(true)}
        aria-label={t("nav.account")}
        aria-expanded={accountOpen}
        className="relative grid size-11 place-items-center rounded-full"
      >
        <span className="grid size-8 place-items-center rounded-full bg-raised text-xs font-semibold uppercase">
          {user?.username.slice(0, 1)}
        </span>
        {progress !== null && (
          <span
            aria-hidden="true"
            className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary"
          />
        )}
      </button>

      <Sheet open={accountOpen} onOpenChange={setAccountOpen}>
        <SheetContent>
          <SheetTitle className="sr-only">{t("nav.account")}</SheetTitle>

          <nav aria-label={t("nav.account")} className="flex flex-col gap-0.5">
            {serviceNav(isAdmin).map((entry) => (
              <NavLink key={entry.href} entry={entry} onNavigate={() => setAccountOpen(false)} />
            ))}
          </nav>

          <div className="mt-3 pt-3">
            <AccountRow />
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}

export function LibraryChips() {
  const t = useT();
  const pathname = usePathname();

  const strip = useRef<HTMLElement>(null);

  useEffect(() => {
    const active = strip.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!strip.current || !active) return;

    const offset = active.getBoundingClientRect().left - strip.current.getBoundingClientRect().left;
    strip.current.scrollLeft += offset - (strip.current.clientWidth - active.offsetWidth) / 2;
  }, [pathname]);

  if (!inLibrary(pathname)) return null;

  return (
    <nav
      ref={strip}
      aria-label={t("nav.mediaLibrary")}
      className="-mx-4 -mb-3 hidden gap-5 overflow-x-auto px-4 shadow-[inset_0_-1px_0_var(--border)] [scrollbar-width:none] max-md:flex [&::-webkit-scrollbar]:hidden"
    >
      {libraryTabs.map((entry) => {
        const active = isActivePath(pathname, entry.href);

        return (
          <Link
            key={entry.href}
            href={entry.href}
            aria-current={active ? "page" : undefined}
            className={cn(chipClass, active && "border-primary text-foreground")}
          >
            {t(entry.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileNav() {
  const t = useT();
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("nav.main")}
      className="hidden auto-cols-fr grid-flow-col border-t border-border bg-card [grid-area:nav] max-md:grid"
      style={{
        height: "calc(var(--mobile-nav-height) + env(safe-area-inset-bottom))",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {mobileNav.map(({ href, labelKey, icon: Icon }) => {
        const active = href === "/playlists" ? inLibrary(pathname) : isActivePath(pathname, href);

        return (
          <Link
            key={labelKey}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              tabClass,
              active ? "font-semibold text-foreground [&>svg]:text-primary" : "text-faint",
            )}
          >
            <Icon />
            <span className="max-w-full truncate">{t(labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
