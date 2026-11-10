// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich
"use client";

import dynamic from "next/dynamic";

let pending: Promise<typeof import("./FullScreenPlayer")> | undefined;
export const loadFullPlayer = () =>
  (pending ??= import("./FullScreenPlayer").catch((error) => {
    pending = undefined;
    throw error;
  }));
export const preloadFullPlayer = () => void loadFullPlayer().catch(() => undefined);
export const DeferredFullPlayer = dynamic(() => loadFullPlayer().then((m) => m.FullScreenPlayer), {
  ssr: false,
});
