// Regressão: a geometria do cliente (buildIslandGeometry) deve associar CADA
// vértice/aresta aos MESMOS tiles do motor (topology.vertexHexes / hexEdges).
// Bug pré-existente: axialToCube(q, −q−r) gerava o hex espelhado — contagens globais
// (54/72) casavam, mas v.hexes/e.hexes divergiam por vértice/aresta.
import { describe, expect, it } from 'vitest';
import { generateBoard } from '../../src/engine/mapgen';
import { buildIslandGeometry, vertexIdFromCorner, ISLAND_AXIAL } from '../../src/client/board/geometry';

const SEEDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'fullgame-board', 'seed-fixa'];

/** Hexes de cada aresta, derivado de hexEdges do motor. */
function engineEdgeHexes(hexEdges: Record<string, string[]>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [hexId, eids] of Object.entries(hexEdges)) {
    for (const e of eids) {
      const list = out.get(e) ?? [];
      list.push(hexId);
      out.set(e, list);
    }
  }
  return out;
}

const sorted = (xs: Iterable<string>): string[] => [...xs].sort();

describe('geometria do cliente x topologia do motor', () => {
  for (const seed of SEEDS) {
    it(`seed=${seed}: v.hexes, e.hexes, v.edges e endpoints batem 1:1`, () => {
      const board = generateBoard(seed);
      const geo = buildIslandGeometry(board.hexes);

      // Mesmos vértices e arestas (conjunto de IDs intacto).
      expect(sorted(geo.vertices.keys())).toEqual(sorted(Object.keys(board.vertexHexes)));
      const edgeHexes = engineEdgeHexes(board.hexEdges);
      expect(sorted(geo.edges.keys())).toEqual(sorted(edgeHexes.keys()));

      // Vértice → hexes.
      for (const [vid, hexes] of Object.entries(board.vertexHexes)) {
        const v = geo.vertices.get(vid);
        expect(v, `vértice ${vid} ausente na geo`).toBeDefined();
        expect(sorted(v!.hexes), `vertexHexes[${vid}]`).toEqual(sorted(hexes));
      }

      // Vértice → arestas.
      for (const [vid, eids] of Object.entries(board.vertexEdges)) {
        const v = geo.vertices.get(vid);
        expect(sorted(v!.edges), `vertexEdges[${vid}]`).toEqual(sorted(eids));
      }

      // Aresta → hexes (é o que detecta costa/portos no mockView: hexes.length === 1).
      for (const [eid, hexes] of edgeHexes) {
        const e = geo.edges.get(eid);
        expect(e, `aresta ${eid} ausente na geo`).toBeDefined();
        expect(sorted(e!.hexes), `hexes da aresta ${eid}`).toEqual(sorted(hexes));
      }

      // Aresta → endpoints idênticos ao motor.
      for (const [eid, [a, b]] of Object.entries(board.edgeEndpoints)) {
        const e = geo.edges.get(eid);
        expect([e!.a, e!.b].sort(), `endpoints de ${eid}`).toEqual([a, b].sort());
      }
    });
  }

  it('sem divergências em nenhuma das 5+ seeds (contagem global zero)', () => {
    let bad = 0;
    for (const seed of SEEDS) {
      const board = generateBoard(seed);
      const geo = buildIslandGeometry(board.hexes);
      for (const [vid, hexes] of Object.entries(board.vertexHexes)) {
        const a = sorted(geo.vertices.get(vid)?.hexes ?? []);
        if (a.join('|') !== sorted(hexes).join('|')) bad += 1;
      }
      const edgeHexes = engineEdgeHexes(board.hexEdges);
      for (const [eid, hexes] of edgeHexes) {
        const a = sorted(geo.edges.get(eid)?.hexes ?? []);
        if (a.join('|') !== sorted(hexes).join('|')) bad += 1;
      }
    }
    expect(bad).toBe(0);
  });

  it('custos: costa com 30 arestas (hexes.length===1, como o mockView) e cantos do mock existem na geo', () => {
    const board = generateBoard('alpha');
    const geo = buildIslandGeometry(board.hexes);
    const coastal = [...geo.edges.values()].filter((e) => e.hexes.length === 1);
    expect(coastal.length).toBe(30);
    // mockView posiciona peças com vertexIdFromCorner(q, r, k): precisa existir na geo.
    for (const [q, r] of ISLAND_AXIAL) {
      for (let k = 0; k < 6; k++) {
        expect(geo.vertices.has(vertexIdFromCorner(q, r, k)), `canto ${k} de ${q},${r}`).toBe(true);
      }
    }
  });
});
