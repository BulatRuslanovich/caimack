// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import * as RadioGroup from "@radix-ui/react-radio-group";
import { cn } from "@/lib/cn";

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-5 rounded-lg bg-card p-5 max-md:p-4">
      <h2 className="sr-only">{title}</h2>
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

  return (
    <fieldset className="flex flex-col gap-2 border-0 p-0">
      <legend className="font-semibold">{legend}</legend>
      <RadioGroup.Root
        className={cn(
          "mt-1 gap-2",
          previews
            ? "grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]"
            : "grid auto-cols-fr grid-flow-col md:flex md:flex-wrap md:[&>*]:min-w-24",
        )}
        value={value}
        onValueChange={(next) => onChange(next as T)}
      >
        {options.map((option) => (
          <RadioGroup.Item
            key={option.value}
            value={option.value}
            className={cn(
              "flex cursor-pointer flex-col items-start gap-0.5 rounded-md border border-border text-left transition-colors outline-none",
              previews ? "p-3" : "px-4 py-2.5",
              "hover:bg-raised focus-visible:ring-2 focus-visible:ring-ring/40",
              "data-[state=checked]:border-primary data-[state=checked]:bg-primary-soft",
            )}
          >
            {option.preview}
            <span className="font-medium">{option.label}</span>
            {option.hint && <span className="text-xs text-muted-foreground">{option.hint}</span>}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </fieldset>
  );
}
