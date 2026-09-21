/**
 * Seeded random helpers. Every draw in the synthetic data goes through one of
 * these, so a fixed seed reproduces the same players, matches and ratings.
 */

import seedrandom from 'seedrandom';

export type Rng = ReturnType<typeof makeRng>;

export function makeRng(seed: string) {
  const next = seedrandom(seed);

  const uniform = (lo = 0, hi = 1) => lo + (hi - lo) * next();

  /** Standard normal by Box-Muller. */
  const normal = (mean = 0, sd = 1) => {
    let u = 0;
    while (u === 0) u = next();
    const v = next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  /** Gamma(k, 1) for integer k: sum of k exponentials. */
  const gammaInt = (k: number) => {
    let sum = 0;
    for (let i = 0; i < k; i++) {
      let u = 0;
      while (u === 0) u = next();
      sum -= Math.log(u);
    }
    return sum;
  };

  /** Beta(a, b) for integer a, b, as a ratio of gammas. */
  const beta = (a: number, b: number) => {
    const x = gammaInt(a);
    const y = gammaInt(b);
    return x / (x + y);
  };

  const int = (lo: number, hi: number) => Math.floor(uniform(lo, hi + 1));
  const pick = <T,>(items: readonly T[]) => items[Math.floor(next() * items.length)]!;
  const chance = (p: number) => next() < p;

  /** Weighted choice over [value, weight] pairs. */
  const weighted = <T,>(pairs: readonly (readonly [T, number])[]) => {
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    let r = next() * total;
    for (const [value, w] of pairs) {
      r -= w;
      if (r <= 0) return value;
    }
    return pairs[pairs.length - 1]![0];
  };

  /** k distinct items, order preserved from a Fisher-Yates prefix. */
  const sample = <T,>(items: readonly T[], k: number) => {
    const copy = [...items];
    for (let i = 0; i < Math.min(k, copy.length); i++) {
      const j = i + Math.floor(next() * (copy.length - i));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy.slice(0, k);
  };

  /** RFC 4122 v4-shaped UUID from the seeded stream, so ids reproduce too. */
  const uuid = () => {
    const hex = Array.from({ length: 32 }, () => Math.floor(next() * 16).toString(16));
    hex[12] = '4';
    hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
    const h = hex.join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };

  return { next, uniform, normal, beta, int, pick, chance, weighted, sample, uuid };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
