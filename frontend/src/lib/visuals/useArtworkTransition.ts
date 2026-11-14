// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useCallback, useMemo, useState, type AnimationEvent } from "react";
import {
  createArtworkTransition,
  finishArtwork,
  requestArtwork,
  type ArtworkRequest,
} from "./artworkTransition";

export function useArtworkTransition<T>(request: ArtworkRequest<T>) {
  const [state, setState] = useState(() => createArtworkTransition(request));
  const updated = requestArtwork(state, request);
  if (updated !== state) setState(updated);

  const { current: frame, previous, direction, revision } = state;
  const onAnimationEnd = useCallback(
    (event: AnimationEvent<HTMLElement>) => {
      if (event.target === event.currentTarget && event.animationName === "art-palette-enter")
        setState((current) => finishArtwork(current, revision));
    },
    [revision],
  );

  return useMemo(
    () => ({
      current: frame,
      previous,
      direction,
      revision,
      onAnimationEnd,
    }),
    [frame, previous, direction, revision, onAnimationEnd],
  );
}
