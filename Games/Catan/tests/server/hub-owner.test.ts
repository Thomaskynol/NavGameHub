// Contrato dono (htok) — Parte A: state hubOwner, join com identidade, close estrito.
// Servidor real via harness (HTTP + socket).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lobby, startHarness, type Harness } from './harness';

const SECRET = 'hub-owner-secret';
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

async function getState(h: Harness, code: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${h.url}/__hub/state?room=${encodeURIComponent(code)}`, {
    headers: { 'x-hub-secret': SECRET },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function postClose(h: Harness, code: string, htok?: string): Promise<{ status: number; body: any }> {
  const q = `room=${encodeURIComponent(code)}${htok ? `&htok=${encodeURIComponent(htok)}` : ''}`;
  const res = await fetch(`${h.url}/__hub/close?${q}`, {
    method: 'POST',
    headers: { 'x-hub-secret': SECRET },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('hub dono: state, join e close', () => {
  let h: Harness;
  beforeEach(async () => {
    setHubEnv();
    h = await startHarness();
  });
  afterEach(async () => {
    await h.close();
    restoreHubEnv();
  });

  it('state inclui hubOwner: null sem dono, token com dono', async () => {
    const s1 = await h.connect();
    const c1 = await lobby(s1, { type: 'create_room', nickname: 'Ana', roomCode: 'QWNR33' });
    expect(c1.ok).toBe(true);
    const st1 = await getState(h, 'QWNR33');
    expect(st1.status).toBe(200);
    expect(st1.body.room.hubOwner).toBeNull();

    const s2 = await h.connect();
    const c2 = await lobby(s2, { type: 'create_room', nickname: 'Bia', roomCode: 'QWNR22', hubToken: 'dono-x_99' });
    expect(c2.ok).toBe(true);
    const st2 = await getState(h, 'QWNR22');
    expect(st2.status).toBe(200);
    expect(st2.body.room.hubOwner).toBe('dono-x_99');
  });

  it('join com htok divergente recusa sem entrada; sem htok legado entra', async () => {
    const owner = 'dono-join-1';
    const s1 = await h.connect();
    const c1 = await lobby(s1, { type: 'create_room', nickname: 'Ana', roomCode: 'JQKN22', hubToken: owner });
    expect(c1.ok).toBe(true);

    // Divergente: CODE_TAKEN, sem nova vaga.
    const s2 = await h.connect();
    const bad = await lobby(s2, { type: 'join_room', code: 'JQKN22', nickname: 'Caio', hubToken: 'outro-dono' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('CODE_TAKEN');
    expect((await getState(h, 'JQKN22')).body.room.players).toBe(1);

    // Sem htok: legado preservado — entra como antes.
    const s3 = await h.connect();
    const legacy = await lobby(s3, { type: 'join_room', code: 'JQKN22', nickname: 'Bia' });
    expect(legacy.ok).toBe(true);
    expect((await getState(h, 'JQKN22')).body.room.players).toBe(2);

    // Mesmo htok no join: entra (nova vaga da mesma partida).
    const s4 = await h.connect();
    const same = await lobby(s4, { type: 'join_room', code: 'JQKN22', nickname: 'Davi', hubToken: owner });
    expect(same.ok).toBe(true);
    expect((await getState(h, 'JQKN22')).body.room.players).toBe(3);
  });

  it('join com htok em sala sem dono recusa sem entrada (não afilia retroativo)', async () => {
    const s1 = await h.connect();
    const c1 = await lobby(s1, { type: 'create_room', nickname: 'Ana', roomCode: 'LEGJ22' });
    expect(c1.ok).toBe(true);
    const s2 = await h.connect();
    const bad = await lobby(s2, { type: 'join_room', code: 'LEGJ22', nickname: 'Bia', hubToken: 'tentando-dono' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('CODE_TAKEN');
    expect((await getState(h, 'LEGJ22')).body.room.players).toBe(1);
    // Legado sem htok segue entrando.
    const s3 = await h.connect();
    const ok = await lobby(s3, { type: 'join_room', code: 'LEGJ22', nickname: 'Bia' });
    expect(ok.ok).toBe(true);
  });

  it('resume legítimo via bind_session segue ok com dono', async () => {
    const s1 = await h.connect();
    const c1 = await lobby(s1, { type: 'create_room', nickname: 'Ana', roomCode: 'RESM22', hubToken: 'dono-r1' });
    expect(c1.ok && 'session' in (c1 as object)).toBe(true);
    if (!c1.ok || !('session' in c1)) throw new Error('create falhou');
    s1.disconnect();
    const s2 = await h.connect();
    const bound = await lobby(s2, { type: 'bind_session', code: 'RESM22', recoveryCode: c1.session.recoveryCode, mode: 'resume' });
    expect(bound.ok).toBe(true);
  });

  it('close estrito: com dono exige htok (403 sem/errado); sem dono só sem htok, com htok 403 preserva', async () => {
    const s1 = await h.connect();
    await lobby(s1, { type: 'create_room', nickname: 'Ana', roomCode: 'CLS444', hubToken: 'dono-c1' });

    const noTok = await postClose(h, 'CLS444');
    expect(noTok.status).toBe(403);
    expect(noTok.body).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect((await getState(h, 'CLS444')).status).toBe(200);

    const wrong = await postClose(h, 'CLS444', 'errado');
    expect(wrong.status).toBe(403);
    expect((await getState(h, 'CLS444')).status).toBe(200);

    const right = await postClose(h, 'CLS444', 'dono-c1');
    expect(right.status).toBe(200);
    expect(right.body).toEqual({ ok: true });
    expect((await getState(h, 'CLS444')).status).toBe(404);
    // Idempotente em sala inexistente.
    expect((await postClose(h, 'CLS444', 'dono-c1')).status).toBe(200);

    // Legada sem dono: fecha sem htok (legítimo ao jogo); COM htok → 403 preserva
    // (close afiliado atrasado de outra partida que reutilizou o código).
    const s2 = await h.connect();
    await lobby(s2, { type: 'create_room', nickname: 'Bia', roomCode: 'CLS222' });
    expect((await postClose(h, 'CLS222')).status).toBe(200);
    expect((await getState(h, 'CLS222')).status).toBe(404);

    const s3 = await h.connect();
    await lobby(s3, { type: 'create_room', nickname: 'Cid', roomCode: 'CLS333' });
    const withTok = await postClose(h, 'CLS333', 'qualquer');
    expect(withTok.status).toBe(403);
    expect(withTok.body).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect((await getState(h, 'CLS333')).status).toBe(200);
    // Sem htok fecha (legítimo); inexistente idempotente mesmo com htok.
    expect((await postClose(h, 'CLS333')).status).toBe(200);
    expect((await getState(h, 'CLS333')).status).toBe(404);
    expect((await postClose(h, 'CLS333', 'qualquer')).status).toBe(200);
  });
});
