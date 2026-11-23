// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { MusicIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";

export function ProviderArtwork({ url, className }: { url?: string | null; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  return (
    <span
      aria-hidden
      className={cn("grid place-items-center overflow-hidden bg-raised text-faint", className)}
    >
      {url && url !== failedUrl ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(url)}
          className="size-full object-cover"
        />
      ) : (
        <MusicIcon size={19} />
      )}
    </span>
  );
}

export function ImportProgress({
  value,
  total,
  label,
}: {
  value: number;
  total: number;
  label: string;
}) {
  return (
    <progress
      aria-label={label}
      max={total}
      value={value}
      className="block h-1.5 w-full overflow-hidden rounded-full bg-border [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-border [&::-webkit-progress-value]:bg-primary"
    />
  );
}
