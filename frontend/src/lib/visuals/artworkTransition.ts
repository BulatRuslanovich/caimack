// SPDX-License-Identifier: AGPL-3.0-only

import type { BackdropTone } from "@/lib/coverTone";
import type { ArtworkDirection } from "@/lib/playback/useArtworkNavigation";

export interface ArtworkRequest<T> {
  key: string;
  item: T;
  src: string | null;
  tone: BackdropTone | null | undefined;
  direction: ArtworkDirection;
}

export type ArtworkFrame<T> = Omit<ArtworkRequest<T>, "tone" | "direction"> & {
  tone: BackdropTone | null;
};

export interface ArtworkTransition<T> {
  current: ArtworkFrame<T>;
  previous: ArtworkFrame<T> | null;
  pending: (ArtworkFrame<T> & { direction: ArtworkDirection }) | null;
  requested: ArtworkRequest<T>;
  direction: ArtworkDirection;
  revision: number;
}

export function createArtworkTransition<T>(request: ArtworkRequest<T>): ArtworkTransition<T> {
  return {
    current: { ...request, tone: request.tone ?? null },
    previous: null,
    pending: null,
    requested: request,
    direction: request.direction,
    revision: 0,
  };
}

export function requestArtwork<T>(
  state: ArtworkTransition<T>,
  request: ArtworkRequest<T>,
): ArtworkTransition<T> {
  const before = state.requested;
  if (
    before.key === request.key &&
    before.item === request.item &&
    before.src === request.src &&
    before.tone === request.tone &&
    before.direction === request.direction
  )
    return state;

  const next = { ...state, requested: request };
  if (request.tone === undefined) return { ...next, pending: null };
  const frame: ArtworkFrame<T> = {
    key: request.key,
    item: request.item,
    src: request.src,
    tone: request.tone,
  };
  if (state.current.key === request.key) return { ...next, current: frame, pending: null };
  if (state.previous) return { ...next, pending: { ...frame, direction: request.direction } };
  return startArtwork(next, frame, request.direction);
}

function startArtwork<T>(
  state: ArtworkTransition<T>,
  frame: ArtworkFrame<T>,
  direction: ArtworkDirection,
): ArtworkTransition<T> {
  return {
    ...state,
    current: frame,
    previous: state.current,
    pending: null,
    direction,
    revision: state.revision + 1,
  };
}

export function finishArtwork<T>(
  state: ArtworkTransition<T>,
  revision: number,
): ArtworkTransition<T> {
  if (!state.previous || state.revision !== revision) return state;
  const settled = { ...state, previous: null, pending: null };
  if (!state.pending) return settled;
  return startArtwork(settled, state.pending, state.pending.direction);
}
