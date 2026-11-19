// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ComponentProps } from "react";
import type { Route } from "next";
import type { UrlObject } from "url";
import { prefetchRouteData } from "@/lib/queries";

/** Warm both the route code and its query data on intent, never every link in a list. */
export function PrefetchLink<T extends string>({
  onPointerEnter,
  onFocus,
  onTouchStart,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & { href: Route<T> | UrlObject }) {
  const [intent, setIntent] = useState(false);
  const client = useQueryClient();
  const warm = () => {
    if (
      typeof props.href !== "string" ||
      !props.href.startsWith("/") ||
      props.href.startsWith("//")
    )
      return;
    // `true` asks Next for the complete page. router.prefetch() defaults to a
    // partial loading boundary, which still makes the click wait for Flight.
    setIntent(true);
    void prefetchRouteData(client, props.href);
  };
  return (
    <Link
      {...props}
      prefetch={intent}
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
