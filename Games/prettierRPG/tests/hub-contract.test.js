'use strict';
// Contrato Hub <-> prettierRPG (fonte: hub/PROTOCOLO.md).
// Mode usado abaixo: 'ffa' é FIXTURE PROVISÓRIA explícita p/ teste — NÃO é
// decisão de produto sobre onde/quando o modo é escolhido (pendente Thomas).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const WebSocket = require('ws');

const sim = require('../lib/sim');
const hub = require('../lib/hub');

const HUB_SECRET = 'contrato-test-secret';
const PROVISIONAL_MODE = 'ffa'; // fixture explícita; sem decisão de produto

function mkRooms() { return new Map(); }
function mkMatch(code, mode, n = 0) {
  const m = sim.createMatch(code, { mode });
  for (let i = 0; i < n; i++) sim.joinPlayer(m, `${code}${i}`, `N${code}${i}`, undefined);
  return m;
}
function putRoom(rooms, code, mode = PROVISIONAL_MODE, n = 0) {
  const m = mkMatch(code, mode, n);
  rooms.set(code, { match: m, pendingRemove: new Map(), conns: new Map(), secrets: new Map() });
  return m;
}

// ---------- lib/hub: envelope + dono ----------

test('hub state: envelope {ok:true, room:{...}} com fases do contrato', () => {
  process.env.HUB_SECRET = HUB_SECRET;
  try {
    const rooms = mkRooms();
    const m = putRoom(rooms, 'AAAA');
    hub.remember('AAAA', 'tok-dono');
    const s = hub.stateOf(rooms, 'AAAA', null);
    assert.equal(s.status, 200);
    assert.equal(s.body.ok, true);
    assert.equal(s.body.room.code, 'AAAA');
    assert.equal(s.body.room.phase, 'lobby');
    assert.equal(s.body.room.hubOwner, 'tok-dono', 'dono visível já na criação (sem esperar close)');
    m.state = 'playing';
    assert.equal(hub.stateOf(rooms, 'AAAA', null).body.room.phase, 'playing');
    m.state = 'ended';
    assert.equal(hub.stateOf(rooms, 'AAAA', null).body.room.phase, 'results', 'ended mapeia p/ results');
  } finally { delete process.env.HUB_SECRET; hub._owners.clear(); }
});

test('hub state: 404 livre e 409 CODE_TAKEN em htok divergente', () => {
  process.env.HUB_SECRET = HUB_SECRET;
  try {
    const rooms = mkRooms();
    putRoom(rooms, 'BBBB');
    hub.remember('BBBB', 'tok-a');
    const livre = hub.stateOf(rooms, 'ZZZZ', null);
    assert.equal(livre.status, 404);
    assert.equal(livre.body.ok, false);
    const conflito = hub.stateOf(rooms, 'BBBB', 'tok-b');
    assert.equal(conflito.status, 409);
    assert.match(conflito.body.error || '', /CODE_TAKEN/);
    const mesma = hub.stateOf(rooms, 'BBBB', 'tok-a');
    assert.equal(mesma.status, 200, 'retentativa legítima (mesmo htok) não é conflito');
  } finally { delete process.env.HUB_SECRET; hub._owners.clear(); }
});

test('hub close: dono confere; divergente/ausente preserva; sem dono + htok preserva', () => {
  process.env.HUB_SECRET = HUB_SECRET;
  try {
    const rooms = mkRooms();
    putRoom(rooms, 'CCCC');
    hub.remember('CCCC', 'tok-a');
    const errado = hub.closeRoom(rooms, 'CCCC', 'tok-b', HUB_SECRET);
    assert.equal(errado.status, 403);
    assert.ok(rooms.has('CCCC'), 'close divergente não remove (sem cross-launch close)');
    const semHtok = hub.closeRoom(rooms, 'CCCC', null, HUB_SECRET);
    assert.equal(semHtok.status, 403, 'com dono, htok ausente também recusa');
    assert.ok(rooms.has('CCCC'));
    // Sala standalone (sem dono): close afiliado com htok NÃO fecha.
    putRoom(rooms, 'DDDD');
    const afiliado = hub.closeRoom(rooms, 'DDDD', 'tok-outro-launch', HUB_SECRET);
    assert.equal(afiliado.status, 403);
    assert.ok(rooms.has('DDDD'), 'standalone preservada diante de close com htok');
    // Sala standalone: close legítimo sem htok fecha.
    const legit = hub.closeRoom(rooms, 'DDDD', null, HUB_SECRET);
    assert.equal(legit.status, 200);
    assert.equal(legit.body.closed, true);
    // Dono certo fecha; repetir é idempotente.
    const certo = hub.closeRoom(rooms, 'CCCC', 'tok-a', HUB_SECRET);
    assert.equal(certo.status, 200);
    assert.equal(certo.body.closed, true);
    const outraVez = hub.closeRoom(rooms, 'CCCC', 'tok-a', HUB_SECRET);
    assert.equal(outraVez.status, 200);
    assert.equal(outraVez.body.closed, false);
  } finally { delete process.env.HUB_SECRET; hub._owners.clear(); }
});

// ---------- servidor real: criação dirigida pelo Hub vs standalone ----------

let server;
let PORT;

function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
function waitHttp200(port, tries = 60) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      http.get({ host: '127.0.0.1', port, path: '/health', timeout: 2000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve(true);
        if (n <= 0) return reject(new Error('sem 200, status=' + res.statusCode));
        setTimeout(() => attempt(n - 1), 200);
      }).on('error', () => {
        if (n <= 0) return reject(new Error('servidor não subiu'));
        setTimeout(() => attempt(n - 1), 200);
      });
    };
    attempt(tries);
  });
}

before(async () => {
  PORT = await freePort();
  server = spawn('node', ['server.js'], {
    cwd: __dirname + '/..',
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', HUB_SECRET },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', () => {});
  await waitHttp200(PORT);
});
after(() => { if (server) server.kill('SIGTERM'); });

function hubGet(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path, headers: { 'x-hub-secret': HUB_SECRET }, timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    }).on('error', reject);
  });
}
function hubPost(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path, method: 'POST', headers: { 'x-hub-secret': HUB_SECRET }, timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.end();
  });
}
function connectWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const queue = [];
    ws.on('message', (raw) => queue.push(JSON.parse(raw.toString())));
    ws.on('open', () => resolve({ ws, queue }));
    ws.on('error', reject);
  });
}
function waitFor(c, pred, label, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const poll = () => {
      const i = c.queue.findIndex(pred);
      if (i >= 0) return resolve(c.queue.splice(i, 1)[0]);
      if (Date.now() - t0 > timeout) return reject(new Error('timeout esperando: ' + label));
      setTimeout(poll, 50);
    };
    poll();
  });
}
const isJoined = (m) => m.type === 'joined';
const isErr = (m) => m.type === 'error';

test('health: GET /health responde 2xx', async () => {
  const r = await hubGet('/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('hub-directed: join com room+htok cria a sala com o código do Hub e registra o dono', async () => {
  const c = await connectWs();
  c.ws.send(JSON.stringify({ type: 'join', nick: 'HubA', room: 'HQ11', htok: 'htok-launch-1', mode: PROVISIONAL_MODE }));
  const j = await waitFor(c, isJoined, 'joined HubA');
  assert.equal(j.code, 'HQ11', 'nunca gera outro código em silêncio');
  const st = await hubGet('/__hub/state?room=HQ11');
  assert.equal(st.status, 200);
  assert.equal(st.body.ok, true);
  assert.equal(st.body.room.code, 'HQ11');
  assert.equal(st.body.room.phase, 'lobby');
  assert.equal(st.body.room.hubOwner, 'htok-launch-1', 'dono registrado na criação, antes de qualquer close');
  assert.equal(typeof st.body.room.players, 'number');
  assert.equal(typeof st.body.room.capacity, 'number');
  assert.equal(typeof st.body.room.joinable, 'boolean');
  c.ws.close();
});

test('hub-directed: retentativa legítima (mesmo código + mesmo htok) entra; colisão (htok divergente) recebe CODE_TAKEN', async () => {
  const a = await connectWs();
  a.ws.send(JSON.stringify({ type: 'join', nick: 'HubB', room: 'HQ22', htok: 'htok-launch-2', mode: PROVISIONAL_MODE }));
  await waitFor(a, isJoined, 'joined HubB');
  const b = await connectWs();
  b.ws.send(JSON.stringify({ type: 'join', nick: 'HubC', room: 'HQ22', htok: 'htok-launch-2', mode: PROVISIONAL_MODE }));
  const j = await waitFor(b, isJoined, 'rejoin legítimo');
  assert.equal(j.code, 'HQ22');
  const intruso = await connectWs();
  intruso.ws.send(JSON.stringify({ type: 'join', nick: 'X9', room: 'HQ22', htok: 'htok-outro-launch', mode: PROVISIONAL_MODE }));
  const e = await waitFor(intruso, isErr, 'CODE_TAKEN do intruso');
  assert.match(e.msg, /CODE_TAKEN/);
  a.ws.close(); b.ws.close(); intruso.ws.close();
});

test('standalone intacto: sem htok, código vazio cria aleatória; código inexistente não cria', async () => {
  const a = await connectWs();
  a.ws.send(JSON.stringify({ type: 'join', nick: 'SoloA', mode: PROVISIONAL_MODE }));
  const j = await waitFor(a, isJoined, 'joined SoloA');
  assert.match(j.code, /^[A-Z0-9]{4}$/);
  const st = await hubGet(`/__hub/state?room=${j.code}`);
  assert.equal(st.body.room.hubOwner, null, 'standalone nasce sem dono');
  const b = await connectWs();
  b.ws.send(JSON.stringify({ type: 'join', nick: 'SoloB', room: 'ZZ99', mode: PROVISIONAL_MODE }));
  const e = await waitFor(b, isErr, 'sala inexistente sem htok');
  assert.doesNotMatch(e.msg, /CODE_TAKEN/, 'standalone sem htok não inventa CODE_TAKEN');
  a.ws.close(); b.ws.close();
});

test('close fim-a-fim: htok certo fecha, sala some (404); htok errado preserva', async () => {
  const a = await connectWs();
  a.ws.send(JSON.stringify({ type: 'join', nick: 'HubD', room: 'HQ33', htok: 'htok-launch-3', mode: PROVISIONAL_MODE }));
  await waitFor(a, isJoined, 'joined HubD');
  const ruim = await hubPost('/__hub/close?room=HQ33&htok=htok-errado');
  assert.equal(ruim.status, 403);
  const aindaLa = await hubGet('/__hub/state?room=HQ33');
  assert.equal(aindaLa.status, 200, 'close divergente preserva a sala');
  const bom = await hubPost('/__hub/close?room=HQ33&htok=htok-launch-3');
  assert.equal(bom.status, 200);
  assert.equal(bom.body.closed, true);
  const sumiu = await hubGet('/__hub/state?room=HQ33');
  assert.equal(sumiu.status, 404);
  a.ws.close();
});
