// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useEffect } from "react";
import { recordEvent, type PlaybackEventType } from "@/lib/events";

type OpenedEvent = Extract<PlaybackEventType, "artistOpened" | "albumOpened">;

export function useEntityOpened(type: OpenedEvent, entityId: string | undefined) {
  useEffect(() => {
    if (!entityId) return;

    recordEvent({ type, entityId });
  }, [type, entityId]);
}
