// SPDX-License-Identifier: AGPL-3.0-only
/** Ignore stale keys; new entries retain their default relative order. */
export function orderedKeys(defaults: string[], saved: string[] = []) {
  const present = new Set(defaults);
  return [...new Set([...saved.filter((key) => present.has(key)), ...defaults])];
}

/** Reordering a filtered view must not shuffle entries hidden by the filter. */
export function mergeVisibleOrder(full: string[], visible: string[]) {
  const changed = new Set(visible);
  let at = 0;
  return full.map((key) => (changed.has(key) ? visible[at++] : key));
}
