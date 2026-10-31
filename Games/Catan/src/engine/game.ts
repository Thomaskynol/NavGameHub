// Estado inicial da partida.
import {
  BANK_SIZE_PER_RESOURCE,
  DEV_CARD_KINDS,
  DEV_DECK_COMPOSITION,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PIECE_LIMITS,
  RESOURCE_KINDS,
} from '../shared/constants';
import type { DevCardKind, PlayerColor, PlayerId } from '../shared/constants';
import type { DevCardInstance, GameState, PlayerState, RandomSource } from '../shared/types';
import { pushPublic } from './history';
import { generateBoard } from './mapgen';
import { shuffleInPlace } from './rng';

function buildDevDeck(rng: RandomSource): DevCardInstance[] {
  const cards: DevCardInstance[] = [];
  for (const kind of DEV_CARD_KINDS) {
    for (let i = 0; i < DEV_DECK_COMPOSITION[kind]; i++) {
      cards.push({ id: `dev-${cards.length}`, kind: kind as DevCardKind });
    }
  }
  // Ordem secreta: embaralha com a RNG injetada (servidor: criptográfica).
  return shuffleInPlace(cards, rng);
}

function emptyResources(): PlayerState['resources'] {
  const out = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 } as PlayerState['resources'];
  for (const k of RESOURCE_KINDS) out[k] = 0;
  return out;
}

/**
 * Cria o estado inicial: fase setup_settlement, fila snake na ordem do array
 * ([p0,p1,p2,p3,p3,p2,p1,p0] para 4; [p0,p1,p2,p2,p1,p0] para 3), banco 19/recurso,
 * baralho de 25 embaralhado com a RNG injetada, peças 15/5/4, ladrão no deserto,
 * ofertas/histórico vazios, version 0, títulos sem dono.
 */
export function createGame(opts: {
  players: { id: PlayerId; name: string; color: PlayerColor }[];
  boardSeed: string;
  rng: RandomSource;
}): GameState {
  const { players, boardSeed, rng } = opts;
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new Error(`createGame: 3–4 jogadores exigidos (recebidos: ${players.length})`);
  }
  const board = generateBoard(boardSeed);

  const playerStates: PlayerState[] = players.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    resources: emptyResources(),
    devCards: [],
    boughtThisTurn: [],
    playedActionCardThisTurn: false,
    knightsPlayed: 0,
    pieces: { roads: PIECE_LIMITS.roads, settlements: PIECE_LIMITS.settlements, cities: PIECE_LIMITS.cities },
  }));

  const ids = players.map((p) => p.id);
  const queue = [...ids, ...[...ids].reverse()]; // snake: [p0..pn, pn..p0]

  const desert = board.hexes.find((h) => h.terrain === 'desert');
  if (!desert) throw new Error('createGame: tabuleiro sem deserto');

  const bank = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 } as GameState['bank'];
  for (const k of RESOURCE_KINDS) bank[k] = BANK_SIZE_PER_RESOURCE;

  const state: GameState = {
    phase: 'setup_settlement',
    players: playerStates,
    activeIndex: 0,
    board,
    buildings: [],
    roads: [],
    robberHexId: desert.id,
    bank,
    devDeck: buildDevDeck(rng),
    dice: null,
    returnPhase: null,
    setup: { queue, pos: 0, lastSettlementVertex: null },
    pending: null,
    largestRoad: { playerId: null, value: 0 },
    largestArmy: { playerId: null, value: 0 },
    offers: [],
    history: { events: [], meta: {} },
    historySeq: 0,
    version: 0,
    winnerId: null,
    boardSeed,
  };

  pushPublic(state, { type: 'game_started', players: players.map((p) => ({ id: p.id, name: p.name, color: p.color })) });
  return state;
}
