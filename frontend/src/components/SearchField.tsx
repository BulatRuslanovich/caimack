// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useT } from "@/contexts/I18nContext";
import { Button } from "./ui/button";
import { SearchIcon, XIcon } from "lucide-react";

const DEBOUNCE_MS = 300;

export function SearchField({
  value,
  onChange,
  placeholder,
  autoFocus = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const t = useT();
  const inputId = useId();

  const [input, setInput] = useState(value);
  const [sync, setSync] = useState({ seen: value, pending: [] as string[] });

  if (value !== sync.seen) {
    const echo = sync.pending.indexOf(value);
    setSync({ seen: value, pending: echo === -1 ? [] : sync.pending.slice(echo + 1) });
    if (echo === -1) setInput(value);
  }

  const committed = sync.pending.at(-1) ?? sync.seen;

  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  }, [onChange]);

  const commit = useCallback((next: string) => {
    setSync((current) => ({ ...current, pending: [...current.pending, next] }));
    latest.current(next);
  }, []);

  useEffect(() => {
    const trimmed = input.trim();
    if (trimmed === committed) return;

    const timer = window.setTimeout(() => commit(trimmed), DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [input, committed, commit]);

  const clear = () => {
    setInput("");
    commit("");
  };

  return (
    <div
      className={cn(
        "search-field flex max-w-xl items-center gap-2.5 rounded-lg border border-border bg-card px-3.5 text-muted-foreground transition-[background-color,border-color,box-shadow] duration-150",
        "hover:border-border-strong focus-within:border-ring focus-within:bg-raised focus-within:text-foreground focus-within:ring-2 focus-within:ring-ring/15",
        className,
      )}
    >
      <SearchIcon size={16} />
      <label htmlFor={inputId} className="sr-only">
        {placeholder}
      </label>
      <input
        id={inputId}
        type="search"
        placeholder={placeholder}
        value={input}
        autoComplete="off"
        autoFocus={autoFocus}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && input !== "") {
            event.preventDefault();
            clear();
          }
        }}
        className="w-full min-w-0 bg-transparent py-2.5 text-base text-foreground outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
      />
      {input !== "" && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="-mr-1.5"
          onClick={clear}
          aria-label={t("action.clear")}
        >
          <XIcon size={16} />
        </Button>
      )}
    </div>
  );
}
