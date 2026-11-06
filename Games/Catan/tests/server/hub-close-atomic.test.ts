// R5: closeHubRoom atômico — commit→memória→eventos (SQLite :memory:, sem harness).
// RED: falha de DELETE mantém DB+memória intactos, sem evento enganoso.
import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { insertMember, insertRoom, openDb, roomCodeExists } from '../../src/server/db';
import { closeHubRoom, sessionKey, type AppContext, type AppSocket } from '../../src/server/handlers';
import { Store } from '../../src/server/rooms';

function fakeSocket() {
  const emitted: { ev: string; payload: unknown }[] = [];
  const sock = {
    data: { binding: null as { roomCode: string; playerId: string } | null, lobbyRate: { create: [], join: [] } },
    emit(ev: string, payload: unknown) {
      emitted.push({ ev, payload });
      return true;
    },
  };
  return { sock: sock as unknown as AppSocket, emitted };
}

function makeCtx(db: DatabaseSync, store: Store): { ctx: AppContext; sockets: Map<string, { emitted: { ev: string; payload: unknown }[] }> } {
  const sessions = new Map<string, AppSocket>();
  const track = new Map<string, { emitted: { ev: string; payload: unknown }[] }>();
  const ctx = {
    config: { nodeEnv: 'development', port: 0, host: '127.0.0.1', dbPath: ':memory:', allowedOrigin: null, testHooks: false } as AppContext['config'],
    db,
    store,
    engine: {} as AppContext['engine'],
    io: {} as AppContext['io'],
    sessions,
    queues: new Map(),
    chatRate: new Map(),
  } as AppContext;
  return { ctx, sockets: track };
}

function seedRoom(db: DatabaseSync, code: string, hubToken: string, players: { id: string; name: string; hash: string }[]) {
  const now = Date.now();
  insertRoom(db, { code, name: 'sala-' + code, hostPlayerId: players[0].id, phase: 'lobby', version: 0, boardSeed: 's', createdAt: now, hubToken });
  players.forEach((p, i) => {
    insertMember(db, {
      roomCode: code,
      playerId: p.id,
      name: p.name,
      color: i === 0 ? 'red' : 'blue',
      recoveryHash: p.hash,
      isHost: i === 0,
      ready: false,
      joinedAt: now + i,
    });
  });
}

function bindAll(ctx: AppContext): Map<string, { emitted: { ev: string; payload: unknown }[] }> {
  const track = new Map<string, { emitted: { ev: string; payload: unknown }[] }>();
  const room = [...ctx.store.rooms.values()][0];
  if (!room) return track;
  for (const m of room.members.values()) {
    const { sock, emitted } = fakeSocket();
    sock.data.binding = { roomCode: room.code, playerId: m.playerId };
    ctx.sessions.set(sessionKey(room.code, m.playerId), sock);
    track.set(m.playerId, { emitted });
  }
  return track;
}

describe('R5 closeHubRoom atômico (commit→memória→eventos)', () => {
  it('falha injetada no DELETE mantém DB+memória intactos, sem evento enganoso', () => {
    const db = openDb(':memory:');
    try {
      seedRoom(db, 'FAIL1', 'dono-1', [
        { id: 'p1', name: 'Ana', hash: 'h-f1-1' },
        { id: 'p2', name: 'Bia', hash: 'h-f1-2' },
      ]);
      const store = Store.load(db);
      const { ctx } = makeCtx(db, store);
      const track = bindAll(ctx);
      const room = store.rooms.get('FAIL1')!;
      expect(room.members.size).toBe(2);
      // Falha injetada: qualquer DELETE em members aborta (rollback no banco).
      db.exec(`CREATE TRIGGER fail_del BEFORE DELETE ON members BEGIN SELECT RAISE(ABORT, 'injected-delete-fail'); END;`);
      let threw = false;
      try {
        closeHubRoom(ctx, 'FAIL1', 'dono-1');
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
      // DB intacto (rollback).
      expect(roomCodeExists(db, 'FAIL1')).toBe(true);
      expect((db.prepare('SELECT COUNT(*) AS n FROM members WHERE room_code = ?').get('FAIL1') as { n: number }).n).toBe(2);
      // Memória intacta.
      expect(store.rooms.has('FAIL1')).toBe(true);
      expect(room.members.size).toBe(2);
      expect(store.recoveryIndex.get('h-f1-1')).toMatchObject({ roomCode: 'FAIL1', playerId: 'p1' });
      expect(ctx.sessions.has(sessionKey('FAIL1', 'p1'))).toBe(true);
      expect(ctx.sessions.has(sessionKey('FAIL1', 'p2'))).toBe(true);
      for (const s of ctx.sessions.values()) {
        expect(s.data.binding).not.toBeNull();
      }
      // Sem evento enganoso.
      for (const [, t] of track) {
        expect(t.emitted.filter((e) => e.ev === 'session_replaced')).toHaveLength(0);
      }
    } finally {
      db.close();
    }
  });

  it('retry após remover falha fecha com sucesso e emite session_replaced', () => {
    const db = openDb(':memory:');
    try {
      seedRoom(db, 'RTRY1', 'dono-r', [{ id: 'p1', name: 'Ana', hash: 'h-rt-1' }]);
      const store = Store.load(db);
      const { ctx } = makeCtx(db, store);
      const track = bindAll(ctx);
      db.exec(`CREATE TRIGGER fail_del BEFORE DELETE ON members BEGIN SELECT RAISE(ABORT, 'injected'); END;`);
      expect(() => closeHubRoom(ctx, 'RTRY1', 'dono-r')).toThrow();
      // Retry: remove a falha injetada.
      db.exec('DROP TRIGGER fail_del');
      const res = closeHubRoom(ctx, 'RTRY1', 'dono-r');
      expect(res).toEqual({ ok: true, closed: true });
      expect(roomCodeExists(db, 'RTRY1')).toBe(false);
      expect(store.rooms.has('RTRY1')).toBe(false);
      expect(ctx.sessions.has(sessionKey('RTRY1', 'p1'))).toBe(false);
      expect(track.get('p1')!.emitted.filter((e) => e.ev === 'session_replaced')).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('sucesso direto remove DB+memória e emite para cada sessão', () => {
    const db = openDb(':memory:');
    try {
      seedRoom(db, 'OK001', '', [
        { id: 'p1', name: 'Ana', hash: 'h-ok-1' },
        { id: 'p2', name: 'Bia', hash: 'h-ok-2' },
      ]);
      const store = Store.load(db);
      const { ctx } = makeCtx(db, store);
      const track = bindAll(ctx);
      const res = closeHubRoom(ctx, 'OK001');
      expect(res).toEqual({ ok: true, closed: true });
      expect(roomCodeExists(db, 'OK001')).toBe(false);
      expect((db.prepare('SELECT COUNT(*) AS n FROM members WHERE room_code = ?').get('OK001') as { n: number }).n).toBe(0);
      expect(store.rooms.has('OK001')).toBe(false);
      expect(store.recoveryIndex.get('h-ok-1')).toBeUndefined();
      expect(ctx.sessions.size).toBe(0);
      for (const [, t] of track) {
        expect(t.emitted.filter((e) => e.ev === 'session_replaced')).toHaveLength(1);
      }
    } finally {
      db.close();
    }
  });

  it('dono errado (403) preserva DB+memória sem evento', () => {
    const db = openDb(':memory:');
    try {
      seedRoom(db, 'OWN01', 'dono-certo', [{ id: 'p1', name: 'Ana', hash: 'h-own-1' }]);
      const store = Store.load(db);
      const { ctx } = makeCtx(db, store);
      const track = bindAll(ctx);
      expect(closeHubRoom(ctx, 'OWN01', 'errado')).toEqual({ ok: false, error: 'FORBIDDEN' });
      expect(closeHubRoom(ctx, 'OWN01')).toEqual({ ok: false, error: 'FORBIDDEN' });
      expect(roomCodeExists(db, 'OWN01')).toBe(true);
      expect(store.rooms.has('OWN01')).toBe(true);
      expect(store.rooms.get('OWN01')!.members.size).toBe(1);
      expect(ctx.sessions.has(sessionKey('OWN01', 'p1'))).toBe(true);
      for (const [, t] of track) expect(t.emitted).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('sala inexistente é idempotente (closed:false)', () => {
    const db = openDb(':memory:');
    try {
      const store = Store.load(db);
      const { ctx } = makeCtx(db, store);
      expect(closeHubRoom(ctx, 'XXXXX', 'qualquer')).toEqual({ ok: true, closed: false });
      expect(closeHubRoom(ctx, 'XXXXX')).toEqual({ ok: true, closed: false });
    } finally {
      db.close();
    }
  });

  it('concorrentes: falha isolada não atinge outra sala; duplo close idempotente', () => {
    const db = openDb(':memory:');
    try {
      seedRoom(db, 'CONC1', 'tok-a', [{ id: 'pa', name: 'Ana', hash: 'h-c1' }]);
      seedRoom(db, 'CONC2', 'tok-b', [{ id: 'pb', name: 'Bia', hash: 'h-c2' }]);
      const store = Store.load(db);
      const { ctx } = makeCtx(db, store);
      // Bind manual por sala (bindAll só pega a primeira; fazer as duas).
      for (const room of store.rooms.values()) {
        for (const m of room.members.values()) {
          const { sock } = fakeSocket();
          sock.data.binding = { roomCode: room.code, playerId: m.playerId };
          ctx.sessions.set(sessionKey(room.code, m.playerId), sock);
        }
      }
      // Falha só para CONC1.
      db.exec(`CREATE TRIGGER fail_one BEFORE DELETE ON members WHEN OLD.room_code = 'CONC1' BEGIN SELECT RAISE(ABORT, 'injected-conc1'); END;`);
      expect(() => closeHubRoom(ctx, 'CONC1', 'tok-a')).toThrow();
      // CONC2 fecha normalmente (isolamento).
      expect(closeHubRoom(ctx, 'CONC2', 'tok-b')).toEqual({ ok: true, closed: true });
      expect(store.rooms.has('CONC2')).toBe(false);
      expect(roomCodeExists(db, 'CONC2')).toBe(false);
      // CONC1 intacta.
      expect(store.rooms.has('CONC1')).toBe(true);
      expect(roomCodeExists(db, 'CONC1')).toBe(true);
      expect(ctx.sessions.has(sessionKey('CONC1', 'pa'))).toBe(true);
      // Retry CONC1 após remover trigger + duplo close idempotente.
      db.exec('DROP TRIGGER fail_one');
      expect(closeHubRoom(ctx, 'CONC1', 'tok-a')).toEqual({ ok: true, closed: true });
      expect(closeHubRoom(ctx, 'CONC1', 'tok-a')).toEqual({ ok: true, closed: false });
    } finally {
      db.close();
    }
  });
});
