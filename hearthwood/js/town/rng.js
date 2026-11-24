// Hearthwood — Living Town: seeded RNG and hashing (docs/LIVING.md §12.4). Pure, no imports.
// Every random choice in the sim goes through here (§13.5), seeded from the town seed and the villager seed.

/** mulberry32: a fast 32-bit seeded generator → () => [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash any mix of numbers and strings into a uint32 (FNV-1a over the parts, then a murmur finaliser). */
export function hash32(...parts) {
  let h = 0x811c9dc5;
  for (const p of parts) {
    if (typeof p === 'number') {
      // integers hash exactly; other numbers through a fixed-point view
      let v = Number.isInteger(p) ? p : Math.round(p * 1024);
      for (let i = 0; i < 4; i++) { h ^= v & 0xff; h = Math.imul(h, 0x01000193); v >>>= 8; }
      h ^= 0x2c; h = Math.imul(h, 0x01000193);
    } else {
      const s = String(p);
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
      h ^= 0x1f; h = Math.imul(h, 0x01000193);
    }
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A number in [a, b). */
export const range = (r, a, b) => a + r() * (b - a);

/** An integer in [a, b] (inclusive). */
export const int = (r, a, b) => a + Math.floor(r() * (b - a + 1));

/** One element of arr (undefined for an empty array). */
export const pick = (r, arr) => (arr.length ? arr[Math.floor(r() * arr.length)] : undefined);

/** Weighted choice over [[item, weight], …]; weights ≤ 0 are skipped; null when nothing has weight. */
export function weighted(r, list) {
  let total = 0;
  for (const [, w] of list) if (w > 0) total += w;
  if (!(total > 0)) return null;
  let x = r() * total;
  for (const [item, w] of list) {
    if (!(w > 0)) continue;
    x -= w;
    if (x < 0) return item;
  }
  for (let i = list.length - 1; i >= 0; i--) if (list[i][1] > 0) return list[i][0];
  return null;
}
