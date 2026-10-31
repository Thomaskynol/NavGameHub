// Migração v1→v2 — Parte B: só-aditiva, atômica, sem apagar nada.
// Usa apenas cópias temporárias (mkdtemp) e :memory:; NUNCA db/catan.db.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, roomCodeExists, insertRoom, SCHEMA_VERSION } from '../../src/server/db';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) {
    const d = dirs.pop() as string;
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* limpeza best-effort */
    }
  }
});

function tmpFile(): string {
  const d = mkdtempSync(join(tmpdir(), 'catan-mig-'));
  dirs.push(d);
  return join(d, 'catan.db');
}

/** Cria um banco v1 (sem rooms.hub_token, user_version=1) com sala aberta + fechada. */
function buildV1(path: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
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
    `);
    const now = Date.now();
    db.prepare(
      'INSERT INTO rooms (code, name, host_player_id, state_json, phase, version, board_seed, created_at, updated_at, closed) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)',
    ).run('OPEN1', 'aberta', 'p-open', 'lobby', 0, 'seed', now, now, 0);
    db.prepare(
      'INSERT INTO rooms (code, name, host_player_id, state_json, phase, version, board_seed, created_at, updated_at, closed) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)',
    ).run('SHUT1', 'fechada', 'p-shut', 'lobby', 0, 'seed', now, now, 1);
    db.prepare(
      'INSERT INTO members (room_code, player_id, name, color, recovery_hash, is_host, ready, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('OPEN1', 'p-open', 'Ana', 'red', 'hash-open', 1, 0, now);
    db.prepare(
      'INSERT INTO members (room_code, player_id, name, color, recovery_hash, is_host, ready, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('SHUT1', 'p-shut', 'Zed', 'blue', 'hash-shut', 1, 0, now);
    db.prepare('INSERT INTO chat (id, room_code, player_id, name, color, text, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      'chat-open',
      'OPEN1',
      'p-open',
      'Ana',
      'red',
      'ola',
      now,
    );
    db.prepare('INSERT INTO chat (id, room_code, player_id, name, color, text, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      'chat-shut',
      'SHUT1',
      'p-shut',
      'Zed',
      'blue',
      'adeus',
      now,
    );
    db.prepare(
      'INSERT INTO processed_commands (request_id, room_code, player_id, payload_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('req-shut', 'SHUT1', 'p-shut', 'h', '{"ok":true}', now);
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('format', '1');
  } finally {
    db.close();
  }
}

function userVersion(path: string): number {
  const db = new DatabaseSync(path);
  try {
    return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  } finally {
    db.close();
  }
}

function count(db: DatabaseSync, sql: string, arg?: string): number {
  const row = (arg === undefined ? db.prepare(sql).get() : db.prepare(sql).get(arg)) as unknown as { n: number };
  return row.n;
}

describe('migração v1→v2: só-aditiva e atômica', () => {
  it('preserva abertas+fechadas (salas, membros, chat); versão 2; reopen idempotente', () => {
    const path = tmpFile();
    buildV1(path);

    const db = openDb(path);
    try {
      expect(userVersion(path)).toBe(2);
      // Nada apagado: fechada segue no arquivo com seus dados.
      expect(count(db, 'SELECT COUNT(*) AS n FROM rooms')).toBe(2);
      expect(count(db, 'SELECT COUNT(*) AS n FROM rooms WHERE closed = 1')).toBe(1);
      expect(count(db, 'SELECT COUNT(*) AS n FROM members')).toBe(2);
      expect(count(db, 'SELECT COUNT(*) AS n FROM chat')).toBe(2);
      expect(count(db, 'SELECT COUNT(*) AS n FROM processed_commands WHERE room_code = ?', 'SHUT1')).toBe(1);
      // Dono default vazio nas migradas.
      const rows = db.prepare('SELECT code, hub_token FROM rooms ORDER BY code').all() as { code: string; hub_token: string }[];
      expect(rows).toEqual([
        { code: 'OPEN1', hub_token: '' },
        { code: 'SHUT1', hub_token: '' },
      ]);
      // Códigos: aberta bloqueia, fechada não (liberada com identidade).
      expect(roomCodeExists(db, 'OPEN1')).toBe(true);
      expect(roomCodeExists(db, 'SHUT1')).toBe(false);
      expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION);
    } finally {
      db.close();
    }

    // Reopen idempotente (segunda abertura não falha nem apaga).
    const db2 = openDb(path);
    try {
      expect(count(db2, 'SELECT COUNT(*) AS n FROM rooms')).toBe(2);
      expect(count(db2, 'SELECT COUNT(*) AS n FROM members')).toBe(2);
      expect(count(db2, 'SELECT COUNT(*) AS n FROM chat')).toBe(2);
    } finally {
      db2.close();
    }
    expect(userVersion(path)).toBe(2);
  });

  it('código fechado reutilizável após migração (identidade do novo dono)', () => {
    const path = tmpFile();
    buildV1(path);
    const db = openDb(path);
    try {
      expect(() =>
        insertRoom(db, { code: 'SHUT1', name: 'nova', hostPlayerId: 'p-new', phase: 'lobby', version: 0, boardSeed: 's', createdAt: 3, hubToken: 'dono-novo' }),
      ).not.toThrow();
      expect(roomCodeExists(db, 'SHUT1')).toBe(true);
      const row = db.prepare('SELECT hub_token AS h FROM rooms WHERE code = ?').get('SHUT1') as { h: string };
      expect(row.h).toBe('dono-novo');
      // Membros/chat da sala fechada antiga saíram com a reutilização; aberta intacta.
      expect(count(db, 'SELECT COUNT(*) AS n FROM members WHERE room_code = ?', 'OPEN1')).toBe(1);
    } finally {
      db.close();
    }
  });

  it('falha após ALTER (coluna sem versionar, como a migração antiga) reabre limpa, sem "coluna duplicada"', () => {
    const path = tmpFile();
    buildV1(path);
    // Simula crash da migração antiga: ALTER aplicado, versão ainda 1.
    const raw = new DatabaseSync(path);
    try {
      raw.exec('ALTER TABLE rooms ADD COLUMN hub_token TEXT NOT NULL DEFAULT \'\'');
      expect((raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(1);
    } finally {
      raw.close();
    }

    const db = openDb(path); // não pode lançar "duplicate column"
    try {
      expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(2);
      expect(count(db, 'SELECT COUNT(*) AS n FROM rooms')).toBe(2);
      expect(count(db, 'SELECT COUNT(*) AS n FROM members')).toBe(2);
      expect(count(db, 'SELECT COUNT(*) AS n FROM chat')).toBe(2);
    } finally {
      db.close();
    }
    // Reopen seguinte também limpo.
    const db2 = openDb(path);
    db2.close();
  });

  it('falha durante remoção (parcial, versão ainda 1) reabre sem perder o restante', () => {
    const path = tmpFile();
    buildV1(path);
    // Simula crash no meio dos DELETEs da migração antiga: coluna já existe,
    // só parte dos dados sumiu, versão ainda 1.
    const raw = new DatabaseSync(path);
    try {
      raw.exec('ALTER TABLE rooms ADD COLUMN hub_token TEXT NOT NULL DEFAULT \'\'');
      raw.prepare('DELETE FROM members WHERE room_code = ?').run('SHUT1');
    } finally {
      raw.close();
    }

    const db = openDb(path);
    try {
      expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(2);
      // O que restou é preservado: a migração nova NÃO continua apagando.
      expect(count(db, 'SELECT COUNT(*) AS n FROM rooms')).toBe(2);
      expect(count(db, 'SELECT COUNT(*) AS n FROM chat')).toBe(2);
      expect(count(db, 'SELECT COUNT(*) AS n FROM processed_commands WHERE room_code = ?', 'SHUT1')).toBe(1);
    } finally {
      db.close();
    }
  });

  it('banco v2 abre e reabre sem perda (abertas+fechadas vindas da API atual)', () => {
    const path = tmpFile();
    const db = openDb(path);
    try {
      insertRoom(db, { code: 'AAAAB', name: 'a', hostPlayerId: 'p1', phase: 'lobby', version: 0, boardSeed: 's', createdAt: 1 });
      insertRoom(db, { code: 'BBBBB', name: 'b', hostPlayerId: 'p2', phase: 'lobby', version: 0, boardSeed: 's', createdAt: 1, hubToken: 'dono-1' });
    } finally {
      db.close();
    }
    const db2 = openDb(path);
    try {
      expect(count(db2, 'SELECT COUNT(*) AS n FROM rooms')).toBe(2);
      const rows = db2.prepare('SELECT code, hub_token FROM rooms ORDER BY code').all() as { code: string; hub_token: string }[];
      expect(rows).toEqual([
        { code: 'AAAAB', hub_token: '' },
        { code: 'BBBBB', hub_token: 'dono-1' },
      ]);
    } finally {
      db2.close();
    }
    const db3 = openDb(path);
    db3.close();
    expect(userVersion(path)).toBe(2);
  });
});
