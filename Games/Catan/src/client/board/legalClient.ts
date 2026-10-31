// Destaques legais calculados no cliente DELEGANDO AO MOTOR REAL (src/engine).
// Não há mais réplica de regras: o GameView é reidratado num GameState parcial
// (board estático reconstruído de forma determinística a partir do boardSeed,
// peças derivadas das contagens públicas) e as funções puras do motor são chamadas.
import type { EdgeId, HexId, PlayerId, ResourceKind, VertexId } from '../../shared/constants';
import { PIECE_LIMITS } from '../../shared/constants';
import type { GameView } from '../../shared/protocol';
import type { Building, GameState, Pending, PlayerState, Road } from '../../shared/types';
import { generateBoard } from '../../engine/mapgen';
import {
  bestBankRate as engineBestBankRate,
  computeLongestRoad as engineComputeLongestRoad,
  publicVictoryPoints as enginePublicVictoryPoints,
  totalVictoryPoints as engineTotalVictoryPoints,
} from '../../engine/scores';
import {
  legalBuildTargets as engineLegalBuildTargets,
  legalRobberHexes as engineLegalRobberHexes,
  robberVictims as engineRobberVictims,
} from '../../engine/legal';
import { buildIslandGeometry, type IslandGeometry } from './geometry';

export interface LegalTargets {
  settlementVertices: VertexId[];
  cityVertices: VertexId[];
  roadEdges: EdgeId[];
  freeRoadEdges: EdgeId[];
  setupVertices: VertexId[];
  setupEdges: EdgeId[];
}

// Cache por boardSeed: o layout estático (vertices/edges/portos) é imutável na partida.
const topoCache = new Map<string, ReturnType<typeof generateBoard>>();

function staticBoard(seed: string): ReturnType<typeof generateBoard> {
  let b = topoCache.get(seed);
  if (!b) {
    b = generateBoard(seed);
    topoCache.set(seed, b);
  }
  return b;
}

/** Peças restantes vindas do servidor (`piecesLeft` já é o suprimento restante). */
function piecesFor(view: GameView, playerId: PlayerId): PlayerState['pieces'] {
  const p = view.players.find((x) => x.id === playerId);
  // Views mock podem omitir piecesLeft; assume o suprimento inicial nesse caso.
  return {
    roads: p?.piecesLeft.roads ?? PIECE_LIMITS.roads,
    settlements: p?.piecesLeft.settlements ?? PIECE_LIMITS.settlements,
    cities: p?.piecesLeft.cities ?? PIECE_LIMITS.cities,
  };
}

/** Pendência do motor derivada da PendingView (views antigas/mock podem omitir campos). */
function rehydratePending(pending: GameView['pending']): Pending | null {
  if (!pending) return null;
  switch (pending.type) {
    case 'discard':
      return { type: 'discard', waitingOn: [...pending.waitingOn] };
    case 'robber':
      return { type: 'robber' };
    case 'road_building':
      return pending.playerId !== undefined && pending.roadsLeft !== undefined
        ? { type: 'road_building', playerId: pending.playerId, roadsLeft: pending.roadsLeft }
        : null;
    case 'monopoly':
      return pending.playerId !== undefined ? { type: 'monopoly', playerId: pending.playerId } : null;
    case 'year_of_plenty':
      return pending.playerId !== undefined ? { type: 'year_of_plenty', playerId: pending.playerId } : null;
    default:
      return null;
  }
}

/** Reidrata um GameState parcial a partir do GameView para chamar o motor real. */
function rehydrate(view: GameView, youId: PlayerId): GameState {
  const board = staticBoard(view.board.seed);
  const buildings: Building[] = view.board.buildings.map((b) => ({
    vertexId: b.vertexId,
    playerId: b.playerId,
    kind: b.kind,
  }));
  const roads: Road[] = view.board.roads.map((r) => ({ edgeId: r.edgeId, playerId: r.playerId }));

  const players: PlayerState[] = view.players.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    resources: p.id === youId ? { ...view.you.resources } : { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 },
    devCards: p.id === youId ? view.you.devCards.map((c) => ({ id: c.id, kind: c.kind })) : [],
    boughtThisTurn: p.id === youId ? view.you.boughtThisTurn : [],
    playedActionCardThisTurn: p.id === youId ? view.you.playedActionCardThisTurn : false,
    knightsPlayed: p.knightsPlayed,
    pieces: piecesFor(view, p.id),
  }));

  // Fila de setup: estado real do motor exposto no GameView (snake + posição).
  const queue = view.setupQueue.length > 0 ? [...view.setupQueue] : view.players.map((p) => p.id);
  const activeIndex = Math.max(0, view.players.findIndex((p) => p.id === view.activePlayerId));

  return {
    // A view de lobby nunca é reidratada (a tela de jogo só monta com phase !== 'lobby').
    phase: view.phase as GameState['phase'],
    players,
    activeIndex,
    board,
    buildings,
    roads,
    robberHexId: view.board.robberHexId,
    bank: view.bankCounts,
    devDeck: [], // nunca exposto ao cliente; irrelevante para hints
    dice: view.dice,
    returnPhase: null,
    setup: {
      queue,
      pos: view.setupQueue.length > 0 ? view.setupPos : 0,
      lastSettlementVertex: view.setupLastSettlementVertex,
    },
    pending: rehydratePending(view.pending),
    largestRoad: { playerId: null, value: 0 },
    largestArmy: { playerId: null, value: 0 },
    offers: [],
    history: { events: [], meta: {} },
    historySeq: view.version,
    version: view.version,
    winnerId: view.winnerId,
    boardSeed: view.board.seed,
  };
}

export function getGeometry(view: GameView): IslandGeometry {
  return buildIslandGeometry(view.board.hexes);
}

export function legalBuildTargets(view: GameView, _geo: IslandGeometry, youId: PlayerId): LegalTargets {
  const state = rehydrate(view, youId);
  return engineLegalBuildTargets(state, youId);
}

export function legalRobberHexes(view: GameView, youId: PlayerId): HexId[] {
  const state = rehydrate(view, youId);
  return engineLegalRobberHexes(state, youId);
}

export function robberVictims(view: GameView, _geo: IslandGeometry, hexId: HexId, byPlayerId: PlayerId): PlayerId[] {
  const state = rehydrate(view, byPlayerId);
  return engineRobberVictims(state, hexId, byPlayerId);
}

export function bestBankRate(view: GameView, resource: ResourceKind): 2 | 3 | 4 {
  const state = rehydrate(view, view.you.id);
  return engineBestBankRate(state, view.you.id, resource);
}

export function publicVictoryPoints(view: GameView, playerId: PlayerId): number {
  const state = rehydrate(view, view.you.id);
  return enginePublicVictoryPoints(state, playerId);
}

export function totalVictoryPoints(view: GameView, playerId: PlayerId): number {
  const state = rehydrate(view, view.you.id);
  return engineTotalVictoryPoints(state, playerId);
}

export function computeLongestRoad(view: GameView, _geo: IslandGeometry, playerId: PlayerId): number {
  const state = rehydrate(view, view.you.id);
  return engineComputeLongestRoad(state, playerId);
}

export { generateBoard };
