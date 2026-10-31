// Constantes do Catan clássico (edição base 2020, 3–4 jogadores).
// Fonte: docs/rules.md. Projeto independente, não oficial.

export type ResourceKind = 'brick' | 'lumber' | 'wool' | 'grain' | 'ore';
export const RESOURCE_KINDS: readonly ResourceKind[] = ['brick', 'lumber', 'wool', 'grain', 'ore'] as const;

export type TerrainKind = 'hills' | 'forest' | 'pasture' | 'fields' | 'mountains' | 'desert';
export const TERRAIN_RESOURCE: Record<Exclude<TerrainKind, 'desert'>, ResourceKind> = {
  hills: 'brick',
  forest: 'lumber',
  pasture: 'wool',
  fields: 'grain',
  mountains: 'ore',
};

export type DevCardKind = 'knight' | 'victoryPoint' | 'roadBuilding' | 'monopoly' | 'yearOfPlenty';
export const DEV_CARD_KINDS: readonly DevCardKind[] = [
  'knight',
  'victoryPoint',
  'roadBuilding',
  'monopoly',
  'yearOfPlenty',
] as const;

/** Composição oficial do baralho de desenvolvimento. */
export const DEV_DECK_COMPOSITION: Record<DevCardKind, number> = {
  knight: 14,
  victoryPoint: 5,
  roadBuilding: 2,
  monopoly: 2,
  yearOfPlenty: 2,
};

export type BuildingKind = 'settlement' | 'city';
export type PlayerColor = 'red' | 'orange' | 'white' | 'blue';
export const PLAYER_COLORS: readonly PlayerColor[] = ['red', 'orange', 'white', 'blue'] as const;

export type PlayerId = string;
export type HexId = string; // axial "q,r" (inteiros)
export type VertexId = string; // tripla de cubo exata "x:y:z" (inteiros, sem float)
export type EdgeId = string; // vértices ordenados "v1|v2"
export type OfferId = string;

/** Carta de banco: 19 por recurso. */
export const BANK_SIZE_PER_RESOURCE = 19;

/** Estoque de peças por jogador. */
export const PIECE_LIMITS = { roads: 15, settlements: 5, cities: 4 } as const;

export const COSTS = {
  road: { lumber: 1, brick: 1 },
  settlement: { lumber: 1, brick: 1, wool: 1, grain: 1 },
  city: { grain: 2, ore: 3 },
  devCard: { wool: 1, grain: 1, ore: 1 },
} as const satisfies Record<string, Partial<Record<ResourceKind, number>>>;

export const VICTORY_POINTS = {
  settlement: 1,
  city: 2,
  largestRoad: 2,
  largestArmy: 2,
  hiddenVictoryPoint: 1,
} as const;

export const WINNING_SCORE = 10;
export const LONGEST_ROAD_MIN = 5;
export const LARGEST_ARMY_MIN = 3;

export const DISCARD_RATIO = 0.5; // metade arredondada para baixo

/** Distribuição oficial de terrenos. */
export const TERRAIN_COUNTS: Record<TerrainKind, number> = {
  forest: 4,
  pasture: 4,
  fields: 4,
  hills: 3,
  mountains: 3,
  desert: 1,
};

/** Tokens numéricos oficiais (deserto sem token): 2 e 12 uma vez; demais duas vezes. */
export const NUMBER_TOKENS: readonly number[] = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
export const RED_NUMBERS: readonly number[] = [6, 8];

/** Topologia da ilha padrão (validada pelo motor). */
export const ISLAND_EXPECTED_VERTICES = 54;
export const ISLAND_EXPECTED_EDGES = 72;
export const ISLAND_HEX_COUNT = 19;
export const PORT_COUNT = 9;

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 4;

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem I/O/0/1
export const ROOM_CODE_LENGTH = 5;
export const RECOVERY_CODE_BYTES = 32; // entropia suficiente (256 bits)

export const CHAT_MAX_LENGTH = 300;
export const CHAT_RATE_LIMIT = { max: 5, windowMs: 5000 } as const;
export const HISTORY_LIMIT = 300;
export const CHAT_VIEW_LIMIT = 100;
export const NICKNAME_MAX_LENGTH = 20;
export const ROOM_NAME_MAX_LENGTH = 30;

/** Rate limit de lobby por conexão (create_room / join_room). */
export const LOBBY_RATE_LIMIT = {
  create: { max: 10, windowMs: 60_000 },
  join: { max: 30, windowMs: 60_000 },
} as const;
