// Persistência: node:sqlite (DatabaseSync), migração por PRAGMA user_version.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 1;
/** Retenção de chat por sala (docs/persistence.md: ~200). */
export const CHAT_RETENTION = 200;
/** Idempotência antiga removida no boot (segundos * 1000). */
const PROCESSED_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export interface RoomRow {
  code: string;
  name: string;
  host_player_id: string;
  state_json: string | null;
  phase: string;
  version: number;
  board_seed: string;
  created_at: number;
  updated_at: number;
  closed: number;
}

export interface MemberRow {
  room_code: string;
  player_id: string;
  name: string;
  color: string;
  recovery_hash: string;
  is_host: number;
  ready: number;
  joined_at: number;
}

export interface ChatRow {
  id: string;
  room_code: string;
  player_id: string;
  name: string;
  color: string;
  text: string;
  at: number;
}

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const db = new DatabaseSync(path);
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  const current = row?.user_version ?? 0;
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Banco em formato ${current}, código suporta até ${SCHEMA_VERSION}. Nada foi apagado; atualize o servidor ou restaure backup.`,
    );
  }
  if (current === SCHEMA_VERSION) {
    pruneProcessed(db);
    return;
  }
  if (current !== 0) {
    throw new Error(`Banco em formato desconhecido (${current}); nada foi apagado. Restaure backup.`);
  }
  db.exec(`
    BEGIN;
    CREATE TABLE rooms (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host_player_id TEXT NOT NULL,
      state_json TEXT,
      phase TEXT NOT NULL,
      version INTEGER NOT NULL,
      board_seed TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      closed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE members (
      room_code TEXT NOT NULL,
      player_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      recovery_hash TEXT NOT NULL,
      is_host INTEGER NOT NULL,
      ready INTEGER NOT NULL,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (room_code, player_id)
    );
    CREATE UNIQUE INDEX idx_members_recovery ON members(recovery_hash);
    CREATE INDEX idx_members_room ON members(room_code);
    CREATE TABLE processed_commands (
      request_id TEXT NOT NULL,
      room_code TEXT NOT NULL,
      player_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (request_id, player_id)
    );
    CREATE TABLE chat (
      id TEXT PRIMARY KEY,
      room_code TEXT NOT NULL,
      player_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      text TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE INDEX idx_chat_room ON chat(room_code, at);
    CREATE TABLE meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    PRAGMA user_version = 1;
    COMMIT;
  `);
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('format', String(SCHEMA_VERSION));
  pruneProcessed(db);
}

/** Transação síncrona; rollback em qualquer erro. */
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* rollback falhou; erro original prevalece */
    }
    throw err;
  }
}

function pruneProcessed(db: DatabaseSync): void {
  db.prepare('DELETE FROM processed_commands WHERE created_at < ?').run(Date.now() - PROCESSED_RETENTION_MS);
}

export function loadOpenRooms(db: DatabaseSync): { rooms: RoomRow[]; members: MemberRow[] } {
  const rooms = db.prepare('SELECT * FROM rooms WHERE closed = 0 ORDER BY created_at, rowid').all() as unknown as RoomRow[];
  const all = db.prepare('SELECT * FROM members ORDER BY joined_at, rowid').all() as unknown as MemberRow[];
  const open = new Set(rooms.map((r) => r.code));
  return { rooms, members: all.filter((m) => open.has(m.room_code)) };
}

export function loadChatRows(db: DatabaseSync, roomCode: string, limit: number): ChatRow[] {
  const rows = db
    .prepare('SELECT * FROM chat WHERE room_code = ? ORDER BY at DESC, rowid DESC LIMIT ?')
    .all(roomCode, limit) as unknown as ChatRow[];
  return rows.reverse();
}

export function insertRoom(
  db: DatabaseSync,
  r: { code: string; name: string; hostPlayerId: string; phase: string; version: number; boardSeed: string; createdAt: number },
): void {
  db.prepare(
    'INSERT INTO rooms (code, name, host_player_id, state_json, phase, version, board_seed, created_at, updated_at, closed) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 0)',
  ).run(r.code, r.name, r.hostPlayerId, r.phase, r.version, r.boardSeed, r.createdAt, r.createdAt);
}

export function roomCodeExists(db: DatabaseSync, code: string): boolean {
  return db.prepare('SELECT 1 AS x FROM rooms WHERE code = ?').get(code) !== undefined;
}

export function recoveryHashExists(db: DatabaseSync, hash: string): boolean {
  return db.prepare('SELECT 1 AS x FROM members WHERE recovery_hash = ?').get(hash) !== undefined;
}

export function insertMember(
  db: DatabaseSync,
  m: {
    roomCode: string;
    playerId: string;
    name: string;
    color: string;
    recoveryHash: string;
    isHost: boolean;
    ready: boolean;
    joinedAt: number;
  },
): void {
  db.prepare(
    'INSERT INTO members (room_code, player_id, name, color, recovery_hash, is_host, ready, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(m.roomCode, m.playerId, m.name, m.color, m.recoveryHash, m.isHost ? 1 : 0, m.ready ? 1 : 0, m.joinedAt);
}

export function deleteMember(db: DatabaseSync, roomCode: string, playerId: string): void {
  db.prepare('DELETE FROM members WHERE room_code = ? AND player_id = ?').run(roomCode, playerId);
}

export function updateMemberColor(db: DatabaseSync, roomCode: string, playerId: string, color: string): void {
  db.prepare('UPDATE members SET color = ? WHERE room_code = ? AND player_id = ?').run(color, roomCode, playerId);
}

export function updateMemberReady(db: DatabaseSync, roomCode: string, playerId: string, ready: boolean): void {
  db.prepare('UPDATE members SET ready = ? WHERE room_code = ? AND player_id = ?').run(ready ? 1 : 0, roomCode, playerId);
}

export function updateMemberHosts(db: DatabaseSync, roomCode: string, hostPlayerId: string): void {
  const stmt = db.prepare('UPDATE members SET is_host = CASE WHEN player_id = ? THEN 1 ELSE 0 END WHERE room_code = ?');
  stmt.run(hostPlayerId, roomCode);
}

/** Sucesso de comando de jogo: snapshot + versão + idempotência numa única transação. */
export function persistGameTransition(
  db: DatabaseSync,
  input: {
    roomCode: string;
    stateJson: string;
    phase: string;
    version: number;
    updatedAt: number;
    requestId: string;
    playerId: string;
    payloadHash: string;
    responseJson: string;
  },
): void {
  tx(db, () => {
    db.prepare('UPDATE rooms SET state_json = ?, phase = ?, version = ?, updated_at = ? WHERE code = ?').run(
      input.stateJson,
      input.phase,
      input.version,
      input.updatedAt,
      input.roomCode,
    );
    db.prepare(
      'INSERT INTO processed_commands (request_id, room_code, player_id, payload_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(input.requestId, input.roomCode, input.playerId, input.payloadHash, input.responseJson, input.updatedAt);
  });
}

/** Mudanças estruturais de lobby (membros/hoste/sala) numa única transação. */
export function persistRoomUpdate(
  db: DatabaseSync,
  input: {
    roomCode: string;
    hostPlayerId?: string;
    phase?: string;
    version?: number;
    boardSeed?: string;
    stateJson?: string | null;
    closed?: boolean;
    updatedAt: number;
  },
): void {
  const sets: string[] = ['updated_at = ?'];
  const args: (string | number | null)[] = [input.updatedAt];
  if (input.hostPlayerId !== undefined) {
    sets.push('host_player_id = ?');
    args.push(input.hostPlayerId);
  }
  if (input.phase !== undefined) {
    sets.push('phase = ?');
    args.push(input.phase);
  }
  if (input.version !== undefined) {
    sets.push('version = ?');
    args.push(input.version);
  }
  if (input.boardSeed !== undefined) {
    sets.push('board_seed = ?');
    args.push(input.boardSeed);
  }
  if (input.stateJson !== undefined) {
    sets.push('state_json = ?');
    args.push(input.stateJson);
  }
  if (input.closed !== undefined) {
    sets.push('closed = ?');
    args.push(input.closed ? 1 : 0);
  }
  args.push(input.roomCode);
  db.prepare(`UPDATE rooms SET ${sets.join(', ')} WHERE code = ?`).run(...args);
}

export function findProcessed(db: DatabaseSync, requestId: string, playerId: string): { payload_hash: string; response_json: string } | undefined {
  return db.prepare('SELECT payload_hash, response_json FROM processed_commands WHERE request_id = ? AND player_id = ?').get(requestId, playerId) as
    | { payload_hash: string; response_json: string }
    | undefined;
}

export function insertChatRow(db: DatabaseSync, m: { id: string; roomCode: string; playerId: string; name: string; color: string; text: string; at: number }): void {
  db.prepare('INSERT INTO chat (id, room_code, player_id, name, color, text, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    m.id,
    m.roomCode,
    m.playerId,
    m.name,
    m.color,
    m.text,
    m.at,
  );
  // Retenção: mantém os últimos CHAT_RETENTION por sala (>= CHAT_VIEW_LIMIT enviável).
  db.prepare(
    'DELETE FROM chat WHERE room_code = ? AND id NOT IN (SELECT id FROM chat WHERE room_code = ? ORDER BY at DESC, rowid DESC LIMIT ?)',
  ).run(m.roomCode, m.roomCode, CHAT_RETENTION);
}
