// SPDX-License-Identifier: AGPL-3.0-only
import { closestCenter, pointerWithin, type CollisionDetection } from "@dnd-kit/core";

/** The cursor/finger chooses the destination even when the artwork is grabbed off-centre. */
export const libraryCollisionDetection: CollisionDetection = (args) =>
  args.pointerCoordinates
    ? pointerWithin({
        ...args,
        droppableContainers: args.droppableContainers.filter(
          (entry) => entry.id !== args.active.id,
        ),
      })
    : closestCenter(args);

export function folderDropPosition(
  rect: { left: number; top: number; width: number; height: number },
  pointer: { x: number; y: number } | null,
) {
  const point = pointer ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  if (
    point.x < rect.left ||
    point.x > rect.left + rect.width ||
    point.y < rect.top ||
    point.y > rect.top + rect.height
  )
    return null;
  // The artwork and label both accept drops. Only thin top/bottom strips reorder.
  const edge = Math.min(12, rect.height * 0.2);
  if (point.y <= rect.top + edge) return "before";
  if (point.y >= rect.top + rect.height - edge) return "after";
  return "inside";
}
