// Salas em memória (canônicas) + boot a partir do SQLite.
import type { DatabaseSync } from 'node:sqlite';
import type { PlayerColor } from '../shared/constants';
import type { ChatMessageView } from '../shared/protocol';
import type { GameState, RandomSource } from '../shared/types';
import { CHAT_VIEW_LIMIT, PLAYER_COLORS } from '../shared/constants';
import { loadChatRows, loadOpenRooms } from './db';
import { logError } from './log';

export interface Member {
  playerId: string;
  name: string;
  color: PlayerColor;
  recoveryHash: string;
  isHost: boolean;
  ready: boolean;
  joinedAt: number;
  connected: boolean;
}

export interface RoomTestState {
  forceDice: { d1: number; d2: number } | null;
  rngSeed: string | null;
  /** Instância de RNG por sala (sequência contínua; trocada por seed_rng). */
  rng: RandomSource | null;
}

export interface Room {
  code: string;
  name: string;
  hostPlayerId: string;
  /** Dono da instância (htok do Hub, '' = sem dono/legado). Protege contra
   * fechamento tardio de outra partida que reutilizou o código. */
  hubToken: string;
  /** Snapshot canônico; null enquanto lobby. */
  state: GameState | null;
  /** 'lobby' ou a fase do estado do jogo. */
  phase: string;
  boardSeed: string;
  members: Map<string, Member>;
  /** Últimos CHAT_VIEW_LIMIT mensagens (broadcast); o banco guarda CHAT_RETENTION. */
  chat: ChatMessageView[];
  closed: boolean;
  createdAt: number;
  updatedAt: number;
  test: RoomTestState;
}

export interface RecoveryRef {
  roomCode: string;
  playerId: string;
}

export class Store {
  readonly rooms = new Map<string, Room>();
  /** hash de recuperação (global, único) → Membership. */
  readonly recoveryIndex = new Map<string, RecoveryRef>();

  constructor(readonly db: DatabaseSync) {}

  static load(db: DatabaseSync): Store {
    const store = new Store(db);
    const { rooms, members } = loadOpenRooms(db);
    const membersByRoom = new Map<string, typeof members>();
    for (const m of members) {
      const list = membersByRoom.get(m.room_code) ?? [];
      list.push(m);
      membersByRoom.set(m.room_code, list);
    }
    for (const row of rooms) {
      try {
        const state = row.state_json === null ? null : (JSON.parse(row.state_json) as GameState);
        const room: Room = {
          code: row.code,
          name: row.name,
          hostPlayerId: row.host_player_id,
          hubToken: typeof row.hub_token === 'string' ? row.hub_token : '',
          state,
          phase: row.phase,
          boardSeed: row.board_seed,
          members: new Map(),
          chat: loadChatRows(db, row.code, CHAT_VIEW_LIMIT).map((c) => ({
            id: c.id,
            playerId: c.player_id,
            name: c.name,
            color: c.color as PlayerColor,
            text: c.text,
            at: c.at,
          })),
          closed: false,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          test: { forceDice: null, rngSeed: null, rng: null },
        };
        for (const m of membersByRoom.get(row.code) ?? []) {
          const member: Member = {
            playerId: m.player_id,
            name: m.name,
            color: m.color as PlayerColor,
            recoveryHash: m.recovery_hash,
            isHost: m.is_host === 1,
            ready: m.ready === 1,
            joinedAt: m.joined_at,
            connected: false, // presença reinicia desconectada
          };
          room.members.set(member.playerId, member);
          store.recoveryIndex.set(member.recoveryHash, { roomCode: room.code, playerId: member.playerId });
        }
        store.rooms.set(room.code, room);
      } catch (err) {
        // Nunca apagar sala por erro de leitura: mantém no banco, loga e segue.
        logError('room_restore_failed', { roomCode: row.code, message: err instanceof Error ? err.message : String(err) });
      }
    }
    return store;
  }

  getOpenRoom(code: string): Room | undefined {
    const room = this.rooms.get(code);
    return room && !room.closed ? room : undefined;
  }

  /** Primeira cor livre na ordem das constantes. */
  freeColor(room: Room): PlayerColor | undefined {
    const taken = new Set([...room.members.values()].map((m) => m.color));
    return PLAYER_COLORS.find((c) => !taken.has(c));
  }

  indexMember(room: Room, member: Member): void {
    room.members.set(member.playerId, member);
    this.recoveryIndex.set(member.recoveryHash, { roomCode: room.code, playerId: member.playerId });
  }

  unindexMember(room: Room, member: Member): void {
    room.members.delete(member.playerId);
    if (this.recoveryIndex.get(member.recoveryHash)?.playerId === member.playerId) {
      this.recoveryIndex.delete(member.recoveryHash);
    }
  }
}
