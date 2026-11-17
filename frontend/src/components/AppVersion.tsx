// SPDX-License-Identifier: AGPL-3.0-only

import { cn } from "@/lib/cn";

export function AppVersion({ className }: { className?: string }) {
  return (
    <p className={cn("text-center text-2xs text-faint tabular-nums", className)}>
      v{process.env.APP_VERSION}
    </p>
  );
}
