// Geração determinística do tabuleiro a partir da seed (apenas o tabuleiro).
import {
  NUMBER_TOKENS,
  RED_NUMBERS,
  TERRAIN_COUNTS,
  TERRAIN_RESOURCE,
} from '../shared/constants';
import type { TerrainKind } from '../shared/constants';
import type { BoardLayout, HexTile } from '../shared/types';
import { mulberry32, hashString, shuffleInPlace } from './rng';
import { buildIslandTopology, buildPorts } from './topology';

/** Tentativas máximas de rejection sampling (com a distribuição oficial converge sempre). */
const MAX_ATTEMPTS = 10000;

function terrainDeck(): TerrainKind[] {
  const out: TerrainKind[] = [];
  for (const [kind, count] of Object.entries(TERRAIN_COUNTS) as [TerrainKind, number][]) {
    for (let i = 0; i < count; i++) out.push(kind);
  }
  return out; // 19 terrenos
}

/** Nenhum par de hexes adjacentes ambos com ficha vermelha (6 ou 8). */
function hasAdjacentReds(hexes: HexTile[], neighbors: Record<string, string[]>): boolean {
  const byId = new Map(hexes.map((h) => [h.id, h]));
  for (const h of hexes) {
    if (h.number === null || !RED_NUMBERS.includes(h.number)) continue;
    for (const n of neighbors[h.id] ?? []) {
      const nh = byId.get(n);
      if (nh && nh.number !== null && RED_NUMBERS.includes(nh.number)) return true;
    }
  }
  return false;
}

/**
 * Mapa determinístico a partir da seed (apenas o tabuleiro; nunca usa a RNG de
 * dados/baralho). Embaralha terrenos + fichas com mulberry32(hash(seed)) e aplica
 * rejection sampling para proibir 6/8 adjacentes. Deserto sem ficha de número.
 */
export function generateBoard(boardSeed: string): BoardLayout {
  const topo = buildIslandTopology();
  const ports = buildPorts(topo);
  const rand = mulberry32(hashString(boardSeed));

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const terrains = shuffleInPlace(terrainDeck(), rand);
    const tokens = shuffleInPlace([...NUMBER_TOKENS], rand);
    const hexes: HexTile[] = [];
    let t = 0;
    for (const id of topo.hexIds) {
      const terrain = terrains[hexes.length];
      const number = terrain === 'desert' ? null : tokens[t++];
      hexes.push({ id, terrain, number });
    }
    if (hasAdjacentReds(hexes, topo.hexNeighbors)) continue;
    return {
      hexes,
      vertices: topo.vertices,
      edges: topo.edges,
      edgeEndpoints: topo.edgeEndpoints,
      vertexHexes: topo.vertexHexes,
      vertexEdges: topo.vertexEdges,
      hexEdges: topo.hexEdges,
      hexNeighbors: topo.hexNeighbors,
      ports,
    };
  }
  throw new Error(`generateBoard: falha ao gerar tabuleiro válido para seed "${boardSeed}"`);
}

/** Recurso produzido por um terreno (null no deserto). */
export function terrainResource(terrain: TerrainKind): (typeof TERRAIN_RESOURCE)[Exclude<TerrainKind, 'desert'>] | null {
  return terrain === 'desert' ? null : TERRAIN_RESOURCE[terrain];
}
