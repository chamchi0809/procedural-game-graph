// Deterministic PRNG so a seed string always reproduces the same level.

export interface Rng {
  next(): number;
  range(min: number, max: number): number;
  int(min: number, maxInclusive: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly T[], weight: (item: T) => number): T;
  shuffle<T>(items: T[]): T[];
  fork(salt: string | number): Rng;
}

export function hashString(text: string): number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export function makeRng(seed: number | string): Rng {
  let state = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
    weighted(items, weight) {
      const total = items.reduce((sum, item) => sum + Math.max(0, weight(item)), 0);
      if (total <= 0) return rng.pick(items);
      let r = next() * total;
      for (const item of items) {
        r -= Math.max(0, weight(item));
        if (r <= 0) return item;
      }
      return items[items.length - 1];
    },
    shuffle(items) {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
      return items;
    },
    fork: (salt) => makeRng(hashString(`${state}:${salt}`)),
  };
  return rng;
}

export function randomSeedWord(): string {
  const a = ['moss', 'amber', 'quiet', 'hollow', 'silver', 'tangled', 'sunny', 'misty', 'mossy', 'old', 'secret', 'little'];
  const b = ['garden', 'grove', 'meadow', 'orchard', 'maze', 'glade', 'thicket', 'court', 'warren', 'forest'];
  const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
  return `${pick(a)}-${pick(b)}-${Math.floor(Math.random() * 900 + 100)}`;
}
