// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useSyncExternalStore } from "react";
import { subscribeYandexMusic, yandexMusicEnabled, yandexMusicToken } from "./yandexMusic";

function hasToken(): boolean {
  return yandexMusicToken() !== null;
}

export function useYandexMusicSettings(): { enabled: boolean; hasToken: boolean } {
  const enabled = useSyncExternalStore(subscribeYandexMusic, yandexMusicEnabled, () => false);
  const token = useSyncExternalStore(subscribeYandexMusic, hasToken, () => false);
  return { enabled, hasToken: token };
}
