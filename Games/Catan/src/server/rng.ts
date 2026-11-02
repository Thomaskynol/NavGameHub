// RNG do servidor: criptográfica por padrão; determinística com seed (testes);
// dados forçados (hook force_next_dice) apenas durante roll_dice.
import { randomInt } from 'node:crypto';
import type { RandomSource } from '../shared/types';

const UINT32 = 0x1_0000_0000;

export function cryptoRandomSource(): RandomSource {
  return {
    next: () => randomInt(UINT32) / UINT32,
  };
}

/** mulberry32 + hash FNV-1a da string (independente do tabuleiro do motor). */
export function seededRandomSource(seedText: string): RandomSource {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedText.length; i += 1) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return {
    next(): number {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / UINT32;
    },
  };
}

/**
 * Envolve a RNG base e, quando `forDice` está armado, devolve floats que mapeiam
 * exatos para os valores forçados (funciona com 1+floor(next()*6) e ceil(next()*6)).
 * Chama `onConsumed` após os 2 floats (desarma o hook).
 */
export function makeGameRng(
  base: RandomSource,
  forced: { d1: number; d2: number } | null,
  forDice: boolean,
  onConsumed?: () => void,
): RandomSource {
  if (!forced) return base;
  let step = 0;
  return {
    next(): number {
      if (!forDice) return base.next();
      if (step === 0) {
        step = 1;
        return (forced.d1 - 1 + 0.5) / 6;
      }
      if (step === 1) {
        step = 2;
        onConsumed?.();
        return (forced.d2 - 1 + 0.5) / 6;
      }
      return base.next();
    },
  };
}
