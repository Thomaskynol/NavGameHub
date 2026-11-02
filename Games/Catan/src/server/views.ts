// Projeções: GameView personalizada (público x privado) e histórico em pt-BR.
// NUNCA envia: devDeck, hashes de recuperação, mãos alheias, tipo de carta roubada
// (evento privado), dados internos.
import {
  BANK_SIZE_PER_RESOURCE,
  CHAT_VIEW_LIMIT,
  HISTORY_LIMIT,
  PIECE_LIMITS,
  RESOURCE_KINDS,
} from '../shared/constants';
import type { PlayerColor, PlayerId, ResourceKind } from '../shared/constants';
import type {
  BoardView,
  GameView,
  HistoryView,
  OfferView,
  PendingView,
  PublicPlayerView,
  YouView,
} from '../shared/protocol';
import type { GameState, HistoryEvent, HistoryMeta, Pending } from '../shared/types';
import type { GameEngineApi } from './engine';
import type { Room } from './rooms';

export const RESOURCE_PT: Record<ResourceKind, string> = {
  brick: 'tijolo',
  lumber: 'madeira',
  wool: 'lã',
  grain: 'grão',
  ore: 'minério',
};

const COLOR_PT: Record<PlayerColor, string> = {
  red: 'vermelho',
  orange: 'laranja',
  white: 'branco',
  blue: 'azul',
};

function fmtPatch(p: Partial<Record<ResourceKind, number>>): string {
  const parts = Object.entries(p)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([k, n]) => `${n} ${RESOURCE_PT[k as ResourceKind]}`);
  return parts.length > 0 ? parts.join(', ') : 'nada';
}

function pluralCards(n: number): string {
  return n === 1 ? '1 carta' : `${n} cartas`;
}

/** Renderiza um evento para a audiência `viewerId` (eventos privados já filtrados antes). */
export function renderHistoryEvent(ev: HistoryEvent, viewerId: PlayerId, nameOf: (id: PlayerId) => string): HistoryView {
  const name = (id: PlayerId): string => nameOf(id);
  const base = { seq: ev.seq, kind: ev.type, playerId: undefined as PlayerId | undefined, private: false };
  switch (ev.type) {
    case 'game_started': {
      const list = ev.players.map((p) => `${p.name} (${COLOR_PT[p.color]})`).join(', ');
      return { ...base, text: `Partida iniciada — ${list}.` };
    }
    case 'setup_placed': {
      const spots = [ev.vertexId, ev.edgeId].filter((x): x is string => x !== undefined).join(', ');
      return {
        ...base,
        playerId: ev.playerId,
        text: `${name(ev.playerId)} colocou ${ev.second ? 'o 2º assentamento' : 'um assentamento'}${ev.edgeId ? ' e uma estrada' : ''} (${spots}).`,
      };
    }
    case 'dice':
      return { ...base, playerId: ev.playerId, text: `${name(ev.playerId)} rolou ${ev.d1}+${ev.d2}=${ev.d1 + ev.d2}.` };
    case 'production': {
      const parts = RESOURCE_KINDS.filter((k) => (ev.byResource[k]?.length ?? 0) > 0).map(
        (k) => `${RESOURCE_PT[k]} → ${(ev.byResource[k] ?? []).map(name).join(', ')}`,
      );
      return { ...base, text: parts.length > 0 ? `Produção: ${parts.join('; ')}.` : 'Sem produção.' };
    }
    case 'robber_moved':
      return { ...base, playerId: ev.playerId, text: `${name(ev.playerId)} moveu o ladrão para o hex ${ev.hexId}.` };
    case 'stolen': {
      const audience = ev.playerId === viewerId || ev.victimId === viewerId;
      const detail = ev.resource ? (audience ? ` (${RESOURCE_PT[ev.resource]})` : '') : ' (sem cartas para roubar)';
      return {
        ...base,
        playerId: ev.playerId,
        private: audience && ev.resource !== undefined,
        text: ev.resource
          ? `${name(ev.playerId)} roubou uma carta${detail} de ${name(ev.victimId)}.`
          : `${name(ev.playerId)} tentou roubar ${name(ev.victimId)}${detail}.`,
      };
    }
    case 'resources_private': {
      const what = ev.reason === 'discard' ? 'Você descartou' : 'Você recebeu do 2º assentamento';
      return { ...base, playerId: ev.playerId, private: true, text: `${what}: ${fmtPatch(ev.resources)}.` };
    }
    case 'discarded':
      return { ...base, playerId: ev.playerId, text: `${name(ev.playerId)} descartou ${pluralCards(ev.count)}.` };
    case 'built': {
      const kindPt = ev.kind === 'road' ? 'uma estrada' : ev.kind === 'settlement' ? 'um assentamento' : 'uma cidade';
      const spot = ev.edgeId ?? ev.vertexId;
      return { ...base, playerId: ev.playerId, text: `${name(ev.playerId)} construiu ${kindPt}${spot ? ` (${spot})` : ''}.` };
    }
    case 'bought_dev_card':
      return { ...base, playerId: ev.playerId, text: `${name(ev.playerId)} comprou uma carta de desenvolvimento.` };
    case 'played_dev_card': {
      let what: string;
      switch (ev.card) {
        case 'knight':
          what = 'um Cavaleiro';
          break;
        case 'roadBuilding':
          what = `Construção de Estradas${ev.freeRoads !== undefined ? ` (${ev.freeRoads} grátis)` : ''}`;
          break;
        case 'monopoly':
          what = `Monopólio de ${ev.monopoly ? RESOURCE_PT[ev.monopoly] : 'recurso'}`;
          break;
        case 'yearOfPlenty':
          what = `Ano de Fartura${ev.takes && ev.takes.length > 0 ? ` (${ev.takes.map((r) => RESOURCE_PT[r]).join(', ')})` : ''}`;
          break;
        case 'victoryPoint':
          what = 'um Ponto de Vitória';
          break;
      }
      return { ...base, playerId: ev.playerId, text: `${name(ev.playerId)} jogou ${what}.` };
    }
    case 'bank_trade':
      return {
        ...base,
        playerId: ev.playerId,
        text: `${name(ev.playerId)} trocou no banco: ${fmtPatch(ev.give)} por ${fmtPatch(ev.want)}.`,
      };
    case 'trade_proposed':
      return { ...base, playerId: ev.playerId, text: `${name(ev.playerId)} propôs uma troca para ${name(ev.toPlayerId)}.` };
    case 'trade_accepted':
      return { ...base, playerId: ev.playerId, text: `${name(ev.byPlayerId)} aceitou a troca de ${name(ev.playerId)}.` };
    case 'trade_rejected':
      return { ...base, playerId: ev.playerId, text: `${name(ev.byPlayerId)} recusou a troca de ${name(ev.playerId)}.` };
    case 'trade_cancelled':
      return { ...base, playerId: ev.playerId, text: `${name(ev.playerId)} cancelou a troca proposta.` };
    case 'turn_ended':
      return { ...base, playerId: ev.playerId, text: `${name(ev.playerId)} encerrou o turno; agora joga ${name(ev.nextPlayerId)}.` };
    case 'largest_road':
      return {
        ...base,
        playerId: ev.playerId ?? undefined,
        text:
          ev.playerId === null
            ? `Maior Estrada sem dono (comprimento ${ev.value}).`
            : `${name(ev.playerId)} conquistou a Maior Estrada (${ev.value}).`,
      };
    case 'largest_army':
      return {
        ...base,
        playerId: ev.playerId ?? undefined,
        text:
          ev.playerId === null
            ? `Maior Exército sem dono (${ev.value} cavaleiros).`
            : `${name(ev.playerId)} conquistou o Maior Exército (${ev.value} cavaleiros).`,
      };
    case 'victory':
      return { ...base, playerId: ev.playerId, text: `${name(ev.playerId)} venceu a partida com ${ev.points} pontos!` };
  }
}

function canSee(meta: HistoryMeta | undefined, viewerId: PlayerId): boolean {
  if (!meta || meta.visibility === 'public') return true;
  return (meta.audience ?? []).includes(viewerId);
}

function buildPendingView(pending: Pending, activePlayerId: PlayerId | null, youId: PlayerId): PendingView {
  const waitingOn = pending.type === 'discard' ? pending.waitingOn : pending.type === 'robber' ? (activePlayerId ? [activePlayerId] : []) : [pending.playerId];
  const yourAction =
    pending.type === 'discard'
      ? pending.waitingOn.includes(youId)
      : pending.type === 'robber'
        ? activePlayerId === youId
        : pending.playerId === youId;
  const view: PendingView = { type: pending.type, yourAction, waitingOn };
  if (pending.type !== 'discard' && pending.type !== 'robber') view.playerId = pending.playerId;
  if (pending.type === 'road_building') view.roadsLeft = pending.roadsLeft;
  return view;
}

function controlledPorts(state: GameState, youId: PlayerId): YouView['ports'] {
  const owned = new Set(state.buildings.filter((b) => b.playerId === youId).map((b) => b.vertexId));
  return state.board.ports.filter((p) => p.vertexIds.some((v) => owned.has(v))).map((p) => ({ id: p.id, kind: p.kind }));
}

/** Projeção personalizada do estado de jogo. */
export function buildGameView(engine: GameEngineApi, state: GameState, room: Room, youId: PlayerId, chat: GameView['chat']): GameView {
  const nameOf = (id: PlayerId): string => state.players.find((p) => p.id === id)?.name ?? room.members.get(id)?.name ?? '???';
  const you = state.players.find((p) => p.id === youId);
  const youMember = room.members.get(youId);
  const players: PublicPlayerView[] = state.players.map((p) => {
    const member = room.members.get(p.id);
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      connected: member?.connected ?? false,
      isHost: member?.isHost ?? false,
      ready: member?.ready ?? false,
      resourcesCount: RESOURCE_KINDS.reduce((n, k) => n + p.resources[k], 0),
      devCardsCount: p.devCards.length,
      knightsPlayed: p.knightsPlayed,
      longestRoadLength: engine.computeLongestRoad(state, p.id),
      hasLargestRoad: state.largestRoad.playerId === p.id,
      hasLargestArmy: state.largestArmy.playerId === p.id,
      publicVictoryPoints: engine.publicVictoryPoints(state, p.id),
      piecesLeft: { ...p.pieces },
    };
  });
  const youView: YouView = you
    ? {
        id: you.id,
        name: you.name,
        color: you.color,
        resources: { ...you.resources },
        devCards: you.devCards.map((c) => ({ id: c.id, kind: c.kind })),
        victoryPoints: engine.totalVictoryPoints(state, youId),
        bankRate: Math.min(...RESOURCE_KINDS.map((r) => engine.bestBankRate(state, youId, r))) as 2 | 3 | 4,
        ports: controlledPorts(state, youId),
        boughtThisTurn: [...you.boughtThisTurn],
        playedActionCardThisTurn: you.playedActionCardThisTurn,
      }
    : {
        id: youId,
        name: youMember?.name ?? '???',
        color: youMember?.color ?? 'white',
        resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 },
        devCards: [],
        victoryPoints: 0,
        bankRate: 4,
        ports: [],
        boughtThisTurn: [],
        playedActionCardThisTurn: false,
      };
  const board: BoardView = {
    seed: state.boardSeed,
    hexes: state.board.hexes,
    ports: state.board.ports,
    buildings: state.buildings.map((b) => ({ vertexId: b.vertexId, playerId: b.playerId, kind: b.kind })),
    roads: state.roads.map((r) => ({ edgeId: r.edgeId, playerId: r.playerId })),
    robberHexId: state.robberHexId,
  };
  const offers: OfferView[] = state.offers.map((o) => ({
    id: o.id,
    fromPlayerId: o.fromPlayerId,
    toPlayerId: o.toPlayerId,
    give: { ...o.give },
    want: { ...o.want },
  }));
  const history: HistoryView[] = state.history.events
    .filter((ev) => canSee(state.history.meta[ev.seq], youId))
    .slice(-HISTORY_LIMIT)
    .map((ev) => renderHistoryEvent(ev, youId, nameOf));
  const bankCounts: Record<ResourceKind, number> = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
  for (const r of RESOURCE_KINDS) bankCounts[r] = state.bank[r];
  return {
    roomCode: room.code,
    roomName: room.name,
    version: state.version,
    phase: state.phase,
    activePlayerId: state.players[state.activeIndex]?.id ?? null,
    setupCurrentPlayerId: state.phase === 'setup_settlement' || state.phase === 'setup_road' ? (state.setup.queue[state.setup.pos] ?? null) : null,
    setupQueue: state.setup.queue,
    setupPos: state.setup.pos,
    setupLastSettlementVertex: state.setup.lastSettlementVertex,
    pending: state.pending ? buildPendingView(state.pending, state.players[state.activeIndex]?.id ?? null, youId) : null,
    mustRollAfterCard: state.returnPhase === 'pre_roll',
    board,
    dice: state.dice ? { d1: state.dice.d1, d2: state.dice.d2 } : null,
    players,
    you: youView,
    bankCounts,
    devDeckCount: state.devDeck.length,
    offers,
    history,
    chat,
    winnerId: state.winnerId,
  };
}

const EMPTY_BANK: Record<ResourceKind, number> = {
  brick: BANK_SIZE_PER_RESOURCE,
  lumber: BANK_SIZE_PER_RESOURCE,
  wool: BANK_SIZE_PER_RESOURCE,
  grain: BANK_SIZE_PER_RESOURCE,
  ore: BANK_SIZE_PER_RESOURCE,
};

/**
 * Visão de lobby (jogo ainda não começou): fase `GameView['phase'] = 'lobby'`
 * (fora do union de Phase do motor) e um tabuleiro vazio.
 * `version` permanece 0 — lobby não altera a versão do jogo.
 */
export function buildLobbyView(room: Room, youId: PlayerId, chat: GameView['chat']): GameView {
  const youMember = room.members.get(youId);
  const players: PublicPlayerView[] = [...room.members.values()].map((m) => ({
    id: m.playerId,
    name: m.name,
    color: m.color,
    connected: m.connected,
    isHost: m.isHost,
    ready: m.ready,
    resourcesCount: 0,
    devCardsCount: 0,
    knightsPlayed: 0,
    longestRoadLength: 0,
    hasLargestRoad: false,
    hasLargestArmy: false,
    publicVictoryPoints: 0,
    piecesLeft: { ...PIECE_LIMITS },
  }));
  return {
    roomCode: room.code,
    roomName: room.name,
    version: 0,
    phase: 'lobby',
    activePlayerId: null,
    setupCurrentPlayerId: null,
    setupQueue: [],
    setupPos: 0,
    setupLastSettlementVertex: null,
    pending: null,
    mustRollAfterCard: false,
    board: { seed: room.boardSeed, hexes: [], ports: [], buildings: [], roads: [], robberHexId: '' },
    dice: null,
    players,
    you: {
      id: youId,
      name: youMember?.name ?? '???',
      color: youMember?.color ?? 'white',
      resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 },
      devCards: [],
      victoryPoints: 0,
      bankRate: 4,
      ports: [],
      boughtThisTurn: [],
      playedActionCardThisTurn: false,
    },
    bankCounts: { ...EMPTY_BANK },
    devDeckCount: 0,
    offers: [],
    history: [],
    chat,
    winnerId: null,
  };
}

/** Visão atual da sala (lobby ou jogo) para um jogador. */
export function buildRoomView(engine: GameEngineApi, room: Room, youId: PlayerId): GameView {
  const chat = room.chat.slice(-CHAT_VIEW_LIMIT);
  return room.state ? buildGameView(engine, room.state, room, youId, chat) : buildLobbyView(room, youId, chat);
}
