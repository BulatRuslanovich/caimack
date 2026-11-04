// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

export function scrollContentToTop(): void {
  const content = document.querySelector<HTMLElement>("main");
  (content ?? document.scrollingElement ?? document.documentElement).scrollTo({ top: 0 });
}

export function smoothUnlessReduced(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}
