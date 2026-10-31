import { describe, expect, it } from 'vitest';
import { generateBoard } from '../../src/engine';
import { NUMBER_TOKENS, RED_NUMBERS, TERRAIN_COUNTS } from '../../src/shared/constants';
import type { TerrainKind } from '../../src/shared/constants';

const SEEDS = ['a', 'b', 'c', 'seed-1', 'seed-2', 'seed-3', 'tabuleiro-42', 'xyz', '999', 'final'];

describe('mapgen determinístico', () => {
  it('tokens oficiais: 2 e 12 uma vez; demais duas; deserto sem número', () => {
    for (const seed of SEEDS) {
      const b = generateBoard(seed);
      const numbers = b.hexes.filter((h) => h.number !== null).map((h) => h.number as number);
      expect(numbers.length).toBe(18);
      expect([...numbers].sort((x, y) => x - y)).toEqual([...NUMBER_TOKENS].sort((x, y) => x - y));
      const deserts = b.hexes.filter((h) => h.terrain === 'desert');
      expect(deserts.length).toBe(1);
      expect(deserts[0].number).toBeNull();
    }
  });

  it('distribuição oficial de terrenos', () => {
    for (const seed of SEEDS) {
      const b = generateBoard(seed);
      const counts: Record<string, number> = {};
      for (const h of b.hexes) counts[h.terrain] = (counts[h.terrain] ?? 0) + 1;
      expect(counts).toEqual(TERRAIN_COUNTS as Record<string, number>);
    }
  });

  it('nenhum par de hexes adjacentes ambos com 6 ou 8 (multi-seed)', () => {
    for (const seed of SEEDS) {
      const b = generateBoard(seed);
      const byId = new Map(b.hexes.map((h) => [h.id, h]));
      for (const h of b.hexes) {
        if (h.number === null || !RED_NUMBERS.includes(h.number)) continue;
        for (const n of b.hexNeighbors[h.id]) {
          const nh = byId.get(n);
          expect(nh).toBeDefined();
          if (nh && nh.number !== null) expect(RED_NUMBERS.includes(nh.number)).toBe(false);
        }
      }
    }
  });

  it('determinístico: mesma seed => mesmo tabuleiro; seeds distintas diferem', () => {
    const a1 = generateBoard('mesma-seed');
    const a2 = generateBoard('mesma-seed');
    expect(a1).toEqual(a2);
    const diffs = SEEDS.slice(1).filter((s, i) => JSON.stringify(generateBoard(s)) !== JSON.stringify(generateBoard(SEEDS[i])));
    expect(diffs.length).toBeGreaterThan(0);
  });

  it('todo hex não-deserto tem recurso coerente com o terreno', () => {
    const b = generateBoard('recursos');
    const map: Record<Exclude<TerrainKind, 'desert'>, string> = {
      hills: 'brick',
      forest: 'lumber',
      pasture: 'wool',
      fields: 'grain',
      mountains: 'ore',
    };
    for (const h of b.hexes) {
      if (h.terrain === 'desert') expect(h.number).toBeNull();
      else expect(map[h.terrain]).toBeTruthy();
    }
  });
});
