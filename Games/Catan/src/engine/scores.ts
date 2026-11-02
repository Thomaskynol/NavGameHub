// Pontuação: maior estrada, maior exército, VP pública/total e taxa de banco (portos).
import { LARGEST_ARMY_MIN, LONGEST_ROAD_MIN, VICTORY_POINTS } from '../shared/constants';
import type { PlayerId, ResourceKind, VertexId, EdgeId } from '../shared/constants';
import type { GameState } from '../shared/types';
import { buildingAt } from './legal';
import { pushPublic } from './history';

/**
 * Maior estrada: DFS de trilha (sem repetir aresta) sobre as estradas próprias.
 * Não atravessa vértice com construção adversária (chegar até ele é permitido).
 * Ciclos contam como caminho contínuo; bifurcação não soma (sem repetir aresta,
 * o ramo é forçado a retornar pelo mesmo caminho — bloqueado).
 */
export function computeLongestRoad(state: GameState, playerId: PlayerId): number {
  const ownEdges: EdgeId[] = state.roads.filter((r) => r.playerId === playerId).map((r) => r.edgeId);
  if (ownEdges.length === 0) return 0;

  const adjacency = new Map<VertexId, { edge: EdgeId; to: VertexId }[]>();
  for (const e of ownEdges) {
    const [a, b] = state.board.edgeEndpoints[e];
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    (adjacency.get(a) as { edge: EdgeId; to: VertexId }[]).push({ edge: e, to: b });
    (adjacency.get(b) as { edge: EdgeId; to: VertexId }[]).push({ edge: e, to: a });
  }

  const blocked = (v: VertexId): boolean => {
    const b = buildingAt(state, v);
    return !!b && b.playerId !== playerId;
  };

  const used = new Set<EdgeId>();
  const dfs = (v: VertexId, start: VertexId): number => {
    let best = 0;
    for (const { edge, to } of adjacency.get(v) ?? []) {
      if (used.has(edge)) continue;
      // Fechar o laço de volta no vértice de início (adversário) atravessaria a construção.
      if (blocked(to) && to === start) continue;
      used.add(edge);
      // Chegar até vértice adversário é permitido (fim de trilha); continuar a partir dele, não.
      const step = blocked(to) ? 0 : dfs(to, start);
      if (1 + step > best) best = 1 + step;
      used.delete(edge);
    }
    return best;
  };

  let longest = 0;
  for (const v of adjacency.keys()) {
    const len = dfs(v, v);
    if (len > longest) longest = len;
  }
  return longest;
}

/**
 * Recalcula os títulos (maior estrada e maior exército) e registra eventos quando mudam.
 * Critério: max >= mínimo; detentor em empate mantém; se o detentor perde e o máximo
 * fica empatado entre >= 2 sem detentor -> sem dono.
 */
export function recomputeTitles(state: GameState): void {
  recomputeTitle(state, 'largestRoad', state.players.map((p) => computeLongestRoad(state, p.id)), LONGEST_ROAD_MIN, 'largest_road');
  recomputeTitle(state, 'largestArmy', state.players.map((p) => p.knightsPlayed), LARGEST_ARMY_MIN, 'largest_army');
}

function recomputeTitle(
  state: GameState,
  field: 'largestRoad' | 'largestArmy',
  values: number[],
  min: number,
  eventType: 'largest_road' | 'largest_army',
): void {
  const max = values.reduce((a, b) => (b > a ? b : a), 0);
  const holder = state[field].playerId;
  let nextHolder: PlayerId | null = null;
  if (max >= min) {
    const leaders = state.players.filter((_, i) => values[i] === max).map((p) => p.id);
    if (holder && leaders.includes(holder)) nextHolder = holder; // empate com detentor => mantém
    else if (leaders.length === 1) nextHolder = leaders[0];
    else nextHolder = null; // >= 2 empatados sem detentor => sem dono
  }
  const prev = state[field];
  if (prev.playerId !== nextHolder || prev.value !== max) {
    state[field] = { playerId: nextHolder, value: max };
    pushPublic(state, { type: eventType, playerId: nextHolder, value: max });
  }
}

/** Pontos públicos: construções + títulos (sem pontos ocultos de VP). */
export function publicVictoryPoints(state: GameState, playerId: PlayerId): number {
  let pts = 0;
  for (const b of state.buildings) {
    if (b.playerId !== playerId) continue;
    pts += b.kind === 'city' ? VICTORY_POINTS.city : VICTORY_POINTS.settlement;
  }
  if (state.largestRoad.playerId === playerId && state.largestRoad.value >= LONGEST_ROAD_MIN) pts += VICTORY_POINTS.largestRoad;
  if (state.largestArmy.playerId === playerId && state.largestArmy.value >= LARGEST_ARMY_MIN) pts += VICTORY_POINTS.largestArmy;
  return pts;
}

/** Pontos totais: públicos + cartas de VP na mão (contam imediatamente na compra). */
export function totalVictoryPoints(state: GameState, playerId: PlayerId): number {
  const me = state.players.find((p) => p.id === playerId);
  const hidden = me ? me.devCards.filter((c) => c.kind === 'victoryPoint').length * VICTORY_POINTS.hiddenVictoryPoint : 0;
  return publicVictoryPoints(state, playerId) + hidden;
}

/**
 * Melhor taxa marítima para RECEBER `resource`: 2 (porto especial do recurso),
 * 3 (porto genérico) ou 4 (padrão). Controle = construção própria em qualquer
 * um dos 2 vértices do porto; peça adversária no hex não bloqueia (FAQ).
 */
export function bestBankRate(state: GameState, playerId: PlayerId, resource: ResourceKind): 2 | 3 | 4 {
  let rate: 2 | 3 | 4 = 4;
  for (const port of state.board.ports) {
    const controlled = port.vertexIds.some((v) => buildingAt(state, v)?.playerId === playerId);
    if (!controlled) continue;
    if (port.kind === resource) return 2;
    if (port.kind === 'generic') rate = 3;
  }
  return rate;
}
