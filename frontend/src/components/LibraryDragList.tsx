// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  defaultAnimateLayoutChanges,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { canMoveFolder } from "@/lib/libraryFolders";
import { librarySortingStrategy } from "@/lib/librarySorting";
import { orderedKeys } from "@/lib/libraryOrder";
import { folderDropPosition, libraryCollisionDetection } from "@/lib/libraryDrop";
import type { LibraryFolder } from "@/lib/types";
import { useT } from "@/contexts/I18nContext";
import { CardGrid } from "./PageHeader";

export type LibraryDragEntry = { key: string; id: string; kind: string; node: ReactNode };

export function LibraryDragList({
  entries,
  folders,
  parent,
  grid,
  disabled,
  onOrder,
  onMove,
}: {
  entries: LibraryDragEntry[];
  folders: LibraryFolder[];
  parent?: string | null;
  grid: boolean;
  disabled: boolean;
  onOrder: (keys: string[]) => Promise<void>;
  onMove: (entry: LibraryDragEntry, folder: string | null) => Promise<void>;
}) {
  const t = useT();
  const [active, setActive] = useState<string | null>(null);
  const [pendingKeys, setPendingKeys] = useState<string[] | null>(null);
  const [landed, setLanded] = useState<string | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const [destination, setDestination] = useState<string | null>(null);
  const [movedIntoFolder, setMovedIntoFolder] = useState(false);
  const [edge, setEdge] = useState<{ key: string; after: boolean } | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 320, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const entryMap = useMemo(() => new Map(entries.map((entry) => [entry.key, entry])), [entries]);
  const keys = useMemo(() => {
    const visible = entries.map((entry) => entry.key);
    // Filters can change while an optimistic reorder is waiting for the server.
    return pendingKeys ? orderedKeys(visible, pendingKeys) : visible;
  }, [entries, pendingKeys]);
  const dragging = active ? entryMap.get(active) : undefined;
  const reset = () => {
    setActive(null);
    setDestination(null);
    setEdge(null);
  };
  const dropIntent = (event: DragOverEvent) => {
    const source = entryMap.get(String(event.active.id));
    const target = event.over ? entryMap.get(String(event.over.id)) : undefined;
    let folder: string | null = null;
    let nextEdge: { key: string; after: boolean } | null = null;
    const position = event.over ? folderDropPosition(event.over.rect, pointerRef.current) : null;
    if (target?.kind === "folder" && target.key !== source?.key && event.over) {
      if (position) nextEdge = { key: target.key, after: position === "after" };
    }
    if (source && !["favorites", "downloads"].includes(source.kind)) {
      if (event.over?.id === "up") folder = "up";
      else if (
        target?.kind === "folder" &&
        target.key !== source.key &&
        (source.kind !== "folder" || canMoveFolder(folders, source.id, target.id))
      ) {
        if (position === "inside") folder = target.key;
      }
    }
    if (folder) nextEdge = null;
    return { folder, edge: nextEdge };
  };
  const over = (event: DragOverEvent) => {
    const { folder, edge: nextEdge } = dropIntent(event);
    setEdge((old) =>
      old?.key === nextEdge?.key && old?.after === nextEdge?.after ? old : nextEdge,
    );
    setDestination(folder);
  };
  const content = keys.map((key) => {
    const entry = entryMap.get(key);
    return (
      entry && (
        <SortableEntry
          key={key}
          entry={entry}
          disabled={disabled || pendingKeys !== null}
          landed={landed === key}
          target={destination === key}
          edge={edge?.key === key ? (edge.after ? "after" : "before") : undefined}
        />
      )
    );
  });
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={(args) => {
        pointerRef.current = args.pointerCoordinates;
        return libraryCollisionDetection(args);
      }}
      onDragStart={({ active }) => {
        setLanded(null);
        setMovedIntoFolder(false);
        setActive(String(active.id));
      }}
      onDragOver={over}
      onDragMove={over}
      onDragCancel={reset}
      onDragEnd={(event) => {
        const { over } = event;
        const { folder, edge } = dropIntent(event);
        const settle = (order: string[], commit: () => Promise<void>) => {
          setLanded(dragging!.key);
          setPendingKeys(order);
          // Keep the landing position while the owner commits or rolls back its cache.
          void commit().then(
            () => setPendingKeys(null),
            () => setPendingKeys(null),
          );
        };
        if (dragging && over) {
          if (folder) {
            const target = entryMap.get(folder);
            if (folder === "up" || target) {
              setMovedIntoFolder(true);
              settle(
                keys.filter((key) => key !== dragging.key),
                () => onMove(dragging, folder === "up" ? (parent ?? null) : target!.id),
              );
            }
          } else {
            const from = keys.indexOf(dragging.key);
            const to = keys.indexOf(String(over.id));
            let order = from >= 0 && to >= 0 ? arrayMove(keys, from, to) : keys;
            if (edge) {
              const { key, after } = edge;
              order = keys.filter((key) => key !== dragging.key);
              const index = order.indexOf(key);
              if (index < 0) {
                reset();
                return;
              }
              order.splice(index + (after ? 1 : 0), 0, dragging.key);
            }
            if (order.some((key, i) => key !== entries[i]?.key))
              settle(order, () => onOrder(order));
          }
        }
        reset();
      }}
    >
      {active && parent !== undefined && (
        <ParentDrop
          active={destination === "up"}
          label={
            t("folders.moveHere") +
            " · " +
            (folders.find((folder) => folder.id === parent)?.name ?? t("nav.mediaLibrary"))
          }
        />
      )}
      <SortableContext items={keys} strategy={librarySortingStrategy(keys)}>
        <CardGrid
          layout={grid ? "grid" : "list"}
          pinned={[keys.indexOf(active ?? ""), keys.indexOf(landed ?? "")]}
        >
          {content}
        </CardGrid>
      </SortableContext>
      <DragOverlay
        dropAnimation={
          destination || movedIntoFolder
            ? null
            : { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" }
        }
      >
        {dragging && (
          <div className="library-drag-overlay pointer-events-none rounded-xl bg-primary-soft shadow-2xl ring-2 ring-primary ring-inset">
            {dragging.node}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function SortableEntry({
  entry,
  disabled,
  landed,
  target,
  edge,
}: {
  entry: LibraryDragEntry;
  disabled: boolean;
  landed: boolean;
  target: boolean;
  edge?: "before" | "after";
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: entry.key,
    disabled,
    animateLayoutChanges: (args) => !landed && defaultAnimateLayoutChanges(args),
  });
  const suppressClick = useRef(false);
  useEffect(() => {
    if (isDragging) suppressClick.current = true;
  }, [isDragging]);
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onMouseDown={(event) => {
        suppressClick.current = false;
        if (
          !(event.target as HTMLElement).closest("button[aria-label],input,select,[role=menuitem]")
        )
          listeners?.onMouseDown?.(event);
      }}
      onTouchStart={(event) => {
        suppressClick.current = false;
        if (
          !(event.target as HTMLElement).closest("button[aria-label],input,select,[role=menuitem]")
        )
          listeners?.onTouchStart?.(event);
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget) listeners?.onKeyDown?.(event);
      }}
      onClickCapture={(event) => {
        if (suppressClick.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }
      }}
      onDragStart={(event) => event.preventDefault()}
      onContextMenu={(event) => {
        if (!disabled) event.preventDefault();
      }}
      data-drop-edge={edge}
      className={`library-drag-item relative rounded-xl outline-offset-2 ${target ? "ring-2 ring-primary bg-primary-soft" : ""}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0 : 1,
        cursor: disabled ? undefined : isDragging ? "grabbing" : "grab",
        touchAction: "pan-y",
      }}
    >
      {entry.node}
    </div>
  );
}
function ParentDrop({ active, label }: { active: boolean; label: string }) {
  const { setNodeRef } = useDroppable({ id: "up" });
  return (
    <div
      ref={setNodeRef}
      className={`fixed top-4 left-1/2 z-40 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl border-2 border-dashed bg-background p-4 text-center shadow-lg ${active ? "border-primary bg-primary-soft text-primary" : "border-border"}`}
    >
      {label}
    </div>
  );
}
