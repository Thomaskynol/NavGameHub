// VAVA — contrato htok com o Hub (hub/PROTOCOLO.md, R2).
// Unitários (RoomManager + handler HTTP com req/res falsos) + servidor real
// (spawn via tsx, caminhos derivados deste arquivo — sem caminho absoluto).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import WebSocket from 'ws';
import { RoomManager } from '../src/rooms.js';
import { createRequestHandler } from '../src/static.js';

const SECRET = 'vava-htok-unit-secret';

// ---------------------------------------------------------------------------
// Unit: RoomManager guarda o dono e fecha com identidade
// ---------------------------------------------------------------------------

test('dono: createWithCode guarda hubOwner; colisão/inválido retornam null', () => {
  const rooms = new RoomManager();
  const room = rooms.createWithCode('AB23', 'tok-launch-1');
  assert.ok(room);
  assert.equal(room.hubOwner, 'tok-launch-1');
  assert.equal(rooms.createWithCode('AB23', 'tok-outro'), null);
  assert.equal(rooms.createWithCode('AB23'), null);
  assert.equal(rooms.createWithCode('XX', 'tok'), null);
  assert.equal(rooms.createWithCode('!!!!', 'tok'), null);
  const legacy = rooms.createWithCode('CD34');
  assert.ok(legacy);
  assert.equal(legacy.hubOwner, null);
});

test('dono: close só fecha com o htok certo; legada fecha sem token', () => {
  const rooms = new RoomManager();
  rooms.createWithCode('AB23', 'tok-dono');
  assert.equal(rooms.close('AB23'), false);
  assert.equal(rooms.close('AB23', 'tok-errado'), false);
  assert.ok(rooms.get('AB23'), 'sala com dono segue intacta');
  assert.equal(rooms.close('AB23', 'tok-dono'), true);
  assert.equal(rooms.get('AB23'), undefined);
  assert.equal(rooms.close('AB23', 'tok-dono'), false, 'repetido é idempotente');

  rooms.createWithCode('CD34');
  assert.equal(rooms.close('CD34'), true, 'legada fecha sem token');
  rooms.createWithCode('EF56');
  assert.equal(rooms.close('EF56', 'tok-antigo-outra-partida'), false, 'htok em sala sem dono → preserva');
  assert.ok(rooms.get('EF56'), 'sala sem dono segue intacta após htok alheio');
  assert.equal(rooms.close('EF56', ''), true, 'htok vazio = ausente, fecha');
  rooms.createWithCode('GH78');
  assert.equal(rooms.close('GH78', null), true, 'legada fecha com null');
});

// ---------------------------------------------------------------------------
// Unit: handler HTTP (__hub/state inclui hubOwner; __hub/close estrito)
// ---------------------------------------------------------------------------

function fakeCall(
  handler: (req: never, res: never) => void,
  method: string,
  url: string,
  headers: Record<string, string> = {},
): { status: number; body: string } {
  let status = 0;
  let body = '';
  const req = { method, url, headers } as unknown as never;
  const res = {
    writeHead(code: number) {
      status = code;
    },
    end(chunk?: string) {
      body = chunk ?? '';
    },
  } as unknown as never;
  handler(req, res);
  return { status, body };
}

test('state inclui hubOwner (token ou null); close estrito com 403', () => {
  const rooms = new RoomManager();
  rooms.createWithCode('AB23', 'tok-launch-1');
  rooms.createWithCode('CD34');
  const handler = createRequestHandler({ rooms, secret: SECRET, hubTestHooks: false });
  const headers = { 'x-hub-secret': SECRET };

  const owned = fakeCall(handler, 'GET', '/__hub/state?room=AB23', headers);
  assert.equal(owned.status, 200);
  assert.equal(JSON.parse(owned.body).room.hubOwner, 'tok-launch-1');

  const legacy = fakeCall(handler, 'GET', '/__hub/state?room=CD34', headers);
  assert.equal(legacy.status, 200);
  assert.equal(JSON.parse(legacy.body).room.hubOwner, null);

  assert.equal(fakeCall(handler, 'GET', '/__hub/state?room=ZZ99', headers).status, 404);
  assert.equal(
    fakeCall(handler, 'GET', '/__hub/state?room=AB23', { 'x-hub-secret': 'errado' }).status,
    403,
  );

  assert.equal(fakeCall(handler, 'POST', '/__hub/close?room=AB23', headers).status, 403);
  assert.equal(fakeCall(handler, 'POST', '/__hub/close?room=AB23&htok=x', headers).status, 403);
  assert.ok(rooms.get('AB23'), 'sala com dono segue intacta após 403');
  const ok = fakeCall(handler, 'POST', '/__hub/close?room=AB23&htok=tok-launch-1', headers);
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.body), { ok: true, closed: true });
  assert.equal(fakeCall(handler, 'GET', '/__hub/state?room=AB23', headers).status, 404);

  const legacyClose = fakeCall(handler, 'POST', '/__hub/close?room=CD34', headers);
  assert.equal(legacyClose.status, 200);
  assert.equal(fakeCall(handler, 'GET', '/__hub/state?room=CD34', headers).status, 404);
});

test('close idempotente: repetição e código inexistente retornam 200 { ok:true, closed:false }', () => {
  const rooms = new RoomManager();
  rooms.createWithCode('AB23', 'tok-dono');
  const handler = createRequestHandler({ rooms, secret: SECRET, hubTestHooks: false });
  const headers = { 'x-hub-secret': SECRET };

  const first = fakeCall(handler, 'POST', '/__hub/close?room=AB23&htok=tok-dono', headers);
  assert.equal(first.status, 200);
  assert.deepEqual(JSON.parse(first.body), { ok: true, closed: true });

  const repeat = fakeCall(handler, 'POST', '/__hub/close?room=AB23&htok=tok-dono', headers);
  assert.equal(repeat.status, 200);
  assert.deepEqual(JSON.parse(repeat.body), { ok: true, closed: false });

  const missing = fakeCall(handler, 'POST', '/__hub/close?room=ZZ99&htok=tok-qualquer', headers);
  assert.equal(missing.status, 200);
  assert.deepEqual(JSON.parse(missing.body), { ok: true, closed: false });
});

test('close: htok em sala sem dono → 403 e preserva; sem htok fecha', () => {
  const rooms = new RoomManager();
  rooms.createWithCode('EF56');
  const handler = createRequestHandler({ rooms, secret: SECRET, hubTestHooks: false });
  const headers = { 'x-hub-secret': SECRET };

  const stale = fakeCall(handler, 'POST', '/__hub/close?room=EF56&htok=tok-antigo-outra-partida', headers);
  assert.equal(stale.status, 403);
  assert.ok(rooms.get('EF56'), 'sala sem dono segue intacta após close afiliado atrasado');

  const other = fakeCall(handler, 'POST', '/__hub/close?room=EF56&htok=tok-qualquer', headers);
  assert.equal(other.status, 403);
  assert.ok(rooms.get('EF56'), 'qualquer htok em sala sem dono preserva');

  const legit = fakeCall(handler, 'POST', '/__hub/close?room=EF56', headers);
  assert.equal(legit.status, 200);
  assert.deepEqual(JSON.parse(legit.body), { ok: true, closed: true });
  assert.equal(rooms.get('EF56'), undefined);
});

test('close: código reutilizado por outra partida não fecha sala alheia', () => {
  const rooms = new RoomManager();
  rooms.createWithCode('AB23', 'tok-partida-nova');
  const handler = createRequestHandler({ rooms, secret: SECRET, hubTestHooks: false });
  const headers = { 'x-hub-secret': SECRET };

  const stale = fakeCall(handler, 'POST', '/__hub/close?room=AB23&htok=tok-partida-antiga', headers);
  assert.equal(stale.status, 403, 'htok da partida antiga não fecha a nova');
  assert.ok(rooms.get('AB23'), 'sala da partida nova intacta');
  assert.equal(rooms.get('AB23')?.hubOwner, 'tok-partida-nova');

  const ok = fakeCall(handler, 'POST', '/__hub/close?room=AB23&htok=tok-partida-nova', headers);
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.body), { ok: true, closed: true });
});

// ---------------------------------------------------------------------------
// Servidor real: join com htok (guarda, resume legítimo, recusa sem entrada)
// ---------------------------------------------------------------------------

const testDir = fileURLToPath(new URL('.', import.meta.url));
const vavaRoot = resolve(testDir, '..', '..', '..');
const tsxCli = join(vavaRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(vavaRoot, 'packages', 'server', 'src', 'index.ts');
const REAL_SECRET = 'vava-htok-real-secret';

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function killTree(child: ChildProcess): void {
  try {
    if (child.exitCode === null && child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // já encerrado
    }
  }
}

async function startServer(t: { after: (fn: () => void) => void }): Promise<number> {
  const port = await freePort();
  const child = spawn(process.execPath, [tsxCli, serverEntry], {
    cwd: vavaRoot,
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      HUB_SECRET: REAL_SECRET,
      HUB_TEST_HOOKS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => killTree(child));
  await new Promise<void>((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error('VAVA não iniciou a tempo')), 30000);
    const check = (): void => {
      fetch(`http://127.0.0.1:${port}/health`).then((response) => {
        if (response.ok) {
          clearTimeout(timer);
          resolvePromise();
        } else {
          setTimeout(check, 100);
        }
      }).catch(() => setTimeout(check, 100));
    };
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`VAVA saiu com código ${code}`));
    });
    check();
  });
  return port;
}

function sendOnce(ws: WebSocket, payload: unknown, timeout = 5000): Promise<{ t: string } & Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', onMessage);
      reject(new Error('tempo esgotado esperando resposta do jogo'));
    }, timeout);
    function onMessage(data: WebSocket.RawData): void {
      let message: unknown;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (typeof message === 'object' && message !== null && ((message as { t?: unknown }).t === 'joined' || (message as { t?: unknown }).t === 'error')) {
        clearTimeout(timer);
        ws.removeListener('message', onMessage);
        resolvePromise(message as { t: string } & Record<string, unknown>);
      }
    }
    ws.on('message', onMessage);
    ws.send(JSON.stringify(payload));
  });
}

async function openSocket(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise<void>((resolvePromise, reject) => {
    ws.once('open', () => resolvePromise());
    ws.once('error', reject);
  });
  return ws;
}

async function hubState(port: number, code: string): Promise<{ status: number; room: Record<string, unknown> | null }> {
  const response = await fetch(`http://127.0.0.1:${port}/__hub/state?room=${code}`, {
    headers: { 'x-hub-secret': REAL_SECRET },
  });
  const text = await response.text();
  let room: Record<string, unknown> | null = null;
  try {
    room = (JSON.parse(text) as { room?: Record<string, unknown> }).room ?? null;
  } catch {
    room = null;
  }
  return { status: response.status, room };
}

test('servidor real: join mesmo htok entra; divergente/sem-dono recusa sem entrar; sem htok é legado', async (t) => {
  const port = await startServer(t);
  const sockets: WebSocket[] = [];
  t.after(() => {
    for (const ws of sockets) {
      try {
        ws.terminate();
      } catch {
        // já encerrado
      }
    }
  });
  const fresh = async (): Promise<WebSocket> => {
    const ws = await openSocket(port);
    sockets.push(ws);
    return ws;
  };

  // Sala com dono via create do Hub.
  const s1 = await fresh();
  const created = await sendOnce(s1, { t: 'create', code: 'AB23', name: 'Alice', htok: 'tok-launch-1' });
  assert.equal(created.t, 'joined');

  // Join com o mesmo htok: resume/startHub legítimo entra.
  const s2 = await fresh();
  const retry = await sendOnce(s2, { t: 'join', code: 'AB23', name: 'Alice2', htok: 'tok-launch-1' });
  assert.equal(retry.t, 'joined');

  // Join com htok divergente: recusado, sem entrar.
  const s3 = await fresh();
  const clash = await sendOnce(s3, { t: 'join', code: 'AB23', name: 'Eve', htok: 'tok-outro' });
  assert.equal(clash.t, 'error');
  assert.match(String(clash.message), /OWNER_MISMATCH/);

  // Join sem htok em sala com dono: legado preservado, entra.
  const s4 = await fresh();
  const legacy = await sendOnce(s4, { t: 'join', code: 'AB23', name: 'Mallory' });
  assert.equal(legacy.t, 'joined');

  let state = await hubState(port, 'AB23');
  assert.equal(state.status, 200);
  assert.equal(state.room?.players, 3, 'recusa não entrou; resto entrou');
  assert.equal(state.room?.hubOwner, 'tok-launch-1');

  // Join com htok em sala sem dono: recusado, sem entrar.
  const s5 = await fresh();
  const manual = await sendOnce(s5, { t: 'create', code: 'CD34', name: 'Bob' });
  assert.equal(manual.t, 'joined');
  const s6 = await fresh();
  const intruder = await sendOnce(s6, { t: 'join', code: 'CD34', name: 'Eve', htok: 'tok-x' });
  assert.equal(intruder.t, 'error');
  assert.match(String(intruder.message), /OWNER_MISMATCH/);

  // Join sem htok em sala sem dono: legado, entra.
  const s7 = await fresh();
  const friend = await sendOnce(s7, { t: 'join', code: 'CD34', name: 'Carol' });
  assert.equal(friend.t, 'joined');

  state = await hubState(port, 'CD34');
  assert.equal(state.status, 200);
  assert.equal(state.room?.players, 2, 'recusa não entrou; legado entrou');
  assert.equal(state.room?.hubOwner, null);
});

test('servidor real: close atrasado com htok alheio não derruba sala (a–g)', async (t) => {
  const port = await startServer(t);
  const sockets: WebSocket[] = [];
  t.after(() => {
    for (const ws of sockets) {
      try {
        ws.terminate();
      } catch {
        // já encerrado
      }
    }
  });
  const headers = { 'x-hub-secret': REAL_SECRET };
  async function hubClose(code: string, htok?: string): Promise<{ status: number; body: string }> {
    const qs = htok === undefined ? `room=${code}` : `room=${code}&htok=${encodeURIComponent(htok)}`;
    const response = await fetch(`http://127.0.0.1:${port}/__hub/close?${qs}`, {
      method: 'POST',
      headers,
    });
    return { status: response.status, body: await response.text() };
  }

  // (d) sala independente sem dono + close com htok antigo → 403 + preserva.
  const w1 = await openSocket(port);
  sockets.push(w1);
  await sendOnce(w1, { t: 'create', code: 'EF56', name: 'Solo' });
  let res = await hubClose('EF56', 'tok-antigo-outra-partida');
  assert.equal(res.status, 403, '(d) htok em sala sem dono → 403');
  let state = await hubState(port, 'EF56');
  assert.equal(state.status, 200, '(d) sala sem dono preservada');
  assert.equal(state.room?.hubOwner, null);

  // (e) sala independente sem htok fecha (legítimo).
  res = await hubClose('EF56');
  assert.equal(res.status, 200, '(e) sem htok fecha sala sem dono');
  state = await hubState(port, 'EF56');
  assert.equal(state.status, 404, '(e) sala fechada some do state');

  // (a–c,f) sala com dono: sem/diferente → 403 + preserva; dono fecha.
  const w2 = await openSocket(port);
  sockets.push(w2);
  await sendOnce(w2, { t: 'create', code: 'AB23', name: 'Alice', htok: 'tok-partida-nova' });

  res = await hubClose('AB23');
  assert.equal(res.status, 403, '(c) sem htok em sala com dono → 403');
  res = await hubClose('AB23', 'tok-partida-antiga');
  assert.equal(res.status, 403, '(b,f) htok antigo/divergente → 403');
  state = await hubState(port, 'AB23');
  assert.equal(state.status, 200, 'sala com dono intacta após recusas');
  assert.equal(state.room?.hubOwner, 'tok-partida-nova');

  res = await hubClose('AB23', 'tok-partida-nova');
  assert.equal(res.status, 200, '(a) dono fecha');
  assert.deepEqual(JSON.parse(res.body), { ok: true, closed: true }, '(a) dono fecha com closed:true');
  state = await hubState(port, 'AB23');
  assert.equal(state.status, 404, 'sala do dono fechada');

  res = await hubClose('AB23', 'tok-partida-nova');
  assert.equal(res.status, 200, 'repetição idempotente');
  assert.deepEqual(JSON.parse(res.body), { ok: true, closed: false }, 'repetição informa closed:false');

  // (g) segredo errado → 403; state de sala inexistente → 404.
  const bad = await fetch(`http://127.0.0.1:${port}/__hub/close?room=AB23`, {
    method: 'POST',
    headers: { 'x-hub-secret': 'errado' },
  });
  assert.equal(bad.status, 403, '(g) segredo errado → 403');
  state = await hubState(port, 'ZZ99');
  assert.equal(state.status, 404, '(g) state inexistente → 404');
});
