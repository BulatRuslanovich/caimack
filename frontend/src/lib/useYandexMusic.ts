// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useSyncExternalStore } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { subscribeYandexMusic, yandexMusicEnabled, yandexMusicToken } from "@/lib/yandexMusic";

function hasToken(): boolean {
  return yandexMusicToken() !== null;
}

export function useYandexMusicSettings(): { enabled: boolean; hasToken: boolean } {
  const enabled = useSyncExternalStore(subscribeYandexMusic, yandexMusicEnabled, () => false);
  const token = useSyncExternalStore(subscribeYandexMusic, hasToken, () => false);
  return { enabled, hasToken: token };
}

export function useYandexMusic(): boolean {
  const { isAdmin } = useAuth();
  const settings = useYandexMusicSettings();
  return isAdmin && settings.enabled && settings.hasToken;
}
