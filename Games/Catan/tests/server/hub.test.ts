// Integração com o Hub (hub/PROTOCOLO.md): /__hub/state, /__hub/close,
// /__hub/test/win (+alias /__hub/test/finish) e roomCode solicitado no create_room.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoom, joinRoom, lobby, startHarness, startedRoom, type Harness } from './harness';

const SECRET = 'hub-test-secret';

const OLD_ENV: Record<string, string | undefined> = {};

function setHubEnv(hooks: boolean): void {
  OLD_ENV.HUB_SECRET = process.env.HUB_SECRET;
  OLD_ENV.HUB_TEST_HOOKS = process.env.HUB_TEST_HOOKS;
  process.env.HUB_SECRET = SECRET;
  if (hooks) process.env.HUB_TEST_HOOKS = '1';
  else delete process.env.HUB_TEST_HOOKS;
}

function restoreHubEnv(): void {
  if (OLD_ENV.HUB_SECRET === undefined) delete process.env.HUB_SECRET;
  else process.env.HUB_SECRET = OLD_ENV.HUB_SECRET;
  if (OLD_ENV.HUB_TEST_HOOKS === undefined) delete process.env.HUB_TEST_HOOKS;
  else process.env.HUB_TEST_HOOKS = OLD_ENV.HUB_TEST_HOOKS;
}

async function getState(h: Harness, code: string, secret: string | null = SECRET): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${h.url}/__hub/state?room=${encodeURIComponent(code)}`, {
    headers: secret ? { 'x-hub-secret': secret } : {},
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function postHub(h: Harness, path: string, code: string, secret: string | null = SECRET): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${h.url}${path}?room=${encodeURIComponent(code)}`, {
    method: 'POST',
    headers: secret ? { 'x-hub-secret': secret } : {},
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('hub: estado e fechamento', () => {
  let h: Harness;
  beforeEach(async () => {
    setHubEnv(true);
    h = await startHarness();
  });
  afterEach(async () => {
    await h.close();
    restoreHubEnv();
  });

  it('sem segredo => 403 FORBIDDEN; sala inexistente => 404 NOT_FOUND', async () => {
    const noSecret = await getState(h, 'ABCDE', null);
    expect(noSecret.status).toBe(403);
    expect(noSecret.body).toEqual({ ok: false, error: 'FORBIDDEN' });
    const wrongSecret = await getState(h, 'ABCDE', 'errado');
    expect(wrongSecret.status).toBe(403);
    const missing = await getState(h, 'ZZZZZ');
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('sala em lobby: phase lobby, joinable true, capacity 4', async () => {
    const { session } = await createRoom(h, 'Ana');
    const { status, body } = await getState(h, session.roomCode);
    expect(status).toBe(200);
    expect(body).toEqual({
      ok: true,
      room: { code: session.roomCode, phase: 'lobby', players: 1, capacity: 4, joinable: true, hubOwner: null },
    });
  });

  it('create_room aceita roomCode de 6 chars (Hub); colisão => CODE_TAKEN', async () => {
    const socket = await h.connect();
    const wanted = 'ABCDEF';
    const first = await lobby(socket, { type: 'create_room', nickname: 'Ana', roomCode: wanted });
    expect(first.ok).toBe(true);
    if (!first.ok || !('session' in first)) throw new Error('create com roomCode falhou');
    expect(first.session.roomCode).toBe(wanted);
    // Join no código de 6 chars funciona.
    const j = await joinRoom(h, wanted, 'Bia');
    expect(j.session.roomCode).toBe(wanted);

    const other = await h.connect();
    const clash = await lobby(other, { type: 'create_room', nickname: 'Caio', roomCode: wanted.toLowerCase() });
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.error.code).toBe('CODE_TAKEN');
    // Estado do Hub enxerga a sala de 6 chars.
    const { status, body } = await getState(h, wanted);
    expect(status).toBe(200);
    expect(body).toEqual({
      ok: true,
      room: { code: wanted, phase: 'lobby', players: 2, capacity: 4, joinable: true, hubOwner: null },
    });
  });

  it('roomCode inválido => INVALID_PAYLOAD', async () => {
    const socket = await h.connect();
    const bad = await lobby(socket, { type: 'create_room', nickname: 'Ana', roomCode: 'AB!!' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('INVALID_PAYLOAD');
  });

  it('partida iniciada: phase playing, joinable false', async () => {
    const { code } = await startedRoom(h, 3);
    const { status, body } = await getState(h, code);
    expect(status).toBe(200);
    expect(body).toEqual({
      ok: true,
      room: { code, phase: 'playing', players: 3, capacity: 4, joinable: false, hubOwner: null },
    });
  });

  it('test/win declara vitória (results); finish é alias; close remove a sala', async () => {
    const { code } = await startedRoom(h, 3);
    const win = await postHub(h, '/__hub/test/win', code);
    expect(win.status).toBe(200);
    expect(win.body).toEqual({ ok: true });
    const ended = await getState(h, code);
    expect(ended.status).toBe(200);
    expect((ended.body as { room: { phase: string } }).room.phase).toBe('results');

    const finish = await postHub(h, '/__hub/test/finish', code);
    expect(finish.status).toBe(404); // já em game_over: nada a forçar

    const close = await postHub(h, '/__hub/close', code);
    expect(close.status).toBe(200);
    expect(close.body).toEqual({ ok: true });
    const gone = await getState(h, code);
    expect(gone.status).toBe(404);
    // Idempotente.
    const closeAgain = await postHub(h, '/__hub/close', code);
    expect(closeAgain.status).toBe(200);
    expect(closeAgain.body).toEqual({ ok: true });
  });

  it('close exige segredo', async () => {
    const { code } = await startedRoom(h, 3);
    const denied = await postHub(h, '/__hub/close', code, null);
    expect(denied.status).toBe(403);
    const stillThere = await getState(h, code);
    expect(stillThere.status).toBe(200);
  });
});

describe('hub: hooks de teste desligados', () => {
  let h: Harness;
  beforeEach(async () => {
    setHubEnv(false);
    h = await startHarness();
  });
  afterEach(async () => {
    await h.close();
    restoreHubEnv();
  });

  it('test/win sem HUB_TEST_HOOKS => 404 e partida segue', async () => {
    const { code } = await startedRoom(h, 3);
    const win = await postHub(h, '/__hub/test/win', code);
    expect(win.status).toBe(404);
    const playing = await getState(h, code);
    expect(playing.status).toBe(200);
    expect((playing.body as { room: { phase: string } }).room.phase).toBe('playing');
  });
});
