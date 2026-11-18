// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ComponentProps } from "react";
import type { Route } from "next";
import type { UrlObject } from "url";
import { prefetchRouteData } from "@/lib/queries";
import { useLibraryNavigation } from "@/contexts/LibraryNavigationContext";
import { isLibraryBrowsePath } from "@/lib/navigation";
import { cn } from "@/lib/cn";

/** Warm both the route code and its query data on intent, never every link in a list. */
export function PrefetchLink<T extends string>({
  onPointerEnter,
  onFocus,
  onTouchStart,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & { href: Route<T> | UrlObject }) {
  const [intent, setIntent] = useState(false);
  const client = useQueryClient();
  const workspace = useLibraryNavigation();
  const libraryHref =
    workspace && typeof props.href === "string" && isLibraryBrowsePath(props.href)
      ? props.href
      : null;
  const isPending = libraryHref !== null && workspace?.pendingHref === libraryHref;
  const warm = () => {
    if (
      typeof props.href !== "string" ||
      !props.href.startsWith("/") ||
      props.href.startsWith("//")
    )
      return;
    // `true` asks Next for the complete page. router.prefetch() defaults to a
    // partial loading boundary, which still makes the click wait for Flight.
    if (!libraryHref) setIntent(true);
    void prefetchRouteData(client, props.href);
  };
  return (
    <Link
      {...props}
      prefetch={!libraryHref && intent}
      onNavigate={
        props.onNavigate ??
        (workspace && libraryHref
          ? (event) => {
              event.preventDefault();
              void workspace.navigate(libraryHref);
            }
          : undefined)
      }
      aria-busy={isPending || props["aria-busy"]}
      className={isPending ? cn(props.className, "motion-safe:animate-pulse") : props.className}
      onPointerEnter={(event) => {
        warm();
        onPointerEnter?.(event);
      }}
      onFocus={(event) => {
        warm();
        onFocus?.(event);
      }}
      onTouchStart={(event) => {
        warm();
        onTouchStart?.(event);
      }}
    />
  );
}
