// Ciclo de vida com identidade (htok): códigos fechados liberados, reutilização
// segura, fechamento tardio vs partida nova, retentativa legítima vs colisão.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, insertRoom, persistRoomUpdate, roomCodeExists } from '../../src/server/db';
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

  it('código histórico fechado (v1) não bloqueia reutilização', () => {
    const db = openDb(':memory:');
    try {
      insertRoom(db, { code: 'WXYZA', name: 'old', hostPlayerId: 'p1', phase: 'lobby', version: 0, boardSeed: 's', createdAt: 1 });
      persistRoomUpdate(db, { roomCode: 'WXYZA', closed: true, updatedAt: 2 });
      // Fechada some da lista mas não pode bloquear código novo.
      expect(roomCodeExists(db, 'WXYZA')).toBe(false);
      // Reutiliza o mesmo código na mesma transação do create.
      expect(() =>
        insertRoom(db, { code: 'WXYZA', name: 'new', hostPlayerId: 'p2', phase: 'lobby', version: 0, boardSeed: 's', createdAt: 3 }),
      ).not.toThrow();
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
});
