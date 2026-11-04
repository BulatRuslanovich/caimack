// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { createElement } from "react";
import type { LucideProps } from "lucide-react";
import { moodIcon } from "@/lib/moods";

export function MoodIcon({ mood, ...props }: { mood: string } & LucideProps) {
  return createElement(moodIcon(mood), props);
}
