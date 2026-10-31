// Topologia da ilha padrão do Catan (raio 2 = 19 hexes) em coordenadas INTEIRAS.
// Vértices = triplas de cubo "x:y:z" (soma 0); arestas = par canônico de vértices.
// NUNCA floats na identidade — apenas no cálculo de ângulo para portos.
import {
  ISLAND_EXPECTED_EDGES,
  ISLAND_EXPECTED_VERTICES,
  ISLAND_HEX_COUNT,
  PORT_COUNT,
} from '../shared/constants';
import type { EdgeId, HexId, ResourceKind, VertexId } from '../shared/constants';
import type { PortSlot } from '../shared/types';

/** Direções unitárias de cubo (x, y, z com soma 0). */
const CUBE_DIRS: readonly (readonly [number, number, number])[] = [
  [1, -1, 0],
  [1, 0, -1],
  [0, 1, -1],
  [-1, 1, 0],
  [-1, 0, 1],
  [0, -1, 1],
];

export type CubeCoord = [number, number, number];

/** Axial (q, r) -> cubo (x, y, z) com x + y + z = 0. */
export function axialToCube(q: number, r: number): CubeCoord {
  return [q, -q - r, r];
}

export function cubeToVertexId(c: CubeCoord): VertexId {
  return `${c[0]}:${c[1]}:${c[2]}`;
}

export function hexIdOf(q: number, r: number): HexId {
  return `${q},${r}`;
}

/**
 * Canto i do hex centrado em `center`: 3*center + D[i] + D[i+1].
 * Equivale à soma das coordenadas dos 3 hexes que compartilham o canto
 * (center, center+D[i], center+D[i+1]) — garante identidade inteira compartilhada.
 * Ex.: hex (0,0,0) => cantos (2,-1,-1), (1,1,-2), (-1,2,-1), (-2,1,1), (-1,-1,2), (1,-2,1).
 */
export function hexCorner(center: CubeCoord, i: number): CubeCoord {
  const a = CUBE_DIRS[i];
  const b = CUBE_DIRS[(i + 1) % 6];
  return [
    3 * center[0] + a[0] + b[0],
    3 * center[1] + a[1] + b[1],
    3 * center[2] + a[2] + b[2],
  ];
}

/** Aresta canônica: vértices em ordem lexicográfica "v1|v2". */
export function canonicalEdge(v1: VertexId, v2: VertexId): EdgeId {
  return v1 < v2 ? `${v1}|${v2}` : `${v2}|${v1}`;
}

/**
 * Padrão fixo de portos em ordem angular: alterna genérico (3:1) e recurso (2:1),
 * resultando em 4 genéricos + 5 especiais (um por tipo de recurso).
 * Escolha documentada: distribuição uniforme na costa (9 de 30 arestas costeiras,
 * índices round(i*30/9) em ordem angular) com sequência fixa de tipos iniciando por
 * genérico — determinística e balanceada, sem aleatoriedade extra.
 */
const PORT_KIND_PATTERN: readonly ('generic' | ResourceKind)[] = [
  'generic',
  'brick',
  'generic',
  'lumber',
  'generic',
  'wool',
  'generic',
  'grain',
  'ore',
];

export interface IslandTopology {
  hexIds: HexId[];
  vertices: VertexId[];
  edges: EdgeId[];
  edgeEndpoints: Record<EdgeId, [VertexId, VertexId]>;
  vertexHexes: Record<VertexId, HexId[]>;
  vertexEdges: Record<VertexId, EdgeId[]>;
  hexEdges: Record<HexId, EdgeId[]>;
  hexNeighbors: Record<HexId, HexId[]>;
  /** Arestas com exatamente 1 hex adjacente (borda da ilha), em ordem angular. */
  coastalEdges: EdgeId[];
}

/** Hexes da ilha padrão (distância de cubo <= 2), ordenados por (q, r) para determinismo. */
export function islandHexCoords(): { q: number; r: number; id: HexId; cube: CubeCoord }[] {
  const out: { q: number; r: number; id: HexId; cube: CubeCoord }[] = [];
  for (let q = -2; q <= 2; q++) {
    for (let r = Math.max(-2, -q - 2); r <= Math.min(2, -q + 2); r++) {
      out.push({ q, r, id: hexIdOf(q, r), cube: axialToCube(q, r) });
    }
  }
  return out;
}

function cornerPixel(c: CubeCoord): { x: number; y: number } {
  // Cubo -> pixel axial (só para ordenar portos por ângulo; identidade continua inteira).
  const q = c[0];
  const r = c[2];
  return { x: 1.5 * q, y: Math.sqrt(3) * (r + q / 2) };
}

/** Constrói toda a topologia estática da ilha padrão e valida as constantes. */
export function buildIslandTopology(): IslandTopology {
  const hexes = islandHexCoords();

  const vertices = new Set<VertexId>();
  const edgeSet = new Set<EdgeId>();
  const edgeEndpoints: Record<EdgeId, [VertexId, VertexId]> = {};
  const vertexHexes: Record<VertexId, HexId[]> = {};
  const vertexEdges: Record<VertexId, EdgeId[]> = {};
  const hexEdges: Record<HexId, EdgeId[]> = {};
  const hexNeighbors: Record<HexId, HexId[]> = {};
  const edgeHexCount: Record<EdgeId, number> = {};
  // Vértice -> hexes vizinhos (axial) para derivar hexNeighbors por compartilhamento de aresta.
  const vertexToHexes: Record<VertexId, string[]> = {};

  for (const h of hexes) {
    hexEdges[h.id] = [];
    hexNeighbors[h.id] = [];
    const cornerIds: VertexId[] = [];
    for (let i = 0; i < 6; i++) {
      const corner = hexCorner(h.cube, i);
      const vid = cubeToVertexId(corner);
      vertices.add(vid);
      cornerIds.push(vid);
      if (!vertexHexes[vid]) vertexHexes[vid] = [];
      if (!vertexHexes[vid].includes(h.id)) vertexHexes[vid].push(h.id);
      if (!vertexToHexes[vid]) vertexToHexes[vid] = [];
      vertexToHexes[vid].push(h.id);
    }
    for (let i = 0; i < 6; i++) {
      const v1 = cornerIds[i];
      const v2 = cornerIds[(i + 1) % 6];
      const eid = canonicalEdge(v1, v2);
      edgeSet.add(eid);
      if (!edgeEndpoints[eid]) edgeEndpoints[eid] = v1 < v2 ? [v1, v2] : [v2, v1];
      edgeHexCount[eid] = (edgeHexCount[eid] ?? 0) + 1;
      hexEdges[h.id].push(eid);
      if (!vertexEdges[v1]) vertexEdges[v1] = [];
      if (!vertexEdges[v2]) vertexEdges[v2] = [];
      if (!vertexEdges[v1].includes(eid)) vertexEdges[v1].push(eid);
      if (!vertexEdges[v2].includes(eid)) vertexEdges[v2].push(eid);
    }
  }

  // hexNeighbors: dois hexes vizinhos se compartilham exatamente 1 aresta (2 vértices em comum).
  for (let i = 0; i < hexes.length; i++) {
    for (let j = i + 1; j < hexes.length; j++) {
      const a = hexes[i];
      const b = hexes[j];
      const shared = new Set(hexEdges[a.id].filter((e) => hexEdges[b.id].includes(e)));
      if (shared.size === 1) {
        hexNeighbors[a.id].push(b.id);
        hexNeighbors[b.id].push(a.id);
      }
    }
  }

  // Arestas costeiras em ordem angular (ângulo do ponto médio da aresta).
  const coastalEdges = [...edgeSet]
    .filter((e) => edgeHexCount[e] === 1)
    .map((e) => {
      const [v1, v2] = edgeEndpoints[e];
      const p1 = cornerPixel(parseVertexId(v1));
      const p2 = cornerPixel(parseVertexId(v2));
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      return { e, angle: Math.atan2(my, mx) };
    })
    .sort((a, b) => a.angle - b.angle || (a.e < b.e ? -1 : 1))
    .map((x) => x.e);

  const vertexList = [...vertices].sort(compareVertexIds);
  const edgeList = [...edgeSet].sort();
  const hexIds = hexes.map((h) => h.id);

  if (hexIds.length !== ISLAND_HEX_COUNT) throw new Error(`topologia: ${hexIds.length} hexes (esperado ${ISLAND_HEX_COUNT})`);
  if (vertexList.length !== ISLAND_EXPECTED_VERTICES) {
    throw new Error(`topologia: ${vertexList.length} vértices (esperado ${ISLAND_EXPECTED_VERTICES})`);
  }
  if (edgeList.length !== ISLAND_EXPECTED_EDGES) throw new Error(`topologia: ${edgeList.length} arestas (esperado ${ISLAND_EXPECTED_EDGES})`);
  // Costa real da ilha raio 2: 30 arestas (114 slots de aresta = 30 costeiras + 2*42 internas).
  if (coastalEdges.length !== 30) throw new Error(`topologia: ${coastalEdges.length} arestas costeiras (esperado 30)`);

  return { hexIds, vertices: vertexList, edges: edgeList, edgeEndpoints, vertexHexes, vertexEdges, hexEdges, hexNeighbors, coastalEdges };
}

export function parseVertexId(id: VertexId): CubeCoord {
  const [x, y, z] = id.split(':').map(Number);
  return [x, y, z];
}

/** Ordena vértices por tripla de cubo (x, depois y, depois z) — determinístico. */
export function compareVertexIds(a: VertexId, b: VertexId): number {
  const ca = parseVertexId(a);
  const cb = parseVertexId(b);
  return ca[0] - cb[0] || ca[1] - cb[1] || ca[2] - cb[2];
}

/**
 * 9 portos uniformes na costa.
 * Nota de implementação: a costa da ilha raio 2 tem 30 arestas costeiras (não 18 —
 * contagem aritmética: 19 hexes × 6 = 114 slots = 30 costeiras + 2×42 internas).
 * Escolhe-se uniformemente por ângulo: índice round(i × 30 / 9) para i em 0..8.
 * Tipos no padrão fixo documentado em PORT_KIND_PATTERN (4 genéricos + 5 recursos).
 */
export function buildPorts(topo: Pick<IslandTopology, 'coastalEdges' | 'edgeEndpoints'>): PortSlot[] {
  const n = topo.coastalEdges.length;
  const chosen: EdgeId[] = [];
  for (let i = 0; i < PORT_COUNT; i++) {
    chosen.push(topo.coastalEdges[Math.round((i * n) / PORT_COUNT)]);
  }
  if (new Set(chosen).size !== PORT_COUNT) throw new Error('portos: escolha não uniforme gerou duplicata');
  return chosen.map((edgeId, i) => {
    const [v1, v2] = topo.edgeEndpoints[edgeId];
    return { id: `port-${i}`, edgeId, vertexIds: [v1, v2], kind: PORT_KIND_PATTERN[i] };
  });
}
