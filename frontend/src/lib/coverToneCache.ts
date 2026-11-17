// SPDX-License-Identifier: AGPL-3.0-only

import type { BackdropTone, CoverTone } from "./coverTone";

type Profiles = {
  accent: CoverTone | null;
  backdrop: BackdropTone | null;
  player: BackdropTone | null;
};
export type CoverToneKind = keyof Profiles;
export type CoverTones = Partial<Profiles>;

export function createCoverToneCache(
  sample: (url: string, kind: CoverToneKind) => Promise<CoverTones>,
  limit = 400,
) {
  const tones = new Map<string, CoverTones>();
  const pending = new Map<string, Promise<void>>();
  const listeners = new Map<string, Set<() => void>>();
  const trim = () => {
    for (const url of tones.keys()) {
      if (tones.size <= limit) break;
      // Visible covers must remain cached. Evicting one makes its hook reload it,
      // which can otherwise cycle forever when a collection exceeds the limit.
      if (!listeners.has(url)) tones.delete(url);
    }
  };
  const get = <K extends CoverToneKind>(url: string, kind: K): Profiles[K] | undefined =>
    tones.get(url)?.[kind];

  const load = (url: string, kind: CoverToneKind): Promise<void> => {
    const key = `${kind}:${url}`;
    if (pending.has(key)) return pending.get(key)!;
    if (get(url, kind) !== undefined) return Promise.resolve();
    const task = Promise.resolve()
      .then(() => sample(url, kind))
      .catch((): CoverTones => ({ [kind]: null }))
      .then((tone) => {
        const profile = { [kind]: tone[kind] ?? null };
        tones.set(url, { ...tones.get(url), ...profile });
        trim();
        listeners.get(url)?.forEach((listener) => listener());
      })
      .finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  };

  const subscribe = (urls: readonly string[], listener: () => void) => {
    const sources = new Set(urls);
    for (const url of sources) {
      if (!listeners.has(url)) listeners.set(url, new Set());
      listeners.get(url)!.add(listener);
    }
    return () => {
      for (const url of sources) {
        const active = listeners.get(url);
        active?.delete(listener);
        if (active?.size === 0) listeners.delete(url);
      }
      trim();
    };
  };
  return { get, load, subscribe };
}
