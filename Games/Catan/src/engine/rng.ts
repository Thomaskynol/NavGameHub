// PRNG determinístico próprio do motor (tabuleiro + baralho embaralhado no createGame).
// A RNG de dados/roubo é injetada (deps.rng) — nunca esta.
import type { RandomSource } from '../shared/types';

/** FNV-1a: hash string -> uint32. */
export function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: PRNG leve e determinístico. */
export function mulberry32(seed: number): RandomSource {
  let a = seed >>> 0;
  return {
    next(): number {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** Fisher-Yates in-place. */
export function shuffleInPlace<T>(arr: T[], rng: RandomSource): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}
