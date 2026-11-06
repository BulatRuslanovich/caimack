// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import * as RadioGroup from "@radix-ui/react-radio-group";
import { useId } from "react";
import { cn } from "@/lib/cn";

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-panel">
      <h2 className="settings-section-title">{title}</h2>
      {children}
    </section>
  );
}

export function Choice<T extends string>({
  legend,
  value,
  onChange,
  options,
}: {
  legend: React.ReactNode;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; hint?: string; preview?: React.ReactNode }[];
}) {
  const previews = options.some((option) => option.preview);
  const legendId = useId();

  return (
    <div className="settings-choice" data-preview={previews}>
      <span id={legendId} className="font-medium">
        {legend}
      </span>
      <RadioGroup.Root
        aria-labelledby={legendId}
        data-preview={previews}
        className="settings-options gap-1"
        value={value}
        onValueChange={(next) => onChange(next as T)}
      >
        {options.map((option) => (
          <RadioGroup.Item
            key={option.value}
            value={option.value}
            className={cn(
              "settings-option flex cursor-pointer flex-col items-start gap-0.5 rounded-md border border-transparent text-left transition-colors outline-none",
              previews ? "p-3" : "px-4 py-2.5",
              "hover:bg-raised focus-visible:ring-2 focus-visible:ring-ring/40",
            )}
          >
            {option.preview}
            <span className="font-medium">{option.label}</span>
            {option.hint && <span className="text-xs text-muted-foreground">{option.hint}</span>}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </div>
  );
}
