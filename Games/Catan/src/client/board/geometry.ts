// Geometria axial→pixel da ilha (pointy-top), derivada localmente.
//
// Convenção de IDs (MUST casar com o motor/servo — motor é fonte de verdade):
// - VertexId = "x:y:z" no sistema de cubo ×3 EXATAMENTE como o engine/topology.ts:
//   hex "q,r" → cubo axialToCube(q, r) = [q, −q−r, r]; canto k = 3·center + D[k] + D[k+1]
//   (mesma ordem de direções D do motor). É a associação que faz v.hexes / e.hexes
//   baterem 1:1 com vertexHexes / hexEdges do motor — conferido por seed em
//   tests/client/geometry.test.ts (bug pré-existente: usava axialToCube(q, −q−r),
//   o hex espelhado: conjunto global de vértices/arestas casava (simetria y↔z),
//   mas cada vértice apontava para os tiles do hex espelhado).
// - Posição: vertexPosition deriva pixel de (u,v) = (x/3, y/3) como axial do cliente;
//   conjunto de vértices/arestas não muda com a correção (só muda qual tile.id é
//   registrado em v.hexes/e.hexes) — renderização intacta.
// - EdgeId = "v1|v2" com vértices em ordem lexicográfica (igual ao canonicalEdge do motor).
// - HexId axial "q,r" (igual ao hexIdOf do motor).
import type { EdgeId, HexId, VertexId } from '../../shared/constants';
import type { HexTile } from '../../shared/types';

export const HEX_SIZE = 46;

/** Direções unitárias de cubo (x, y, z com soma 0) — igual ao motor/topology.ts. */
const CUBE_DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, -1, 0],
  [1, 0, -1],
  [0, 1, -1],
  [-1, 1, 0],
  [-1, 0, 1],
  [0, -1, 1],
];

export interface Pt {
  x: number;
  y: number;
}

export interface GeoVertex {
  id: VertexId;
  x: number;
  y: number;
  hexes: HexId[];
  edges: EdgeId[];
}

export interface GeoEdge {
  id: EdgeId;
  a: VertexId;
  b: VertexId;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  mx: number;
  my: number;
  angleDeg: number;
  hexes: HexId[];
}

export interface GeoHex {
  id: HexId;
  q: number;
  r: number;
  x: number;
  y: number;
  tile: HexTile;
}

export interface IslandGeometry {
  hexes: GeoHex[];
  hexMap: Map<HexId, GeoHex>;
  vertices: Map<VertexId, GeoVertex>;
  edges: Map<EdgeId, GeoEdge>;
  center: Pt;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * Offsets de canto (dx, dy) por índice k; z = −(x+y).
 * = (D[k] + D[k+1]).xy do motor. Usado por vertexIdFromCorner (canto em AXIAL DO
 * CLIENTE: id = 3·(q, r, −q−r) + offset — perto do hex desenhado em axialCenter(q, r)).
 * A topologia (v.hexes/e.hexes) NÃO usa isto: usa motorCornerId(axialToCube(q, r)).
 */
const CORNER_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [2, -1], // k=0: D[0]+D[1]
  [1, 1], // k=1: D[1]+D[2]
  [-1, 2], // k=2: D[2]+D[3]
  [-2, 1], // k=3: D[3]+D[4]
  [-1, -1], // k=4: D[4]+D[5]
  [1, -2], // k=5: D[5]+D[0]
];

/** Todos os axiais da ilha padrão (raio 2,19 hexes). */
export const ISLAND_AXIAL: ReadonlyArray<readonly [number, number]> = (() => {
  const out: [number, number][] = [];
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      if (Math.abs(q + r) <= 2) out.push([q, r]);
    }
  }
  return out;
})();

export function parseHexId(id: HexId): { q: number; r: number } {
  const [q, r] = id.split(',').map(Number);
  return { q, r };
}

export function hexId(q: number, r: number): HexId {
  return `${q},${r}`;
}

export function axialCenter(q: number, r: number): Pt {
  return {
    x: HEX_SIZE * Math.sqrt(3) * (q + r / 2),
    y: HEX_SIZE * 1.5 * r,
  };
}

/**
 * Axial → cubo do MOTOR (igual a engine/topology.ts: axialToCube(q, r) = [q, −q−r, r]).
 * O hex "q,r" do tile É o hex "q,r" do motor: passar (q, r) diretamente.
 * Passar (q, −q−r) aqui gera o hex espelhado (bug que vies/divergia de vertexHexes).
 */
export function axialToCube(q: number, r: number): [number, number, number] {
  return [q, -q - r, r];
}

/** Canto k do hex centrado em cubo (x,y,z): 3·center + D[k] + D[k+1] (igual ao motor). */
export function motorCornerId(center: [number, number, number], k: number): VertexId {
  const a = CUBE_DIRS[k];
  const b = CUBE_DIRS[(k + 1) % 6];
  const x = 3 * center[0] + a[0] + b[0];
  const y = 3 * center[1] + a[1] + b[1];
  const z = 3 * center[2] + a[2] + b[2];
  return `${x}:${y}:${z}`;
}

export function vertexIdFromCorner(q: number, r: number, k: number): VertexId {
  const [du, dv] = CORNER_OFFSETS[k];
  const x = 3 * q + du;
  const y = 3 * r + dv;
  return `${x}:${y}:${-x - y}`;
}

export function vertexPosition(id: VertexId): Pt {
  const parts = id.split(':').map(Number);
  const u = parts[0] / 3;
  const v = parts[1] / 3;
  return {
    x: HEX_SIZE * Math.sqrt(3) * (u + v / 2),
    y: HEX_SIZE * 1.5 * v,
  };
}

export function edgeIdOf(a: VertexId, b: VertexId): EdgeId {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function parseEdgeId(id: EdgeId): [VertexId, VertexId] {
  const i = id.indexOf('|');
  return [id.slice(0, i), id.slice(i + 1)];
}

/** Pontos do hexágono pointy-top centrado em (cx,cy). */
export function hexPathPoints(cx: number, cy: number, size = HEX_SIZE): string {
  const pts: string[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (60 * k + 30);
    pts.push(`${(cx + size * Math.cos(a)).toFixed(2)},${(cy + size * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

/** Constrói a topologia completa da ilha a partir dos tiles. */
export function buildIslandGeometry(hexes: HexTile[]): IslandGeometry {
  const vertices = new Map<VertexId, GeoVertex>();
  const edges = new Map<EdgeId, GeoEdge>();
  const hexList: GeoHex[] = [];
  const hexMap = new Map<HexId, GeoHex>();

  for (const tile of hexes) {
    const { q, r } = parseHexId(tile.id);
    const c = axialCenter(q, r);
    const gh: GeoHex = { id: tile.id, q, r, x: c.x, y: c.y, tile };
    hexList.push(gh);
    hexMap.set(tile.id, gh);

    const vids: VertexId[] = [];
    // Centro de cubo do MOTOR para este hex: convenção idêntica ao engine/topology.ts
    // (hexIdOf "q,r" → axialToCube(q, r) = [q, −q−r, r]; hexCorner = 3·center + D[k] + D[k+1]).
    // É ISTO que faz v.hexes/e.hexes baterem 1:1 com vertexHexes/hexEdges do motor
    // (regressão em tests/client/geometry.test.ts). Piso/IDs não mudam: o conjunto de
    // vértices é o mesmo e vertexPosition depende só do id.
    const motorCube = axialToCube(q, r);
    for (let k = 0; k < 6; k++) {
      const vid = motorCornerId(motorCube, k);
      vids.push(vid);
      let v = vertices.get(vid);
      if (!v) {
        const p = vertexPosition(vid);
        v = { id: vid, x: p.x, y: p.y, hexes: [], edges: [] };
        vertices.set(vid, v);
      }
      v.hexes.push(tile.id);
    }
    for (let k = 0; k < 6; k++) {
      const a = vids[k];
      const b = vids[(k + 1) % 6];
      const eid = edgeIdOf(a, b);
      let e = edges.get(eid);
      if (!e) {
        const va = vertices.get(a)!;
        const vb = vertices.get(b)!;
        const mx = (va.x + vb.x) / 2;
        const my = (va.y + vb.y) / 2;
        e = {
          id: eid,
          a,
          b,
          x1: va.x,
          y1: va.y,
          x2: vb.x,
          y2: vb.y,
          mx,
          my,
          angleDeg: (Math.atan2(vb.y - va.y, vb.x - va.x) * 180) / Math.PI,
          hexes: [],
        };
        edges.set(eid, e);
        va.edges.push(eid);
        vb.edges.push(eid);
      }
      e.hexes.push(tile.id);
    }
  }

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const v of vertices.values()) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
  }
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };

  return { hexes: hexList, hexMap, vertices, edges, center, bounds: { minX, minY, maxX, maxY } };
}

/** Vértices das duas pontas de uma aresta (string → posição), para desenho de portos. */
export function edgeMidpoint(geo: IslandGeometry, edgeId: EdgeId): Pt | null {
  const e = geo.edges.get(edgeId);
  if (e) return { x: e.mx, y: e.my };
  const [a, b] = parseEdgeId(edgeId);
  const va = geo.vertices.get(a);
  const vb = geo.vertices.get(b);
  if (!va || !vb) return null;
  return { x: (va.x + vb.x) / 2, y: (va.y + vb.y) / 2 };
}

/** Vértices do grafo da ilha adjacentes por aresta. */
export function vertexNeighbors(geo: IslandGeometry, vid: VertexId): VertexId[] {
  const v = geo.vertices.get(vid);
  if (!v) return [];
  const out: VertexId[] = [];
  for (const eid of v.edges) {
    const e = geo.edges.get(eid);
    if (!e) continue;
    out.push(e.a === vid ? e.b : e.a);
  }
  return out;
}
