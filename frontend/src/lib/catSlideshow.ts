// SPDX-License-Identifier: AGPL-3.0-only

export const CAT_CLIPS = ["01", "02", "03", "04"].map((id) => ({
  id,
  video: `/cats/${id}.webm`,
  poster: `/cats/${id}.jpg`,
}));

export const CAT_SLIDESHOW = {
  dissolveMs: 280,
  beatsPerSlide: 16,
  slowBeatsPerSlide: 8,
  minimumSlideSeconds: 4,
  fallbackSeconds: 8,
  maximumFallbackSeconds: 10,
  minimumRate: 0.8,
  maximumRate: 1.25,
};

function tempo(bpm: number | null | undefined): number | null {
  return bpm != null && Number.isFinite(bpm) && bpm >= 40 && bpm <= 260 ? bpm : null;
}

export function catPlaybackRate(duration: number, bpm: number | null | undefined): number {
  const value = tempo(bpm);
  if (!value || !Number.isFinite(duration) || duration <= 0) return 1;
  const secondsPerBeat = 60 / value;
  const beats = Math.max(1, Math.round(duration / secondsPerBeat));
  return Math.min(
    CAT_SLIDESHOW.maximumRate,
    Math.max(CAT_SLIDESHOW.minimumRate, duration / (beats * secondsPerBeat)),
  );
}

export function catPlaybackPosition(
  position: number,
  audioStart: number,
  duration: number,
  rate: number,
): number {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) return 0;
  return (Math.max(0, position - audioStart) * rate) % duration;
}

/** Uses music time: pauses and background tabs never accumulate missed slide changes. */
export class CatSlideClock {
  private started: number;
  private previous: number;
  constructor(position: number) {
    this.started = this.previous = position;
  }

  reset(position: number) {
    this.started = this.previous = position;
  }

  advance(
    position: number,
    bpm: number | null | undefined,
    audioStart = 0,
    beat?: boolean,
  ): boolean {
    if (!Number.isFinite(position)) return false;
    if (position < this.previous - 0.2 || position - this.previous > 2) {
      this.reset(position);
      return false;
    }
    const previous = this.previous;
    this.previous = position;
    const elapsed = position - this.started;
    if (elapsed < CAT_SLIDESHOW.minimumSlideSeconds) return false;
    const value = tempo(bpm);
    if (value) {
      const length =
        ((value < 90 ? CAT_SLIDESHOW.slowBeatsPerSlide : CAT_SLIDESHOW.beatsPerSlide) * 60) / value;
      if (
        Math.floor(Math.max(0, position - audioStart) / length) <=
        Math.floor(Math.max(0, previous - audioStart) / length)
      )
        return false;
    } else if (
      elapsed < CAT_SLIDESHOW.fallbackSeconds ||
      (beat === false && elapsed < CAT_SLIDESHOW.maximumFallbackSeconds)
    )
      return false;
    this.reset(position);
    return true;
  }
}

export interface CatSlides {
  trackId: string | null;
  current: number;
  previous: number | null;
  pending: number | null;
  revision: number;
}
export function createCatSlides(trackId: string | null): CatSlides {
  return { trackId, current: 0, previous: null, pending: null, revision: 0 };
}
export function requestCatSlide(state: CatSlides, index: number): CatSlides {
  const current = ((index % CAT_CLIPS.length) + CAT_CLIPS.length) % CAT_CLIPS.length;
  if (state.previous !== null)
    return { ...state, pending: current === state.current ? null : current };
  if (current === state.current) return state;
  return {
    ...state,
    current,
    previous: state.current,
    pending: null,
    revision: state.revision + 1,
  };
}
export function syncCatTrack(
  state: CatSlides,
  trackId: string | null,
  automatic = true,
): CatSlides {
  if (state.trackId === trackId) return state;
  const updated = { ...state, trackId };
  return automatic ? requestCatSlide(updated, state.current + 1) : updated;
}
export function finishCatSlide(state: CatSlides, revision: number): CatSlides {
  if (state.revision !== revision || state.previous === null) return state;
  const settled = { ...state, previous: null, pending: null };
  return state.pending === null ? settled : requestCatSlide(settled, state.pending);
}
