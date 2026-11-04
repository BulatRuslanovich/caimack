// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { Slot } from "@radix-ui/react-slot";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

const variants = {
  outline: "border border-control-border text-foreground hover:border-foreground",
  primary: "bg-action font-semibold text-action-foreground hover:bg-action-hover",
  secondary: "bg-raised text-foreground hover:bg-accent",
  ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
  text: "text-muted-foreground hover:text-foreground hover:underline",
  destructive: "border border-destructive/60 text-destructive hover:bg-destructive/10",
  play: "bg-action text-action-foreground hover:bg-action-hover active:scale-95",
};

const sizes = {
  sm: "h-8 rounded-full px-3.5 text-xs",
  md: "h-10 rounded-full px-5 text-sm",
  lg: "h-12 rounded-full px-6 text-sm",
  icon: "size-9 rounded-full max-md:size-10 pointer-coarse:size-11",
  "icon-sm": "size-7 rounded-full",
  "icon-lg": "size-11 rounded-full",
  auto: "",
  play: "size-13 rounded-full",
  "play-lg": "size-16 rounded-full",
};

export function Button({
  className,
  variant = "outline",
  size = "md",
  asChild,
  type,
  ...props
}: ComponentProps<"button"> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  asChild?: boolean;
}) {
  const Component = asChild ? Slot : "button";

  return (
    <Component
      type={asChild ? undefined : (type ?? "button")}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap transition-[background-color,border-color,color,opacity,scale] duration-150 ease-brand outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 motion-reduce:active:scale-100 [&_svg]:shrink-0",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
