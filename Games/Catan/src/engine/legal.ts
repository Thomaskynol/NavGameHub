// Legalidade de construções e dicas para UI. Validações compartilhadas por comandos e hints.
import { ERROR_CODES } from '../shared/protocol';
import type { Building, EngineError, GameState, Road } from '../shared/types';
import type { EdgeId, HexId, PlayerId, VertexId } from '../shared/constants';

export type Check = { ok: true } | { ok: false; error: EngineError };

export const OK: Check = { ok: true };

export function fail(code: string, message: string): Check {
  return { ok: false, error: { code, message } };
}

export function buildingAt(s: GameState, vertexId: VertexId): Building | undefined {
  return s.buildings.find((b) => b.vertexId === vertexId);
}

export function roadAt(s: GameState, edgeId: EdgeId): Road | undefined {
  return s.roads.find((r) => r.edgeId === edgeId);
}

export function playerById(s: GameState, id: PlayerId) {
  return s.players.find((p) => p.id === id);
}

export function hexExists(s: GameState, id: HexId): boolean {
  return s.board.hexes.some((h) => h.id === id);
}

export function edgeExists(s: GameState, id: EdgeId): boolean {
  return Object.prototype.hasOwnProperty.call(s.board.edgeEndpoints, id);
}

export function vertexExists(s: GameState, id: VertexId): boolean {
  return s.board.vertices.includes(id);
}

/** Vértices vizinhos de `v` (outras pontas das arestas de `v`). */
export function vertexNeighborVertices(s: GameState, v: VertexId): VertexId[] {
  const out: VertexId[] = [];
  for (const e of s.board.vertexEdges[v] ?? []) {
    const [a, b] = s.board.edgeEndpoints[e];
    out.push(a === v ? b : a);
  }
  return out;
}

/** Regra de distância: o vértice e seus 3 vizinhos sem construção de ninguém. */
export function passesDistanceRule(s: GameState, v: VertexId): boolean {
  if (buildingAt(s, v)) return false;
  return !vertexNeighborVertices(s, v).some((n) => buildingAt(s, n));
}

export function enemyBlocked(s: GameState, playerId: PlayerId, v: VertexId): boolean {
  const b = buildingAt(s, v);
  return !!b && b.playerId !== playerId;
}

/**
 * Conectividade da rede própria a partir de um (ou dois) vértices iniciais.
 * Regra: PODE chegar até vértice com construção adversária, mas NÃO atravessar
 * (não expande a partir dele). O ladrão não bloqueia (nunca é consultado).
 */
export function ownNetworkReaches(s: GameState, playerId: PlayerId, start: VertexId | [VertexId, VertexId]): boolean {
  const seeds = Array.isArray(start) ? start : [start];
  const visited = new Set<VertexId>();
  const queue: VertexId[] = [];
  for (const v of seeds) {
    if (!visited.has(v)) {
      visited.add(v);
      queue.push(v);
    }
  }
  while (queue.length > 0) {
    const u = queue.shift() as VertexId;
    if (buildingAt(s, u)?.playerId === playerId) return true;
    if (enemyBlocked(s, playerId, u)) continue; // não atravessa construção adversária
    for (const e of s.board.vertexEdges[u] ?? []) {
      if (roadAt(s, e)?.playerId !== playerId) continue;
      const [a, b] = s.board.edgeEndpoints[e];
      const v = a === u ? b : a;
      if (!visited.has(v)) {
        visited.add(v);
        queue.push(v);
      }
    }
  }
  return false;
}

/** Valida estrada comum/gratuita: aresta existe, livre e encosta na rede própria. */
export function checkRoadEdge(s: GameState, playerId: PlayerId, edgeId: EdgeId): Check {
  if (!edgeExists(s, edgeId)) return fail(ERROR_CODES.INVALID_POSITION, 'Aresta inexistente no tabuleiro.');
  if (roadAt(s, edgeId)) return fail(ERROR_CODES.INVALID_POSITION, 'Aresta já ocupada por uma estrada.');
  const [a, b] = s.board.edgeEndpoints[edgeId];
  if (!ownNetworkReaches(s, playerId, [a, b])) {
    return fail(ERROR_CODES.NOT_CONNECTED, 'Estrada deve encostar na sua rede (estrada ou construção).');
  }
  return OK;
}

/** Valida assentamento (após setup): vértice livre, distância e conexão à rede própria. */
export function checkSettlementVertex(s: GameState, playerId: PlayerId, vertexId: VertexId): Check {
  if (!vertexExists(s, vertexId)) return fail(ERROR_CODES.INVALID_POSITION, 'Vértice inexistente no tabuleiro.');
  if (buildingAt(s, vertexId)) return fail(ERROR_CODES.INVALID_POSITION, 'Vértice já ocupado.');
  if (!passesDistanceRule(s, vertexId)) {
    return fail(ERROR_CODES.DISTANCE_RULE, 'Regra de distância: os 3 vértices adjacentes devem estar livres.');
  }
  if (!ownNetworkReaches(s, playerId, vertexId)) {
    return fail(ERROR_CODES.NOT_CONNECTED, 'Assentamento deve estar ligado à sua rede por estradas.');
  }
  return OK;
}

/** Valida local de assentamento na preparação: livre + distância (sem exigir conexão). */
export function checkSetupSettlementVertex(s: GameState, vertexId: VertexId): Check {
  if (!vertexExists(s, vertexId)) return fail(ERROR_CODES.INVALID_POSITION, 'Vértice inexistente no tabuleiro.');
  if (buildingAt(s, vertexId)) return fail(ERROR_CODES.INVALID_POSITION, 'Vértice já ocupado.');
  if (!passesDistanceRule(s, vertexId)) {
    return fail(ERROR_CODES.DISTANCE_RULE, 'Regra de distância: os 3 vértices adjacentes devem estar livres.');
  }
  return OK;
}

/** Valida local de cidade: upgrade de assentamento próprio. */
export function checkCityVertex(s: GameState, playerId: PlayerId, vertexId: VertexId): Check {
  const b = buildingAt(s, vertexId);
  if (!b || b.playerId !== playerId || b.kind !== 'settlement') {
    return fail(ERROR_CODES.INVALID_POSITION, 'Cidade só pode substituir um dos seus assentamentos.');
  }
  return OK;
}

/** Vítimas do roubo: adversários com construção no hex. */
export function robberVictims(s: GameState, hexId: HexId, byPlayerId: PlayerId): PlayerId[] {
  const victims: PlayerId[] = [];
  for (const b of s.buildings) {
    if (b.playerId === byPlayerId) continue;
    if (victims.includes(b.playerId)) continue;
    const hexes = s.board.vertexHexes[b.vertexId] ?? [];
    if (hexes.includes(hexId)) victims.push(b.playerId);
  }
  return victims;
}

/** Hexes do vértice -> vértices do hex (via arestas). */
export function verticesOfHex(s: GameState, hexId: HexId): VertexId[] {
  const edges = s.board.hexEdges[hexId] ?? [];
  const verts = new Set<VertexId>();
  for (const e of edges) {
    const [a, b] = s.board.edgeEndpoints[e];
    verts.add(a);
    verts.add(b);
  }
  return [...verts];
}

// ---------- Dicas para UI (contrato do motor) ----------

export function legalBuildTargets(
  s: GameState,
  playerId: PlayerId,
): {
  settlementVertices: VertexId[];
  cityVertices: VertexId[];
  roadEdges: EdgeId[];
  freeRoadEdges: EdgeId[];
  setupVertices: VertexId[];
  setupEdges: EdgeId[];
} {
  const empty: {
    settlementVertices: VertexId[];
    cityVertices: VertexId[];
    roadEdges: EdgeId[];
    freeRoadEdges: EdgeId[];
    setupVertices: VertexId[];
    setupEdges: EdgeId[];
  } = { settlementVertices: [], cityVertices: [], roadEdges: [], freeRoadEdges: [], setupVertices: [], setupEdges: [] };
  if (s.phase === 'game_over') return { ...empty };
  const activeId = currentActorId(s);
  if (activeId !== playerId) return { ...empty };
  const me = playerById(s, playerId);
  if (!me) return { ...empty };

  if (s.phase === 'setup_settlement') {
    return {
      ...empty,
      setupVertices: s.board.vertices.filter((v) => passesDistanceRule(s, v)),
    };
  }
  if (s.phase === 'setup_road') {
    const last = s.setup.lastSettlementVertex;
    if (!last) return { ...empty };
    return {
      ...empty,
      setupEdges: s.board.edges.filter((e) => !roadAt(s, e) && s.board.edgeEndpoints[e].includes(last)),
    };
  }
  if (s.phase === 'dev_road_building') {
    const pending = s.pending;
    if (!pending || pending.type !== 'road_building' || pending.playerId !== playerId) return { ...empty };
    const free = s.board.edges.filter((e) => checkRoadEdge(s, playerId, e).ok);
    return { ...empty, roadEdges: free, freeRoadEdges: free };
  }
  if (s.phase === 'action') {
    // Nota: hints cobrem distância+conexão+limite de peças (custo de recursos fica para o chamador).
    const settlementVertices =
      me.pieces.settlements > 0 ? s.board.vertices.filter((v) => checkSettlementVertex(s, playerId, v).ok) : [];
    const cityVertices = s.buildings.filter((b) => b.playerId === playerId && b.kind === 'settlement').map((b) => b.vertexId);
    const roadEdges = me.pieces.roads > 0 ? s.board.edges.filter((e) => checkRoadEdge(s, playerId, e).ok) : [];
    return { ...empty, settlementVertices, cityVertices, roadEdges };
  }
  return { ...empty };
}

export function legalRobberHexes(s: GameState, playerId: PlayerId): HexId[] {
  if (s.phase !== 'robber') return [];
  const pending = s.pending;
  if (!pending || pending.type !== 'robber') return [];
  if (currentActorId(s) !== playerId) return [];
  return s.board.hexes.map((h) => h.id).filter((id) => id !== s.robberHexId);
}

/** Jogador corrente: fila de setup ou jogador ativo. */
export function currentActorId(s: GameState): PlayerId | null {
  if (s.phase === 'setup_settlement' || s.phase === 'setup_road') {
    return s.setup.queue[s.setup.pos] ?? null;
  }
  return s.players[s.activeIndex]?.id ?? null;
}
