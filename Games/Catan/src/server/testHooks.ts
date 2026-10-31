// Hooks de teste — ativos SOMENTE com CATAN_TEST_HOOKS=1 (nunca em produção normal).
// Registrados como evento extra `hook` no socket; sem a env, o evento não existe.
import { ERROR_CODES } from '../shared/protocol';
import type { EngineError, GameState } from '../shared/types';
import type { EdgeId, VertexId } from '../shared/constants';

export type HookCommand =
  | { type: 'force_next_dice'; d1: number; d2: number }
  | { type: 'load_near_win_fixture' }
  | { type: 'seed_rng'; seed: string };

export function validateHook(raw: unknown): { ok: true; value: HookCommand } | { ok: false; error: EngineError } {
  const err = (message: string): { ok: false; error: EngineError } => ({ ok: false, error: { code: ERROR_CODES.INVALID_PAYLOAD, message } });
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return err('Hook inválido');
  const p = raw as Record<string, unknown>;
  switch (p.type) {
    case 'force_next_dice': {
      const d1 = p.d1;
      const d2 = p.d2;
      if (!Number.isInteger(d1) || !Number.isInteger(d2) || (d1 as number) < 1 || (d1 as number) > 6 || (d2 as number) < 1 || (d2 as number) > 6) {
        return err('force_next_dice: d1 e d2 devem ser inteiros entre 1 e 6');
      }
      return { ok: true, value: { type: 'force_next_dice', d1: d1 as number, d2: d2 as number } };
    }
    case 'load_near_win_fixture':
      return { ok: true, value: { type: 'load_near_win_fixture' } };
    case 'seed_rng': {
      if (typeof p.seed !== 'string' || p.seed.length === 0 || p.seed.length > 64) return err('seed_rng: seed deve ter 1–64 caracteres');
      return { ok: true, value: { type: 'seed_rng', seed: p.seed } };
    }
    default:
      return err('Hook desconhecido');
  }
}

const FIXTURE_RESOURCES = { brick: 3, lumber: 3, wool: 4, grain: 4, ore: 3 } as const;

/**
 * Instala estado sintético próximo da vitória para o jogador ativo:
 * 2 cidades + 2 assentamentos (6 pts) + Maior Estrada (2) = 8 pts, 6 estradas em
 * caminho simples, e recursos para comprar desenvolvimento e estrada+assentamento.
 * Mantém o tabuleiro real; só usa posições livres verificadas.
 */
export function loadNearWinFixture(state: GameState): { ok: true; state: GameState } | { ok: false; error: EngineError } {
  const fail = (message: string): { ok: false; error: EngineError } => ({ ok: false, error: { code: ERROR_CODES.INVALID_STATE, message } });
  const active = state.players[state.activeIndex];
  if (!active) return fail('Sem jogador ativo');

  // Adjacência por aresta (grafo completo do tabuleiro) + id real de cada aresta.
  const adj = new Map<VertexId, Set<VertexId>>();
  const edgeIdByPair = new Map<string, EdgeId>();
  const pairKey = (a: VertexId, b: VertexId): string => [a, b].sort().join('|');
  for (const [edgeId, ends] of Object.entries(state.board.edgeEndpoints)) {
    const [a, b] = ends;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
    edgeIdByPair.set(pairKey(a, b), edgeId);
  }
  const occupiedEdges = new Set(state.roads.map((r) => r.edgeId));
  const buildingAt = new Map<VertexId, string>();
  for (const b of state.buildings) buildingAt.set(b.vertexId, b.playerId);

  /** Caminho simples de 6 arestas (7 vértices) com as restrições de posição. */
  const findPath = (): VertexId[] | null => {
    const path: VertexId[] = [];
    const used = new Set<VertexId>();
    const chosenFree = (v: VertexId): boolean => {
      if (buildingAt.has(v)) return false;
      for (const n of adj.get(v) ?? []) if (buildingAt.has(n)) return false; // regra de distância
      return true;
    };
    const dfs = (v: VertexId, depth: number): boolean => {
      path.push(v);
      used.add(v);
      if (depth === 6) {
        // Vértices escolhidos (0,2,4,6) não podem ser adjacentes entre si.
        const chosen = [path[0], path[2], path[4], path[6]];
        for (const c of chosen) if (!chosenFree(c)) {
          path.pop();
          used.delete(v);
          return false;
        }
        for (let i = 0; i < chosen.length; i += 1) {
          for (let j = i + 1; j < chosen.length; j += 1) {
            if ((adj.get(chosen[i]) ?? new Set()).has(chosen[j])) {
              path.pop();
              used.delete(v);
              return false;
            }
          }
        }
        // Arestas do caminho livres.
        for (let i = 0; i < 6; i += 1) {
          if (occupiedEdges.has(edgeIdByPair.get(pairKey(path[i], path[i + 1]))!)) {
            path.pop();
            used.delete(v);
            return false;
          }
        }
        return true;
      }
      for (const n of adj.get(v) ?? []) {
        if (used.has(n)) continue;
        const [a, b] = [v, n];
        if (occupiedEdges.has(edgeIdByPair.get(pairKey(a, b))!)) continue;
        if (dfs(n, depth + 1)) return true;
      }
      path.pop();
      used.delete(v);
      return false;
    };
    for (const start of state.board.vertices) {
      path.length = 0;
      used.clear();
      if (dfs(start, 0)) return [...path];
    }
    return null;
  };

  const path = findPath();
  if (!path) return fail('Sem caminho livre no tabuleiro atual para a fixture');
  const roads = path.slice(0, 6).map((v, i) => ({ edgeId: edgeIdByPair.get(pairKey(v, path[i + 1]))!, playerId: active.id }));
  const buildings = [
    { vertexId: path[0], playerId: active.id, kind: 'settlement' as const },
    { vertexId: path[2], playerId: active.id, kind: 'city' as const },
    { vertexId: path[4], playerId: active.id, kind: 'city' as const },
    { vertexId: path[6], playerId: active.id, kind: 'settlement' as const },
  ];
  const next: GameState = {
    ...state,
    roads: [...state.roads, ...roads],
    buildings: [...state.buildings, ...buildings],
    players: state.players.map((p) =>
      p.id === active.id
        ? {
            ...p,
            resources: { ...FIXTURE_RESOURCES },
            pieces: { roads: p.pieces.roads - 6, settlements: p.pieces.settlements - 2, cities: p.pieces.cities - 2 },
          }
        : p,
    ),
    largestRoad: { playerId: active.id, value: 6 },
  };
  return { ok: true, state: next };
}
