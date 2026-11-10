// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { cn } from "@/lib/cn";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  restrictToFirstScrollableAncestor,
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { GripVerticalIcon } from "lucide-react";
import { useId, type ComponentProps, type ReactNode } from "react";

export function VerticalSortable({
  items,
  onDragEnd,
  onActiveChange,
  constrainToScroll = false,
  children,
}: {
  items: string[];
  onDragEnd: (event: DragEndEvent) => void;
  onActiveChange?: (id: string | null) => void;
  constrainToScroll?: boolean;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const id = useId();

  return (
    <DndContext
      id={id}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[
        restrictToVerticalAxis,
        constrainToScroll ? restrictToFirstScrollableAncestor : restrictToParentElement,
      ]}
      onDragStart={(event) => onActiveChange?.(String(event.active.id))}
      onDragCancel={() => onActiveChange?.(null)}
      onDragEnd={(event) => {
        onActiveChange?.(null);
        onDragEnd(event);
      }}
    >
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

export function DragHandle({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "cursor-grab text-faint opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing [@media(hover:none)]:opacity-100",
        className,
      )}
      {...props}
    >
      <GripVerticalIcon size={14} />
    </button>
  );
}
