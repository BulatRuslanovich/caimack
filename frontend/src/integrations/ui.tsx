// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { BanIcon, CheckIcon, LoaderCircleIcon, MusicIcon, type LucideIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";

export function ProviderSettings({
  title,
  description,
  enabled,
  onChange,
  children,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-title`}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <label id={`${id}-title`} htmlFor={id} className="cursor-pointer font-semibold">
            {title}
          </label>
          <p id={`${id}-hint`} className="mt-0.5 text-sm text-muted-foreground">
            {description}
          </p>
        </div>
        <Switch
          id={id}
          checked={enabled}
          onCheckedChange={onChange}
          aria-describedby={`${id}-hint`}
        />
      </div>
      {enabled && (
        <div className="mt-4 rounded-lg border border-border bg-card/60 p-4">{children}</div>
      )}
    </section>
  );
}

export function ProviderAction({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="grid min-w-0 items-center gap-3 rounded-xl border border-border bg-card/70 p-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4 sm:px-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{description}</p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </section>
  );
}

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

export function ProviderTrack({
  title,
  artist,
  album,
  coverUrl,
  duration,
  action,
}: {
  title: string;
  artist: string;
  album?: string | null;
  coverUrl?: string | null;
  duration: number;
  action: ReactNode;
}) {
  return (
    <li className="flex min-h-14 items-center gap-2.5 rounded-lg py-1.5 text-sm hover:bg-card/70 focus-within:bg-card/70 sm:gap-3 sm:px-2">
      <ProviderArtwork url={coverUrl} className="size-10 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold" title={title}>
          {title}
        </p>
        <p className="truncate text-muted-foreground" title={artist}>
          {artist}
        </p>
        {album && <p className="truncate text-xs text-faint lg:hidden">{album}</p>}
      </div>
      {album && (
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground max-lg:hidden">
          {album}
        </span>
      )}
      <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums max-sm:hidden">
        {duration > 0 && formatDuration(duration)}
      </span>
      <div className="flex w-11 shrink-0 flex-col items-stretch sm:w-36">{action}</div>
    </li>
  );
}

export function ProviderImportButton({
  icon,
  label,
  name,
  state = "ready",
  disabled,
  compact,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  name?: string;
  state?: "ready" | "busy" | "done" | "unavailable";
  disabled?: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  const Icon =
    state === "busy"
      ? LoaderCircleIcon
      : state === "done"
        ? CheckIcon
        : state === "unavailable"
          ? BanIcon
          : icon;
  return (
    <Button
      variant={state === "ready" ? "outline" : "ghost"}
      size="sm"
      className={cn(
        "h-auto min-h-8 max-w-full py-1.5 whitespace-normal pointer-coarse:min-h-11",
        state !== "ready" && "disabled:opacity-100",
        state === "done" && "text-success",
        compact && "w-full max-sm:min-h-11 max-sm:px-0",
      )}
      disabled={disabled || state !== "ready"}
      onClick={onClick}
      title={compact ? label : undefined}
      aria-label={name ?? label}
      aria-busy={state === "busy"}
    >
      <Icon
        size={15}
        aria-hidden
        className={state === "busy" ? "motion-safe:animate-spin" : undefined}
      />
      <span className={compact ? "max-sm:sr-only" : undefined}>{label}</span>
    </Button>
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
