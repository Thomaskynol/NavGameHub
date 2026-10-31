import type { GameEvent, Phase, PlayerInput, Snapshot } from './types.js';

export interface JoinedMessage {
  t: 'joined';
  playerId: string;
  roomCode: string;
  phase: Phase;
}

export type ClientMessage =
  | { t: 'create'; name: string; code?: string; room?: string; htok?: string | null }
  | { t: 'join'; code: string; name: string; htok?: string | null }
  | { t: 'input'; input: PlayerInput }
  | { t: 'ping'; id: number }
  | { t: 'chooseCard'; card: string };

export type ServerMessage =
  | JoinedMessage
  | { t: 'snapshot'; snap: Snapshot }
  | { t: 'event'; e: GameEvent }
  | { t: 'error'; message: string }
  | { t: 'pong'; id: number }
  | { t: 'cardSelection'; cards: string[]; seconds: number };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
