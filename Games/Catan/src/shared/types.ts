// Tipos canônicos de estado do jogo (motor puro — sem io, sem rede).
import type {
  BuildingKind,
  DevCardKind,
  EdgeId,
  HexId,
  OfferId,
  PlayerColor,
  PlayerId,
  ResourceKind,
  TerrainKind,
  VertexId,
} from './constants';

// ---------- Tabuleiro (layout estático, gerado no início da partida) ----------

export interface HexTile {
  id: HexId;
  terrain: TerrainKind;
  /** Número do token; null no deserto. */
  number: number | null;
}

export interface PortSlot {
  id: string;
  edgeId: EdgeId;
  vertexIds: [VertexId, VertexId];
  /** 'generic' = 3:1; recurso = 2:1 naquele recurso. */
  kind: 'generic' | ResourceKind;
}

export interface BoardLayout {
  hexes: HexTile[];
  /** Canônico: triplas inteiras de cubo; a ilha padrão tem exatamente 54. */
  vertices: VertexId[];
  /** A ilha padrão tem exatamente 72. */
  edges: EdgeId[];
  edgeEndpoints: Record<EdgeId, [VertexId, VertexId]>;
  /** Hexágonos que tocam o vértice (para produção e vítimas do ladrão). */
  vertexHexes: Record<VertexId, HexId[]>;
  vertexEdges: Record<VertexId, EdgeId[]>;
  hexEdges: Record<HexId, EdgeId[]>;
  hexNeighbors: Record<HexId, HexId[]>;
  ports: PortSlot[];
}

// ---------- Estado dinâmico do tabuleiro ----------

export interface Building {
  vertexId: VertexId;
  playerId: PlayerId;
  kind: BuildingKind;
}

export interface Road {
  edgeId: EdgeId;
  playerId: PlayerId;
}

// ---------- Jogador ----------

export interface DevCardInstance {
  id: string;
  kind: DevCardKind;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  color: PlayerColor;
  resources: Record<ResourceKind, number>;
  /** Mão oculta de desenvolvimento (tipos). */
  devCards: DevCardInstance[];
  /** IDs compradas neste turno (não jogáveis neste turno). */
  boughtThisTurn: string[];
  /** Já jogou UMA carta de ação neste turno (inclui cavaleiro). */
  playedActionCardThisTurn: boolean;
  /** Cavaleiros já jogados (visível a todos). */
  knightsPlayed: number;
  /** Peças restantes. */
  pieces: { roads: number; settlements: number; cities: number };
}

// ---------- Trocas ----------

export interface TradeOffer {
  id: OfferId;
  fromPlayerId: PlayerId; // sempre o jogador ativo
  toPlayerId: PlayerId;
  give: Partial<Record<ResourceKind, number>>;
  want: Partial<Record<ResourceKind, number>>;
}

// ---------- Fases e pendências ----------

/**
 * Fases explícitas. Sem flags contraditórias: pendências vivem em `pending`
 * e retorno de dev card pré-dados vive em `returnPhase`.
 */
export type Phase =
  | 'setup_settlement' // colocar assentamento (ida e volta)
  | 'setup_road' // estrada adjacente ao assentamento recém-colocado
  | 'pre_roll' // antes dos dados: rolar / jogar carta de ação prévia
  | 'action' // fase combinada: trocas, construções, dev cards, fim de turno
  | 'await_discards' // 7: descartes pendentes
  | 'robber' // mover ladrão + roubo (do jogador ativo)
  | 'dev_road_building' // resolução: até 2 estradas gratuitas
  | 'dev_monopoly' // resolução: escolher recurso
  | 'dev_year_of_plenty' // resolução: escolher 1–2 recursos do banco
  | 'game_over';

export type Pending =
  | { type: 'discard'; waitingOn: PlayerId[] }
  | { type: 'robber' }
  | { type: 'road_building'; playerId: PlayerId; roadsLeft: number }
  | { type: 'monopoly'; playerId: PlayerId }
  | { type: 'year_of_plenty'; playerId: PlayerId };

export interface TitleHolder {
  playerId: PlayerId | null;
  /** Maior comprimento considerado no momento (estrada) ou cavaleiros (exército). */
  value: number;
}

// ---------- Eventos de histórico (públicos/privados) ----------

export type HistoryEvent =
  | { seq: number; type: 'game_started'; players: { id: PlayerId; name: string; color: PlayerColor }[] }
  | { seq: number; type: 'setup_placed'; playerId: PlayerId; vertexId: VertexId; edgeId?: EdgeId; second: boolean }
  | { seq: number; type: 'dice'; playerId: PlayerId; d1: number; d2: number }
  | { seq: number; type: 'production'; byResource: Record<ResourceKind, PlayerId[]> }
  | { seq: number; type: 'robber_moved'; playerId: PlayerId; hexId: HexId }
  | {
      seq: number;
      type: 'stolen';
      playerId: PlayerId; // ladrão
      victimId: PlayerId;
      /** Ausente quando a vítima não tinha cartas (roubo sem tipo). Ajuste mínimo do contrato. */
      resource?: ResourceKind; // apenas audiência: playerId e victimId
    }
  | { seq: number; type: 'discarded'; playerId: PlayerId; count: number } // composição é privada
  /** Composição privada de cartas recebidas/descartadas (audiência = [playerId]). Ajuste mínimo do contrato. */
  | {
      seq: number;
      type: 'resources_private';
      playerId: PlayerId;
      resources: Partial<Record<ResourceKind, number>>;
      reason: 'setup' | 'discard';
    }
  | { seq: number; type: 'built'; playerId: PlayerId; kind: 'road' | 'settlement' | 'city'; edgeId?: EdgeId; vertexId?: VertexId }
  | { seq: number; type: 'bought_dev_card'; playerId: PlayerId } // tipo oculto
  | { seq: number; type: 'played_dev_card'; playerId: PlayerId; card: DevCardKind; freeRoads?: number; monopoly?: ResourceKind; takes?: ResourceKind[] }
  | { seq: number; type: 'bank_trade'; playerId: PlayerId; give: Partial<Record<ResourceKind, number>>; want: Partial<Record<ResourceKind, number>> }
  | { seq: number; type: 'trade_proposed'; playerId: PlayerId; toPlayerId: PlayerId; offerId: OfferId }
  | { seq: number; type: 'trade_accepted'; playerId: PlayerId; byPlayerId: PlayerId; offerId: OfferId }
  | { seq: number; type: 'trade_rejected'; playerId: PlayerId; byPlayerId: PlayerId; offerId: OfferId }
  | { seq: number; type: 'trade_cancelled'; playerId: PlayerId; offerId: OfferId }
  | { seq: number; type: 'turn_ended'; playerId: PlayerId; nextPlayerId: PlayerId }
  | { seq: number; type: 'largest_road'; playerId: PlayerId | null; value: number }
  | { seq: number; type: 'largest_army'; playerId: PlayerId | null; value: number }
  | { seq: number; type: 'victory'; playerId: PlayerId; points: number };

/** Quem pode ver o evento. */
export interface HistoryMeta {
  visibility: 'public' | 'private';
  audience?: PlayerId[];
}

// ---------- Estado completo do jogo (motor) ----------

export interface GameState {
  phase: Phase;
  players: PlayerState[];
  /** Índice do jogador ativo em `players`. */
  activeIndex: number;
  board: BoardLayout;
  buildings: Building[];
  roads: Road[];
  robberHexId: HexId;
  bank: Record<ResourceKind, number>;
  /** Ordem secreta do baralho (o servidor nunca envia aos clientes). */
  devDeck: DevCardInstance[];
  dice: { d1: number; d2: number } | null;
  /** Fase de retorno após resolução de dev card jogado antes dos dados. */
  returnPhase: Phase | null;
  setup: {
    /** Fila ida-e-volta de assentamentos (snake). */
    queue: PlayerId[];
    pos: number;
    /** Assentamento do turno atual (para exigir estrada adjacente). */
    lastSettlementVertex: VertexId | null;
  };
  pending: Pending | null;
  largestRoad: TitleHolder;
  largestArmy: TitleHolder;
  offers: TradeOffer[];
  history: { events: HistoryEvent[]; meta: Record<number, HistoryMeta> };
  historySeq: number;
  /** Versão monotônica do estado (controle de concorrência). */
  version: number;
  winnerId: PlayerId | null;
  boardSeed: string;
}

// ---------- Motor: resultado e dependências ----------

export interface EngineError {
  code: string; // código estável (ver protocol ErrorCode)
  message: string; // pt-BR
  details?: unknown;
}

export type EngineResult<T = GameState> = { ok: true; state: T } | { ok: false; error: EngineError };

/** Fonte de aleatoriedade injetável (servidor: criptográfica; testes: determinística). */
export interface RandomSource {
  /** Float em [0, 1). */
  next(): number;
}
