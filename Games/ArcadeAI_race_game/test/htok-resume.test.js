// Asfalto Vivo — regressão R2-parte-Arcade (contrato htok) + R4 (resume no Hub).
// Nível protocolo/servidor (sem navegador) + parsing puro do launch (?htok=).
// Espelha as sondas reproduce_arcade_reconnect.mjs e reproduce_collision.mjs
// como asserções positivas: o comportamento problemático NÃO pode reaparecer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createRooms } from '../server/rooms.js';
import { startServer } from '../server/index.js';
import { parseHubParams, hubResumeAction } from '../public/js/hub.js';

const TRACKS = {
  teste: {
    id: 'teste',
    name: 'Circuito Teste',
    points: [[0, 0], [100, 0], [100, 100], [0, 100]],
    widths: [10, 10, 10, 10],
  },
};

function makeConn(id) {
  return {
    id,
    inbox: [],
    closed: false,
    player: null,
    room: null,
    send(obj) { this.inbox.push(obj); },
    close() { this.closed = true; },
    last(t) { return [...this.inbox].reverse().find((m) => m.t === t); },
  };
}

function makeRooms(opts = {}) {
  const rooms = createRooms({
    tracks: TRACKS,
    timings: { reconnectMs: 25 },
    raceFactory() {
      return {
        onSt() {}, onReadyLoad() {}, onDisconnect() {}, onReconnect() {},
        onPlayerRemoved() {}, modeFor: () => 'race', snapshotState: () => ({}),
        dispose() {},
      };
    },
    ...opts,
  });
  return rooms;
}

function create(rooms, name, color, id = name, extra = {}) {
  const conn = makeConn(id);
  rooms.handleMessage(conn, { t: 'create', name, color, ...extra });
  return conn;
}

function join(rooms, code, name, color, id = name, extra = {}) {
  const conn = makeConn(id);
  rooms.handleMessage(conn, { t: 'join', room: code, name, color, ...extra });
  return conn;
}

const C1 = '#e5484d', C2 = '#3b82f6', C3 = '#30b566', C4 = '#f5a524',
  C5 = '#8b5cf6', C6 = '#f97316', C7 = '#14b8a6';

// --- launch (?htok=) ---

test('hub: htok válido/inválido/ausente no parsing do launch', () => {
  assert.equal(parseHubParams('?hub=1&room=ABCDEF&name=Ana&htok=H1abc-_9').htok, 'H1abc-_9');
  assert.equal(parseHubParams('?hub=1&room=ABCDEF&name=Ana').htok, null);
  assert.equal(parseHubParams('?hub=1&room=ABCDEF&name=Ana&htok=%20%20').htok, null);
  assert.equal(parseHubParams('?hub=1&room=ABCDEF&name=Ana&htok=X!Y').htok, null);
  assert.equal(parseHubParams('?hub=1&room=ABCDEF&name=Ana&htok=' + 'a'.repeat(65)).htok, null);
});

test('hub: resume só com sessão da mesma partida (room+name+token)', () => {
  const hub = { room: 'ABCDEF', name: 'Ana' };
  const ok = hubResumeAction(hub, { room: 'ABCDEF', name: 'Ana', token: 'tok' });
  assert.equal(ok.type, 'resume');
  assert.equal(ok.token, 'tok');
  assert.equal(hubResumeAction(hub, null).type, 'fresh');
  assert.equal(hubResumeAction(hub, { room: 'ABCDEF', name: 'Ana' }).type, 'fresh', 'sem token → fresh');
  assert.equal(hubResumeAction(hub, { room: 'ABCDEF', name: 'Bia', token: 'tok' }).type, 'fresh', 'outro nome → fresh');
  assert.equal(hubResumeAction(hub, { room: 'ZZZZZZ', name: 'Ana', token: 'tok' }).type, 'fresh', 'outra sala → fresh');
});

// --- R4: sala cheia — join novo FULL vs resume entra ---

test('R4: sala cheia — join novo sem token leva FULL; resume com token entra (mesmo id)', () => {
  const rooms = makeRooms();
  const host = create(rooms, 'Alice', C1, 'host', { room: 'FULL22', htok: 'hub-a' });
  assert.ok(host.last('joined'));
  for (let i = 2; i <= 6; i++) {
    const c = join(rooms, 'FULL22', `Player${i}`, [C2, C3, C4, C5, C6][i - 2], `p${i}`);
    assert.ok(c.last('joined'), `Player${i} entra`);
  }
  rooms.onClose(host); // Alice desconecta; vaga retida na janela
  assert.equal(rooms.getRoom('FULL22').players.find((p) => p.dname === 'Alice').conn, null);

  const fresh = join(rooms, 'FULL22', 'Alice', C7, 'fresh');
  assert.equal(fresh.last('err')?.code, 'FULL', 'join novo sem token não fura a fila');

  const resumed = join(rooms, 'FULL22', 'Alice', C7, 'resumed', { resume: host.last('joined').token });
  assert.ok(resumed.last('joined'), 'resume com token entra em sala cheia');
  assert.equal(resumed.last('joined').you, host.last('joined').you, 'mesma identidade, sem duplicata');
  assert.equal(rooms.getRoom('FULL22').players.length, 6, 'sem jogador duplicado');
  rooms.destroy();
});

// --- R2: htok — livre cria com dono; mesmo dono retry; outro dono CODE_TAKEN ---

test('R2: create livre guarda dono; retry mesmo htok entra/resume; colisão → CODE_TAKEN', () => {
  const rooms = makeRooms();
  const a = create(rooms, 'Alpha', C1, 'a', { room: 'HTKK22', htok: 'hub-a' });
  assert.equal(a.last('joined').room, 'HTKK22');
  assert.equal(rooms.getRoom('HTKK22').htok, 'hub-a', 'criação livre guarda o dono');

  // Colisão: outro dono e sem dono → CODE_TAKEN (sem entrada cega).
  const b = create(rooms, 'Charlie', C2, 'b', { room: 'HTKK22', htok: 'hub-b' });
  assert.equal(b.last('err')?.code, 'CODE_TAKEN');
  assert.equal(rooms.getRoom('HTKK22').players.length, 1, 'colisão não entrou');
  const c = create(rooms, 'Delta', C3, 'c', { room: 'HTKK22' });
  assert.equal(c.last('err')?.code, 'CODE_TAKEN');

  // Retentativa legítima (mesmo htok, ex. reload do iframe com ?create=1):
  // entra direto, sem CODE_TAKEN e sem duplicar ninguém.
  const a2 = create(rooms, 'Alpha2', C2, 'a2', { room: 'HTKK22', htok: 'hub-a' });
  assert.ok(a2.last('joined'), 'retry mesmo htok entra sem CODE_TAKEN');
  assert.equal(a2.last('joined').room, 'HTKK22');
  assert.equal(rooms.getRoom('HTKK22').players.length, 2);

  // Retry com resume após desconexão: reanexa a MESMA identidade.
  rooms.onClose(a);
  const a3 = create(rooms, 'Alpha', C1, 'a3', {
    room: 'HTKK22', htok: 'hub-a', resume: a.last('joined').token,
  });
  assert.ok(a3.last('joined'), 'retry com resume reanexa');
  assert.equal(a3.last('joined').you, a.last('joined').you, 'mesmo id');
  assert.equal(rooms.getRoom('HTKK22').players.length, 2, 'sem duplicata');
  rooms.destroy();
});

test('R2: sala sem dono (manual/legada) mantém CODE_TAKEN em código ocupado', () => {
  const rooms = makeRooms();
  const a = create(rooms, 'Host', C1, 'a', { room: 'LEG222' });
  assert.equal(a.last('joined').room, 'LEG222');
  assert.equal(rooms.getRoom('LEG222').htok, null);
  const b = create(rooms, 'Outro', C2, 'b', { room: 'LEG222', htok: 'hub-x' });
  assert.equal(b.last('err')?.code, 'CODE_TAKEN', 'sem dono afiliado não há retry');
  rooms.destroy();
});

// --- R2: close com identidade (HTTP) ---

test('R2: /__hub/close só fecha com o mesmo htok; sala segue intacta sem ele', async () => {
  const srv = await startServer({ port: 0, tracks: TRACKS, secret: 't', timings: { reconnectMs: 25 } });
  const sockets = [];
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const headers = { 'x-hub-secret': 't', 'content-type': 'application/json' };
    async function wsJoin(payload) {
      const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
      sockets.push(ws);
      await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
      const got = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 3000);
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.t === 'joined' || msg.t === 'err') { clearTimeout(timer); resolve(msg); }
        });
        ws.send(JSON.stringify(payload));
      });
      ws.terminate(); // fecha antes de asserir: falha não pode pendurar srv.close()
      return got;
    }

    const g1 = await wsJoin({ t: 'create', name: 'Host', color: C1, room: 'PWN232', htok: 'hub-a' });
    assert.equal(g1.t, 'joined');

    let res = await fetch(`${base}/__hub/close?room=PWN232`, { method: 'POST', headers });
    assert.equal(res.status, 403, 'sem htok → 403');
    assert.ok(srv.rooms.getRoom('PWN232'), 'sala com dono segue intacta');

    res = await fetch(`${base}/__hub/close?room=PWN232&htok=hub-b`, { method: 'POST', headers });
    assert.equal(res.status, 403, 'htok errado → 403');
    assert.ok(srv.rooms.getRoom('PWN232'), 'sala com dono segue intacta');

    res = await fetch(`${base}/__hub/close?room=PWN232&htok=hub-a`, { method: 'POST', headers });
    assert.equal(res.status, 200, 'dono fecha');
    assert.equal(srv.rooms.getRoom('PWN232'), null, 'sala fechada pelo dono');

    // Sala sem dono: comportamento anterior (só segredo do Hub).
    const g2 = await wsJoin({ t: 'create', name: 'Solo', color: C2, room: 'FREE33' });
    assert.equal(g2.room, 'FREE33');
    res = await fetch(`${base}/__hub/close?room=FREE33`, { method: 'POST', headers });
    assert.equal(res.status, 200);
    assert.equal(srv.rooms.getRoom('FREE33'), null);
  } finally {
    for (const ws of sockets) { try { ws.terminate(); } catch { /* ok */ } }
    await srv.close();
  }
});
