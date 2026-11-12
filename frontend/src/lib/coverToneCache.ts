// SPDX-License-Identifier: AGPL-3.0-only

import type { BackdropTone, CoverTone } from "./coverTone";

type Profiles = { accent: CoverTone | null; backdrop: BackdropTone | null };
export type CoverToneKind = keyof Profiles;
export type CoverTones = Partial<Profiles>;

export function createCoverToneCache(
  sample: (url: string, kind: CoverToneKind) => Promise<CoverTones>,
  limit = 400,
) {
  const tones = new Map<string, CoverTones>();
  const pending = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  const get = <K extends CoverToneKind>(url: string, kind: K): Profiles[K] | undefined =>
    tones.get(url)?.[kind];

  const load = (url: string, kind: CoverToneKind): Promise<void> => {
    const key = `${kind}:${url}`;
    if (pending.has(key)) return pending.get(key)!;
    if (get(url, kind) !== undefined) return Promise.resolve();
    const task = Promise.resolve()
      .then(() => sample(url, kind))
      .catch((): CoverTones => (kind === "accent" ? { accent: null } : { backdrop: null }))
      .then((tone) => {
        if (tones.size >= limit && !tones.has(url)) tones.delete(tones.keys().next().value!);
        tones.set(url, { ...tones.get(url), ...tone });
        listeners.forEach((listener) => listener());
      })
      .finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return { get, load, subscribe };
}
