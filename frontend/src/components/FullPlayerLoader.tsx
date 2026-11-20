// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich
"use client";

import type { ComponentProps } from "react";

let pending: Promise<typeof import("./FullScreenPlayer")> | undefined;
let loaded: typeof import("./FullScreenPlayer") | undefined;
export const loadFullPlayer = () =>
  (pending ??= import("./FullScreenPlayer")
    .then((module) => {
      loaded = module;
      return module;
    })
    .catch((error) => {
      pending = undefined;
      throw error;
    }));
export const preloadFullPlayer = () => void loadFullPlayer().catch(() => undefined);
// Player awaits loadFullPlayer before opening the view transition. Re-wrapping
// that resolved module in React.lazy would suspend again inside its snapshot.
export function DeferredFullPlayer(
  props: ComponentProps<typeof import("./FullScreenPlayer").FullScreenPlayer>,
) {
  const Component = loaded?.FullScreenPlayer;
  return Component ? <Component {...props} /> : null;
}

export function DeferredAudiobookFullPlayer(
  props: ComponentProps<typeof import("./FullScreenPlayer").AudiobookFullScreenPlayer>,
) {
  const Component = loaded?.AudiobookFullScreenPlayer;
  return Component ? <Component {...props} /> : null;
}
