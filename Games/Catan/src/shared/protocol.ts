// Protocolo tipado cliente<->servidor. Validação runtime também em validate.ts.
import type {
  EdgeId,
  HexId,
  OfferId,
  PlayerColor,
  PlayerId,
  ResourceKind,
  VertexId,
} from './constants';
import type { DevCardInstance, EngineError, Phase, Pending, PortSlot, HexTile } from './types';

// ---------- Códigos de erro estáveis (pt-BR na mensagem) ----------

export const ERROR_CODES = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  WRONG_PHASE: 'WRONG_PHASE',
  INVALID_POSITION: 'INVALID_POSITION',
  DISTANCE_RULE: 'DISTANCE_RULE',
  NOT_CONNECTED: 'NOT_CONNECTED',
  BLOCKED_PATH: 'BLOCKED_PATH',
  INSUFFICIENT_RESOURCES: 'INSUFFICIENT_RESOURCES',
  PIECE_LIMIT: 'PIECE_LIMIT',
  BANK_EMPTY: 'BANK_EMPTY',
  DEV_DECK_EMPTY: 'DEV_DECK_EMPTY',
  DEV_ALREADY_PLAYED: 'DEV_ALREADY_PLAYED',
  DEV_BOUGHT_THIS_TURN: 'DEV_BOUGHT_THIS_TURN',
  NO_DEV_CARD: 'NO_DEV_CARD',
  INVALID_TRADE: 'INVALID_TRADE',
  TRADE_NOT_AVAILABLE: 'TRADE_NOT_AVAILABLE',
  OFFER_EXPIRED: 'OFFER_EXPIRED',
  STALE_VERSION: 'STALE_VERSION',
  DUPLICATE_REQUEST: 'DUPLICATE_REQUEST',
  REQUEST_CONFLICT: 'REQUEST_CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  ALREADY_STARTED: 'ALREADY_STARTED',
  COLOR_TAKEN: 'COLOR_TAKEN',
  NOT_HOST: 'NOT_HOST',
  NEED_PLAYERS: 'NEED_PLAYERS',
  NOT_READY: 'NOT_READY',
  INVALID_RECOVERY: 'INVALID_RECOVERY',
  SESSION_CONFLICT: 'SESSION_CONFLICT',
  GAME_NOT_FOUND: 'GAME_NOT_FOUND',
  ALREADY_IN_ROOM: 'ALREADY_IN_ROOM',
  CODE_TAKEN: 'CODE_TAKEN',
  INVALID_STATE: 'INVALID_STATE',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// ---------- Envelope de comando ----------

/**
 * Regras de concorrência (documentadas em docs/protocol.md):
 * - `requestId` idempotente: reenvio igual devolve a mesma confirmação; payload
 *   diferente com mesmo requestId => REQUEST_CONFLICT.
 * - `baseVersion` deve ser igual à versão atual do estado do jogo; divergência
 *   => STALE_VERSION + visão atual para ressincronizar. Chat/lobby fora do jogo
 *   não alteram a versão. Em envelopes `cmd` a omissão de `baseVersion` é
 *   INVALID_PAYLOAD (validação em validate.ts); lobby nunca envia baseVersion.
 * - Mutations são serializadas por sala; sucesso só após persistência atômica.
 */
export interface CommandEnvelope {
  requestId: string;
  /** Versão do estado que o cliente assumiu ao emitir (comandos de jogo). */
  baseVersion?: number;
  payload: LobbyCommand | GameCommand;
}

// ---------- Lobby ----------

export type LobbyCommand =
  | { type: 'create_room'; nickname: string; roomName?: string; roomCode?: string; hubToken?: string }
  | { type: 'join_room'; code: string; nickname: string; hubToken?: string }
  /** Vincula o socket a uma sala+jogador usando o código de recuperação.
   * mode 'resume' = retomar (ex.: atualizar aba); 'takeover' = assumir controle
   * explicitamente quando outro socket ainda detém o jogador (avisa o anterior). */
  | { type: 'bind_session'; code: string; recoveryCode: string; mode: 'resume' | 'takeover' | 'claim' }
  | { type: 'set_color'; color: PlayerColor }
  | { type: 'set_ready'; ready: boolean }
  | { type: 'start_game'; boardSeed?: string }
  | { type: 'leave_room' }
  | { type: 'kick_player'; playerId: PlayerId }
  | { type: 'transfer_host'; playerId: PlayerId }
  | { type: 'chat'; text: string };

// ---------- Comandos de jogo ----------

export interface ResourcePatch {
  give?: Partial<Record<ResourceKind, number>>;
  want?: Partial<Record<ResourceKind, number>>;
}

export type GameCommand =
  | { type: 'setup_settlement'; vertexId: VertexId }
  | { type: 'setup_road'; edgeId: EdgeId }
  | { type: 'roll_dice' }
  | { type: 'end_turn' }
  | { type: 'build_road'; edgeId: EdgeId }
  | { type: 'build_settlement'; vertexId: VertexId }
  | { type: 'build_city'; vertexId: VertexId }
  | { type: 'buy_dev_card' }
  | { type: 'discard'; cards: Partial<Record<ResourceKind, number>> }
  | { type: 'move_robber'; hexId: HexId; victimId?: PlayerId }
  | { type: 'play_knight'; hexId: HexId; victimId?: PlayerId }
  | { type: 'play_road_building' }
  | { type: 'place_free_road'; edgeId: EdgeId }
  | { type: 'finish_road_building' }
  | { type: 'play_monopoly'; resource: ResourceKind }
  | { type: 'play_year_of_plenty'; resources: ResourceKind[] } // 1 ou 2 (2 máx.)
  | { type: 'bank_trade'; give: Partial<Record<ResourceKind, number>>; want: Partial<Record<ResourceKind, number>> }
  | { type: 'propose_trade'; toPlayerId: PlayerId; give: Partial<Record<ResourceKind, number>>; want: Partial<Record<ResourceKind, number>> }
  | { type: 'respond_trade'; offerId: OfferId; response: 'accept' | 'reject' }
  | { type: 'cancel_trade'; offerId: OfferId };

// ---------- Projeções (público x privado) ----------

export interface PublicPlayerView {
  id: PlayerId;
  name: string;
  color: PlayerColor;
  connected: boolean;
  isHost: boolean;
  ready: boolean;
  resourcesCount: number;
  devCardsCount: number;
  knightsPlayed: number;
  longestRoadLength: number;
  hasLargestRoad: boolean;
  hasLargestArmy: boolean;
  /** Pontuação pública: cidades+assentamentos+títulos. NÃO inclui pontos ocultos. */
  publicVictoryPoints: number;
  piecesLeft: { roads: number; settlements: number; cities: number };
}

export interface YouView {
  id: PlayerId;
  name: string;
  color: PlayerColor;
  resources: Record<ResourceKind, number>;
  devCards: DevCardInstance[];
  /** Pontuação real incluindo pontos ocultos (só o próprio jogador). */
  victoryPoints: number;
  /** Melhor taxa de banco disponível: 2, 3 ou 4. */
  bankRate: 2 | 3 | 4;
  /** Portos controlados. */
  ports: { id: string; kind: 'generic' | ResourceKind }[];
  /** IDs de dev compradas neste turno (não jogáveis até virar o turno). */
  boughtThisTurn: string[];
  /** Jogou UMA carta de ação neste turno (bloqueia a 2ª). */
  playedActionCardThisTurn: boolean;
}

export interface OfferView {
  id: OfferId;
  fromPlayerId: PlayerId;
  toPlayerId: PlayerId;
  give: Partial<Record<ResourceKind, number>>;
  want: Partial<Record<ResourceKind, number>>;
}

export interface HistoryView {
  seq: number;
  text: string; // mensagem pronta em pt-BR
  kind: string;
  playerId?: PlayerId;
  private: boolean;
}

export interface ChatMessageView {
  id: string;
  playerId: PlayerId;
  name: string;
  color: PlayerColor;
  text: string;
  at: number;
}

export interface PendingView {
  type: Pending['type'];
  /** Só para você. */
  yourAction: boolean;
  /** Quem ainda precisa agir (ex.: descartes). */
  waitingOn: PlayerId[];
  /** Dono da pendência (road_building/monopoly/year_of_plenty). */
  playerId?: PlayerId;
  roadsLeft?: number;
}

export interface BoardView {
  seed: string;
  hexes: HexTile[];
  ports: PortSlot[];
  buildings: { vertexId: VertexId; playerId: PlayerId; kind: 'settlement' | 'city' }[];
  roads: { edgeId: EdgeId; playerId: PlayerId }[];
  robberHexId: HexId;
}

export interface GameView {
  roomCode: string;
  roomName: string;
  version: number;
  /** Fase do motor; 'lobby' somente antes do start_game (buildLobbyView). */
  phase: Phase | 'lobby';
  activePlayerId: PlayerId | null;
  /** Próximo a colocar na preparação (por item da fila). */
  setupCurrentPlayerId: PlayerId | null;
  /** Estado real da preparação no motor: fila snake e posição atual. */
  setupQueue: PlayerId[];
  setupPos: number;
  /** Assentamento recém-colocado (exige estrada adjacente em setup_road). */
  setupLastSettlementVertex: VertexId | null;
  pending: PendingView | null;
  /** Fase de retorno pendente de dev card pré-dados (informativo). */
  mustRollAfterCard: boolean;
  board: BoardView;
  dice: { d1: number; d2: number } | null;
  players: PublicPlayerView[];
  you: YouView;
  bankCounts: Record<ResourceKind, number>;
  devDeckCount: number;
  offers: OfferView[];
  history: HistoryView[];
  chat: ChatMessageView[];
  winnerId: PlayerId | null;
}

// ---------- Respostas e eventos ----------

export type CommandResponse =
  | { ok: true; requestId: string; version?: number }
  | { ok: false; requestId: string; error: EngineError; version?: number };

/** Payload do bind/create/join (resposta direta do ack do lobby). */
export interface SessionPayload {
  roomCode: string;
  roomName: string;
  playerId: PlayerId;
  /** Guardar em sessionStorage. Nunca enviar a outros jogadores. */
  recoveryCode: string;
  isHost: boolean;
}

export type LobbyAck =
  | { ok: true; session: SessionPayload; view: GameView | null }
  | { ok: false; error: EngineError };

/** Eventos servidor -> cliente (push). */
export interface ServerEvents {
  /** Projeção personalizada; enviada após mutações aceitas e no bind/reconexão. */
  state: (view: GameView) => void;
  chat: (message: ChatMessageView) => void;
  /** Controle de sessão duplicada: este socket perdeu o controle. */
  session_replaced: (info: { by: string }) => void;
  /** Conflito de bind (sessão ativa em outra conexão). */
  bind_conflict: (info: { roomCode: string; playerId: PlayerId }) => void;
  presence: (info: { playerId: PlayerId; connected: boolean }) => void;
}

/** Eventos cliente -> servidor. */
export interface ClientEvents {
  cmd: (envelope: CommandEnvelope, ack: (res: CommandResponse) => void) => void;
  lobby: (envelope: CommandEnvelope, ack: (res: CommandResponse | LobbyAck) => void) => void;
  chat: (text: string) => void;
}

export type { Phase, Pending, EngineError };
