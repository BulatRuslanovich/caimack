// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo, useState } from "react";
import { advanceIn } from "./playerQueue";
import type { PlayerActions, PlayerState } from "./playerTypes";

export type ArtworkDirection = "next" | "previous";

export function queueArtworkDirection(
  previousId: string | null,
  state: Pick<PlayerState, "queue" | "queueOrder" | "currentIndex" | "repeat">,
): ArtworkDirection {
  const before = state.queueOrder.indexOf(
    state.queue.findIndex((track) => track.id === previousId),
  );
  const after = state.queueOrder.indexOf(state.currentIndex);
  if (before < 0 || after < 0) return "next";
  if (state.repeat === "all" && before === state.queueOrder.length - 1 && after === 0)
    return "next";
  return after < before ? "previous" : "next";
}

export function useArtworkNavigation(
  state: PlayerState,
  actions: PlayerActions,
  getPosition: () => number,
) {
  const trackId = state.currentTrack?.id ?? null;
  const [pending, setPending] = useState<{
    from: string | null;
    to: string;
    direction: ArtworkDirection;
  } | null>(null);
  const [transition, setTransition] = useState({
    trackId,
    direction: "next" as ArtworkDirection,
  });

  if (transition.trackId !== trackId) {
    const direction =
      pending?.from === transition.trackId && pending?.to === trackId
        ? pending.direction
        : queueArtworkDirection(transition.trackId, state);
    setTransition({ trackId, direction });
    if (pending) setPending(null);
  }

  const navigationActions = useMemo(() => {
    const navigate = (direction: 1 | -1) => {
      const step = advanceIn(
        state.queueOrder,
        state.currentIndex,
        direction,
        state.repeat === "all",
      );
      const target = step.kind === "play" ? state.queue[step.index] : null;
      if (target && (direction === 1 || getPosition() <= 3)) {
        setPending({
          from: trackId,
          to: target.id,
          direction: direction === 1 ? "next" : "previous",
        });
      }
      if (direction === 1) actions.next();
      else actions.previous();
    };
    return { ...actions, next: () => navigate(1), previous: () => navigate(-1) };
  }, [
    actions,
    state.queue,
    state.queueOrder,
    state.currentIndex,
    state.repeat,
    trackId,
    getPosition,
  ]);

  return { actions: navigationActions, direction: transition.direction };
}
