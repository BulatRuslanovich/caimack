// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useRecommendations } from "@/lib/useRecommendations";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOutIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { isActivePath, libraryNav, primaryNav, serviceNav, type NavEntry } from "@/lib/navigation";
import { navigationPrefetch } from "@/lib/queries";
import { useAuth } from "@/contexts/AuthContext";
import { useUpload } from "@/contexts/UploadContext";
import { useT } from "@/contexts/I18nContext";
import { BrandMark, BrandWordmark } from "./Brand";
import { Pin } from "./Pin";
import { Button } from "./ui/button";

export function NavLink({
  entry,
  onNavigate,
  compact = false,
}: {
  entry: NavEntry;
  onNavigate?: () => void;
  compact?: boolean;
}) {
  const t = useT();
  const client = useQueryClient();
  const active = isActivePath(usePathname(), entry.href);
  const Icon = entry.icon;

  const prefetch = () => void navigationPrefetch[entry.href]?.(client);

  return (
    <Link
      href={entry.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      onMouseEnter={prefetch}
      onFocus={prefetch}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors duration-150 ease-brand hover:bg-raised hover:text-foreground hover:no-underline",
        compact && "py-1.5 text-[0.8125rem] text-faint",
        active && "bg-raised text-foreground [&>svg]:text-primary",
      )}
    >
      <Icon size={compact ? 16 : undefined} />
      <span className="flex-1">{t(entry.labelKey)}</span>
      {entry.href === "/upload" && <UploadBadge />}
    </Link>
  );
}

function UploadBadge() {
  const t = useT();
  const { progress } = useUpload();

  if (progress === null) return null;

  return (
    <span
      role="status"
      aria-label={t("upload.uploading", { progress: progress.percent })}
      className="rounded-full bg-primary px-1.5 py-0.5 text-2xs font-semibold text-primary-foreground tabular-nums"
    >
      {progress.percent}%
    </span>
  );
}

export function AccountRow() {
  const t = useT();
  const { user, signOut } = useAuth();
  const signingOut = useMutation({ mutationFn: signOut });

  if (!user) return null;

  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-full bg-raised text-xs font-semibold uppercase"
      >
        {user.username.slice(0, 1)}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium" title={user.username}>
        {user.username}
      </span>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => signingOut.mutate()}
        disabled={signingOut.isPending}
        aria-label={t("nav.signOut")}
        title={t("nav.signOut")}
      >
        <LogOutIcon size={16} />
      </Button>
    </div>
  );
}

function NavGroup({
  label,
  entries,
  compact = false,
  className,
}: {
  label?: string;
  entries: NavEntry[];
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", compact && "gap-0", className)}>
      {label && <p className="px-3 pb-1.5 text-xs text-faint">{label}</p>}
      {entries.map((entry) => (
        <NavLink key={entry.href} entry={entry} compact={compact} />
      ))}
    </div>
  );
}

export function Sidebar() {
  const recommendations = useRecommendations();

  const t = useT();
  const { isAdmin } = useAuth();

  return (
    <aside
      className={cn(
        "app-sidebar flex flex-col gap-6 overflow-y-auto px-3 pt-5 pb-4 [grid-area:sidebar] max-md:hidden",
        "[@media(max-height:52rem)]:gap-4 [@media(max-height:52rem)]:pt-4 [@media(max-height:52rem)]:pb-3",
      )}
    >
      <Link
        href="/"
        aria-label={t("nav.home")}
        className="flex items-center gap-2.5 px-3 hover:no-underline"
      >
        <Pin>
          <BrandMark className="size-7" />
        </Pin>
        <BrandWordmark />
      </Link>

      <nav
        aria-label={t("nav.main")}
        className="flex flex-1 flex-col gap-6 [@media(max-height:52rem)]:gap-3"
      >
        <NavGroup entries={primaryNav} />
        <NavGroup
          label={t("nav.library")}
          entries={libraryNav.filter((entry) => entry.href !== "/map" || recommendations)}
        />
        <div className="mt-auto flex flex-col gap-1">
          <NavGroup entries={serviceNav(isAdmin)} compact />
        </div>
      </nav>

      <div className="border-t border-border px-1 pt-3">
        <AccountRow />
      </div>
    </aside>
  );
}
