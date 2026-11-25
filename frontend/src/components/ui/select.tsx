// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Button } from "./button";

export const Select = SelectPrimitive.Root;
export function SelectValue(props: ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

export function SelectTrigger({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof SelectPrimitive.Trigger>, "asChild">) {
  return (
    <SelectPrimitive.Trigger asChild {...props}>
      <Button
        data-slot="select-trigger"
        className={cn(
          "group max-w-full min-w-0 justify-between data-[placeholder]:text-faint [&>[data-slot=select-value]]:truncate",
          className,
        )}
      >
        {children}
        <SelectPrimitive.Icon asChild>
          <ChevronDownIcon
            size={16}
            className="opacity-75 transition-transform duration-150 group-aria-expanded:rotate-180 motion-reduce:transition-none"
          />
        </SelectPrimitive.Icon>
      </Button>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={6}
        collisionPadding={12}
        data-slot="select-content"
        className={cn(
          "floating-panel relative z-110 max-h-(--radix-select-content-available-height) min-w-[8rem] overflow-hidden",
          "origin-(--radix-select-content-transform-origin)",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex justify-center py-1 text-muted-foreground">
          <ChevronUpIcon size={14} />
        </SelectPrimitive.ScrollUpButton>

        <SelectPrimitive.Viewport
          className={cn(position === "popper" && "w-full min-w-(--radix-select-trigger-width)")}
        >
          {children}
        </SelectPrimitive.Viewport>

        <SelectPrimitive.ScrollDownButton className="flex justify-center py-1 text-muted-foreground">
          <ChevronDownIcon size={14} />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "floating-item pr-9",
        "data-[disabled]:pointer-events-none data-[disabled]:text-faint",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2.5 text-primary">
        <CheckIcon size={16} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
