// Ciclo de vida com identidade (htok): códigos fechados liberados, reutilização
// segura, fechamento tardio vs partida nova, retentativa legítima vs colisão.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertChatRow, insertMember, insertRoom, openDb, persistRoomUpdate, roomCodeExists, tx } from '../../src/server/db';
import { lobby, startHarness, type Harness } from './harness';

const SECRET = 'hub-test-secret-lifecycle';
const OLD: Record<string, string | undefined> = {};

function setHubEnv(): void {
  OLD.HUB_SECRET = process.env.HUB_SECRET;
  OLD.HUB_TEST_HOOKS = process.env.HUB_TEST_HOOKS;
  process.env.HUB_SECRET = SECRET;
  process.env.HUB_TEST_HOOKS = '1';
}

function restoreHubEnv(): void {
  if (OLD.HUB_SECRET === undefined) delete process.env.HUB_SECRET;
  else process.env.HUB_SECRET = OLD.HUB_SECRET;
  if (OLD.HUB_TEST_HOOKS === undefined) delete process.env.HUB_TEST_HOOKS;
  else process.env.HUB_TEST_HOOKS = OLD.HUB_TEST_HOOKS;
}

async function getState(h: Harness, code: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${h.url}/__hub/state?room=${encodeURIComponent(code)}`, {
    headers: { 'x-hub-secret': SECRET },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function postClose(h: Harness, code: string, htok?: string): Promise<{ status: number; body: unknown }> {
  const q = `room=${encodeURIComponent(code)}${htok ? `&htok=${encodeURIComponent(htok)}` : ''}`;
  const res = await fetch(`${h.url}/__hub/close?${q}`, {
    method: 'POST',
    headers: { 'x-hub-secret': SECRET },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('hub htok: ciclo de vida e identidade', () => {
  let h: Harness;
  beforeEach(async () => {
    setHubEnv();
    h = await startHarness();
  });
  afterEach(async () => {
    await h.close();
    restoreHubEnv();
  });

  it('código com histórico (mesmo fechado) bloqueia reutilização e preserva dados', () => {
    const db = openDb(':memory:');
    try {
      insertRoom(db, { code: 'WXYZA', name: 'old', hostPlayerId: 'p1', phase: 'lobby', version: 0, boardSeed: 's', createdAt: 1 });
      db.prepare(
        'INSERT INTO members (room_code, player_id, name, color, recovery_hash, is_host, ready, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('WXYZA', 'p1', 'Ana', 'red', 'h1', 1, 0, 1);
      db.prepare('INSERT INTO chat (id, room_code, player_id, name, color, text, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        'c1',
        'WXYZA',
        'p1',
        'Ana',
        'red',
        'historico',
        1,
      );
      persistRoomUpdate(db, { roomCode: 'WXYZA', closed: true, updatedAt: 2 });
      // Histórico bloqueia: Hub recebe CODE_TAKEN e tenta outro código, nunca sobrescreve.
      expect(roomCodeExists(db, 'WXYZA')).toBe(true);
      expect(() =>
        insertRoom(db, { code: 'WXYZA', name: 'new', hostPlayerId: 'p2', phase: 'lobby', version: 0, boardSeed: 's', createdAt: 3 }),
      ).toThrow();
      // Preservados automaticamente.
      expect((db.prepare('SELECT COUNT(*) AS n FROM members WHERE room_code = ?').get('WXYZA') as { n: number }).n).toBe(1);
      expect((db.prepare('SELECT COUNT(*) AS n FROM chat WHERE room_code = ?').get('WXYZA') as { n: number }).n).toBe(1);
      expect(roomCodeExists(db, 'WXYZA')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('close libera o código: state 404 e create reutiliza sem CODE_TAKEN (idempotente)', async () => {
    const s = await h.connect();
    const code = 'LBCDE2';
    const created = await lobby(s, { type: 'create_room', nickname: 'Ana', roomCode: code });
    expect(created.ok).toBe(true);
    const close = await postClose(h, code);
    expect(close.status).toBe(200);
    const gone = await getState(h, code);
    expect(gone.status).toBe(404);
    // Idempotente: fechar de novo continua ok.
    const closeAgain = await postClose(h, code);
    expect(closeAgain.status).toBe(200);
    expect(closeAgain.body).toEqual({ ok: true });
    // Reutilização: mesmo código cria de novo, sem CODE_TAKEN.
    const s2 = await h.connect();
    const reused = await lobby(s2, { type: 'create_room', nickname: 'Bia', roomCode: code });
    expect(reused.ok).toBe(true);
    if (reused.ok && 'session' in reused) expect(reused.session.roomCode).toBe(code);
    const back = await getState(h, code);
    expect(back.status).toBe(200);
  });

  it('mesmo htok entra sem CODE_TAKEN; htok diferente/ausente => CODE_TAKEN', async () => {
    const code = 'HTKAA2';
    const owner = 'dono-abc_123';
    const s1 = await h.connect();
    const c1 = await lobby(s1, { type: 'create_room', nickname: 'Ana', roomCode: code, hubToken: owner });
    expect(c1.ok).toBe(true);
    // Retentativa legítima: mesmo dono, outro participante => nova vaga, sem CODE_TAKEN.
    const s2 = await h.connect();
    const c2 = await lobby(s2, { type: 'create_room', nickname: 'Bia', roomCode: code, hubToken: owner });
    expect(c2.ok).toBe(true);
    if (c2.ok && 'session' in c2) expect(c2.session.roomCode).toBe(code);
    const st = await getState(h, code);
    expect(st.status).toBe(200);
    expect((st.body as { room: { players: number } }).room.players).toBe(2);
    // Colisão: dono diferente => CODE_TAKEN honesto.
    const s3 = await h.connect();
    const clash = await lobby(s3, { type: 'create_room', nickname: 'Caio', roomCode: code, hubToken: 'outro-dono' });
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.error.code).toBe('CODE_TAKEN');
    // Sem token contra sala com dono => CODE_TAKEN.
    const s4 = await h.connect();
    const noTok = await lobby(s4, { type: 'create_room', nickname: 'Davi', roomCode: code });
    expect(noTok.ok).toBe(false);
    if (!noTok.ok) expect(noTok.error.code).toBe('CODE_TAKEN');
  });

  it('close com htok: sem token/errado => 403 e sala intacta; certo fecha; tardio não atinge partida nova', async () => {
    const code = 'HTKBB3';
    const oldTok = 'partida-antiga-1';
    const newTok = 'partida-nova-2';
    const s1 = await h.connect();
    const c1 = await lobby(s1, { type: 'create_room', nickname: 'Ana', roomCode: code, hubToken: oldTok });
    expect(c1.ok).toBe(true);
    // Fechamento sem token ou com token errado: 403 FORBIDDEN, sala segue aberta.
    expect((await postClose(h, code)).status).toBe(403);
    expect((await postClose(h, code)).body).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect((await getState(h, code)).status).toBe(200);
    expect((await postClose(h, code, 'token-errado')).status).toBe(403);
    expect((await getState(h, code)).status).toBe(200);
    // Dono certo fecha.
    expect((await postClose(h, code, oldTok)).status).toBe(200);
    expect((await getState(h, code)).status).toBe(404);
    // Partida nova reutiliza o código com outro dono.
    const s2 = await h.connect();
    const c2 = await lobby(s2, { type: 'create_room', nickname: 'Bia', roomCode: code, hubToken: newTok });
    expect(c2.ok).toBe(true);
    expect((await getState(h, code)).status).toBe(200);
    // Fechamento tardio da partida antiga (htok velho): 403, não atinge a nova.
    expect((await postClose(h, code, oldTok)).status).toBe(403);
    expect((await postClose(h, code, oldTok)).body).toEqual({ ok: false, error: 'FORBIDDEN' });
    const still = await getState(h, code);
    expect(still.status).toBe(200);
    expect((still.body as { room: { players: number } }).room.players).toBe(1);
    // Dono novo fecha normalmente.
    expect((await postClose(h, code, newTok)).status).toBe(200);
    expect((await getState(h, code)).status).toBe(404);
  });

  it('sala legada sem dono fecha sem htok (compatibilidade)', async () => {
    const s = await h.connect();
    const code = 'LGDCF4';
    const created = await lobby(s, { type: 'create_room', nickname: 'Ana', roomCode: code });
    expect(created.ok).toBe(true);
    expect((await postClose(h, code)).body).toEqual({ ok: true });
    expect((await getState(h, code)).status).toBe(404);
  });

  it('close tardio com htok em sala sem dono preserva (não remove legado)', async () => {
    const s = await h.connect();
    const code = 'LGTAR2';
    expect(await lobby(s, { type: 'create_room', nickname: 'Ana', roomCode: code })).toMatchObject({ ok: true });
    // Close afiliado atrasado (outra partida, mesmo código): 403, sala intacta.
    expect((await postClose(h, code, 'htok-antigo-xyz')).status).toBe(403);
    expect((await postClose(h, code, 'htok-antigo-xyz')).body).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect((await getState(h, code)).status).toBe(200);
    // Fechamento legítimo sem htok segue funcionando.
    expect((await postClose(h, code)).status).toBe(200);
    expect((await getState(h, code)).status).toBe(404);
  });

  it('histórico no banco bloqueia create solicitado (CODE_TAKEN) e outro código livre cria — Hub tenta outro sem travar', async () => {
    // Servidor real + banco real (engine fake só para lógica de jogo, não usada aqui).
    // Injeta resíduo histórico com dados (como v1 closed=1) direto no banco real.
    const histCode = 'HSTAA2';
    const freeCode = 'HSTBB3';
    tx(h.app.ctx.db, () => {
      insertRoom(h.app.ctx.db, { code: histCode, name: 'antiga', hostPlayerId: 'p-old', phase: 'lobby', version: 0, boardSeed: 's', createdAt: 1 });
      insertMember(h.app.ctx.db, {
        roomCode: histCode,
        playerId: 'p-old',
        name: 'Zed',
        color: 'blue',
        recoveryHash: 'hash-hist-1',
        isHost: true,
        ready: false,
        joinedAt: 1,
      });
      insertChatRow(h.app.ctx.db, { id: 'hist-c1', roomCode: histCode, playerId: 'p-old', name: 'Zed', color: 'blue', text: 'adeus', at: 1 });
      persistRoomUpdate(h.app.ctx.db, { roomCode: histCode, closed: true, updatedAt: 2 });
    });
    // Pedido explícito no código com histórico => CODE_TAKEN rápido (com ack, sem hang).
    const s1 = await h.connect();
    const clash = await lobby(s1, { type: 'create_room', nickname: 'Bia', roomCode: histCode, hubToken: 'dono-novo-1' });
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.error.code).toBe('CODE_TAKEN');
    // Histórico preservado automaticamente (membros/chat intactos).
    const db = h.app.ctx.db;
    expect((db.prepare('SELECT COUNT(*) AS n FROM members WHERE room_code = ?').get(histCode) as { n: number }).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM chat WHERE room_code = ?').get(histCode) as { n: number }).n).toBe(1);
    // Hub tenta outro código livre => cria sem CODE_TAKEN (fluxo recuperável).
    const s2 = await h.connect();
    const ok = await lobby(s2, { type: 'create_room', nickname: 'Bia', roomCode: freeCode, hubToken: 'dono-novo-1' });
    expect(ok.ok).toBe(true);
    expect((await getState(h, freeCode)).status).toBe(200);
  });

  it('falha injetada no create desfaz transação (sem sala parcial, rollback)', () => {
    // Banco temporário real (:memory:): segunda inserção viola PK e desfaz a primeira.
    const db = openDb(':memory:');
    try {
      const now = Date.now();
      insertRoom(db, { code: 'RB001', name: 'base', hostPlayerId: 'p-base', phase: 'lobby', version: 0, boardSeed: 's', createdAt: now });
      db.prepare(
        'INSERT INTO members (room_code, player_id, name, color, recovery_hash, is_host, ready, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('RB001', 'p-base', 'Ana', 'red', 'hash-rb-base', 1, 0, now);
      // Tenta criar RB002 mas o membro usa recovery_hash duplicado => falha e rollback.
      expect(() =>
        tx(db, () => {
          insertRoom(db, { code: 'RB002', name: 'nova', hostPlayerId: 'p-new', phase: 'lobby', version: 0, boardSeed: 's', createdAt: now + 1 });
          insertMember(db, {
            roomCode: 'RB002',
            playerId: 'p-new',
            name: 'Bia',
            color: 'blue',
            recoveryHash: 'hash-rb-base',
            isHost: true,
            ready: false,
            joinedAt: now + 1,
          });
        }),
      ).toThrow();
      // Rollback: RB002 não existe (nem sala nem membro parcial); base intacta.
      expect(roomCodeExists(db, 'RB002')).toBe(false);
      expect((db.prepare('SELECT COUNT(*) AS n FROM members WHERE room_code = ?').get('RB002') as { n: number }).n).toBe(0);
      expect(roomCodeExists(db, 'RB001')).toBe(true);
      expect((db.prepare('SELECT COUNT(*) AS n FROM members WHERE room_code = ?').get('RB001') as { n: number }).n).toBe(1);
    } finally {
      db.close();
    }
  });

  it('erro não-conflito com código explícito → INTERNAL (não CODE_TAKEN), sem sala parcial', async () => {
    // Falha injetada real (servidor real + banco real temp): sem tabela members,
    // insertMember falha com "no such table" (não-conflito) dentro da tx do create.
    h.app.ctx.db.exec('DROP TABLE members');
    const s = await h.connect();
    const res = await lobby(s, { type: 'create_room', nickname: 'Ana', roomCode: 'ERR99X' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INTERNAL');
    // Sem sala parcial: nem memória nem banco (tx desfez o insertRoom) e sem hang.
    expect(h.app.ctx.store.getOpenRoom('ERR99X')).toBeUndefined();
    expect(roomCodeExists(h.app.ctx.db, 'ERR99X')).toBe(false);
    expect((await getState(h, 'ERR99X')).status).toBe(404);
  });
});
