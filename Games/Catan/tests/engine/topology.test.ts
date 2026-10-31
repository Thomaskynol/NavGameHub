import { describe, expect, it } from 'vitest';
import { generateBoard } from '../../src/engine';
import { buildIslandTopology, buildPorts, hexCorner, axialToCube, cubeToVertexId, canonicalEdge } from '../../src/engine/topology';

describe('topologia da ilha padrão', () => {
  it('tem 54 vértices, 72 arestas e 19 hexes em várias seeds', () => {
    for (const seed of ['alpha', 'beta', 'seed-42', 'xyz-1', '']) {
      const b = generateBoard(seed);
      expect(b.vertices.length).toBe(54);
      expect(b.edges.length).toBe(72);
      expect(b.hexes.length).toBe(19);
    }
  });

  it('identidades são strings inteiras (sem float)', () => {
    const topo = buildIslandTopology();
    for (const v of topo.vertices) expect(v).toMatch(/^-?\d+:-?\d+:-?\d+$/);
    for (const e of topo.edges) expect(e).toMatch(/^-?\d+:-?\d+:-?\d+\|-?\d+:-?\d+:-?\d+$/);
  });

  it('hex (0,0,0) tem os cantos canônicos documentados', () => {
    const c = axialToCube(0, 0);
    const corners = [0, 1, 2, 3, 4, 5].map((i) => cubeToVertexId(hexCorner(c, i)));
    expect(corners).toEqual(['2:-1:-1', '1:1:-2', '-1:2:-1', '-2:1:1', '-1:-1:2', '1:-2:1']);
    expect(canonicalEdge(corners[0], corners[1])).toBe('1:1:-2|2:-1:-1');
  });

  it('arestas e vértices coerentes entre si', () => {
    const b = generateBoard('coerente');
    const vset = new Set(b.vertices);
    const eset = new Set(b.edges);
    for (const e of b.edges) {
      const [a, c] = b.edgeEndpoints[e];
      expect(vset.has(a)).toBe(true);
      expect(vset.has(c)).toBe(true);
      expect(e).toBe(a < c ? `${a}|${c}` : `${c}|${a}`);
    }
    for (const v of b.vertices) {
      expect(b.vertexEdges[v].length).toBeGreaterThanOrEqual(2);
      for (const e of b.vertexEdges[v]) {
        expect(eset.has(e)).toBe(true);
        expect(b.edgeEndpoints[e]).toContain(v);
      }
      expect(b.vertexHexes[v].length).toBeGreaterThanOrEqual(1);
    }
    for (const h of b.hexes) {
      expect(b.hexEdges[h.id].length).toBe(6);
      for (const e of b.hexEdges[h.id]) expect(eset.has(e)).toBe(true);
      expect(b.hexNeighbors[h.id].length).toBeLessThanOrEqual(6);
    }
    // hexNeighbors simétrico
    for (const h of b.hexes) {
      for (const n of b.hexNeighbors[h.id]) {
        expect(b.hexNeighbors[n]).toContain(h.id);
      }
    }
    // cada hex vizinho compartilha exatamente 1 aresta
    for (const h of b.hexes) {
      for (const n of b.hexNeighbors[h.id]) {
        const shared = b.hexEdges[h.id].filter((e) => b.hexEdges[n].includes(e));
        expect(shared.length).toBe(1);
      }
    }
  });

  it('9 portos (4 genéricos + 5 recursos, um por tipo) em arestas costeiras', () => {
    const b = generateBoard('portos');
    expect(b.ports.length).toBe(9);
    const kinds = b.ports.map((p) => p.kind);
    expect(kinds.filter((k) => k === 'generic').length).toBe(4);
    const resources = kinds.filter((k) => k !== 'generic').sort();
    expect(resources).toEqual(['brick', 'grain', 'lumber', 'ore', 'wool']);
    for (const p of b.ports) {
      const [v1, v2] = p.edgeId.split('|');
      expect(p.vertexIds).toEqual([v1, v2]);
      // costeira: aresta usada por exatamente 1 hex
      const count = b.hexes.filter((h) => b.hexEdges[h.id].includes(p.edgeId)).length;
      expect(count).toBe(1);
    }
    // 30 arestas costeiras (costa real da ilha raio 2); 9 portos escolhidos uniformemente
    const topo = buildIslandTopology();
    expect(topo.coastalEdges.length).toBe(30);
    const ports2 = buildPorts(topo);
    const expected = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => topo.coastalEdges[Math.round((i * 30) / 9)]);
    expect(ports2.map((p) => p.edgeId)).toEqual(expected);
  });
});
