"use client";

import { useId } from "react";

export function SettingHelp({ children, hint }: { children: React.ReactNode; hint: string }) {
  const id = useId();
  return (
    <span className="group/help relative inline-flex items-center gap-2">
      {children}
      <button
        type="button"
        aria-label={hint}
        aria-describedby={id}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        className="grid size-6 shrink-0 place-items-center rounded-full border border-border text-xs text-muted-foreground hover:text-foreground focus-visible:text-foreground"
      >
        ?
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-50 mb-2 hidden w-64 max-w-[75vw] rounded-md border border-border bg-popover p-3 text-sm font-normal text-popover-foreground shadow-pop group-hover/help:block group-focus-within/help:block"
      >
        {hint}
      </span>
    </span>
  );
}
