// SPDX-License-Identifier: AGPL-3.0-only
export const GLASS_LENSES = 8;

export function createEffectLayout(track: string) {
  let state = 2166136261;
  for (const char of track) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  const seed = state / 4294967296;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let n = Math.imul(state ^ (state >>> 15), state | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
  const lenses = new Float32Array(GLASS_LENSES * 4);
  const optics = new Float32Array(GLASS_LENSES * 4);
  const frequencies = Array.from({ length: GLASS_LENSES }, (_, i) => (i + 0.5) / GLASS_LENSES);
  for (let i = frequencies.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [frequencies[i], frequencies[j]] = [frequencies[j], frequencies[i]];
  }
  for (let i = 0; i < GLASS_LENSES; i++) {
    const angle = random() * Math.PI * 2;
    lenses.set(
      [
        ((i % 3) + 0.25 + random() * 0.5) / 3,
        0.15 + ((Math.floor(i / 3) + 0.2 + random() * 0.6) / 3) * 0.7,
        0.13 + random() * 0.18,
        0.1 + random() * 0.2,
      ],
      i * 4,
    );
    optics.set(
      [
        Math.cos(angle),
        Math.sin(angle),
        (random() < 0.5 ? -1 : 1) * (0.65 + random() * 0.7),
        frequencies[i],
      ],
      i * 4,
    );
  }
  return { seed, lenses, optics };
}
