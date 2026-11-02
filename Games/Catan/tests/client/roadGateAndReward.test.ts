import { describe, expect, it } from 'vitest';
import type { LegalTargets } from '../../src/client/board/legalClient';
import { gateRoadHighlights, latestKindSeq, productionGains } from '../../src/client/screens/Game';

const LEGAL: LegalTargets = {
  settlementVertices: ['v1'],
  cityVertices: ['v2'],
  roadEdges: ['e1', 'e2'],
  freeRoadEdges: ['e3'],
  setupVertices: ['s1'],
  setupEdges: ['se1'],
};

describe('gateRoadHighlights (Board ignora mode:none — Game filtra o legal)', () => {
  it('gate fechado => sem arestas de estrada p/ o Board destacar/clicar', () => {
    const gated = gateRoadHighlights(LEGAL, false);
    expect(gated.roadEdges).toEqual([]);
    expect(gated.freeRoadEdges).toEqual([]);
  });

  it('gate fechado => preserva setup e vértices', () => {
    const gated = gateRoadHighlights(LEGAL, false);
    expect(gated.setupEdges).toEqual(['se1']);
    expect(gated.setupVertices).toEqual(['s1']);
    expect(gated.settlementVertices).toEqual(['v1']);
    expect(gated.cityVertices).toEqual(['v2']);
  });

  it('gate aberto => legal intacto', () => {
    expect(gateRoadHighlights(LEGAL, true)).toBe(LEGAL);
  });
});

describe('productionGains (delta da mão — só incrementos)', () => {
  const zero = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };

  it('soma só o que aumentou', () => {
    expect(
      productionGains(zero, { ...zero, grain: 2, lumber: 1 }),
    ).toEqual([
      { resource: 'lumber', count: 1 },
      { resource: 'grain', count: 2 },
    ]);
  });

  it('ignora gasto (delta negativo) e recurso zerado', () => {
    const gains = productionGains(
      { ...zero, brick: 1, lumber: 1 },
      { ...zero, lumber: 2 },
    );
    expect(gains).toEqual([{ resource: 'lumber', count: 1 }]);
  });

  it('sem ganho => [] (sem toast)', () => {
    expect(productionGains(zero, zero)).toEqual([]);
  });
});

describe('latestKindSeq (gatilho do toast)', () => {
  it('retorna a maior seq do kind (0 quando ausente)', () => {
    const h = [
      { seq: 1, kind: 'dice' },
      { seq: 2, kind: 'production' },
      { seq: 3, kind: 'dice' },
    ];
    expect(latestKindSeq(h, 'production')).toBe(2);
    expect(latestKindSeq(h, 'dice')).toBe(3);
    expect(latestKindSeq(h, 'built')).toBe(0);
    expect(latestKindSeq([], 'dice')).toBe(0);
  });
});
