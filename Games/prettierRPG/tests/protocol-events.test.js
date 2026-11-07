'use strict';
// RED: protocolo ack/event por comando (aceito/recusado + broadcast compatível).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const WebSocket = require('ws');

let server; let PORT;
function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
function waitHttp200(port, tries = 60) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      http.get({ host: '127.0.0.1', port, path: '/', timeout: 2000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve(true);
        if (n <= 0) return reject(new Error('sem 200'));
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
  server = spawn('node', ['server.js'], { cwd: __dirname + '/..', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitHttp200(PORT);
});
after(() => { if (server) server.kill('SIGTERM'); });

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const queue = []; const c = { ws, queue, lastState: null, lastEvent: null, lastAck: null };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'state') c.lastState = m.snap;
      if (m.type === 'event') c.lastEvent = m;
      if (m.type === 'ack') c.lastAck = m;
      queue.push(m);
    });
    ws.on('open', () => resolve(c));
    ws.on('error', reject);
  });
}
function send(c, obj) { c.ws.send(JSON.stringify(obj)); }
function waitFor(c, pred, label, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const poll = () => {
      const i = c.queue.findIndex(pred);
      if (i >= 0) return resolve(c.queue.splice(i, 1)[0]);
      if (Date.now() - t0 > timeout) return reject(new Error('timeout: ' + label));
      setTimeout(poll, 50);
    };
    poll();
  });
}
const isJoined = (m) => m.type === 'joined';
async function newRoom(name, extra = {}) {
  const c = await connect();
  send(c, { type: 'join', nick: name, ...extra });
  const j = await waitFor(c, isJoined, 'joined ' + name);
  return { c, code: j.code, id: j.id, secret: j.secret };
}
async function joinRoom(name, code, extra = {}) {
  const c = await connect();
  send(c, { type: 'join', nick: name, room: code, ...extra });
  const j = await waitFor(c, isJoined, 'joined ' + name);
  return { c, code: j.code, id: j.id, secret: j.secret };
}

async function meet(a, b, timeout = 25000) {
  // aproxima no corredor leste (fora de obstáculos; spawns FFA caem em 92,92/92,8)
  a.c.queue.length = 0; b.c.queue.length = 0;
  send(a.c, { type: 'move', x: 90, y: 50 });
  send(b.c, { type: 'move', x: 92, y: 50 });
  await waitFor(a.c, (m) => {
    if (m.type !== 'state' || m.snap.state !== 'playing') return false;
    const pa = m.snap.players.find((p) => p.id === a.id);
    const pb = m.snap.players.find((p) => p.id === b.id);
    if (!pa || !pb) return false;
    return Math.hypot(pa.x - pb.x, pa.y - pb.y) <= 3.2;
  }, 'aproximação', timeout);
  // consome acks/events de move
  a.c.queue.length = 0; b.c.queue.length = 0;
}

test('evento: skill aceita gera ack ok + evento cast/hit compatível', async () => {
  const a = await newRoom('EvA');
  const b = await joinRoom('EvB', a.code);
  send(a.c, { type: 'ready', ready: true });
  send(b.c, { type: 'ready', ready: true });
  await waitFor(a.c, (m) => m.type === 'state' && m.snap.state === 'playing', 'início');
  await meet(a, b);
  send(a.c, { type: 'skill', slot: 'Q', skill: 'rending-strike', target: b.id });
  const ack = await waitFor(a.c, (m) => m.type === 'ack' && m.action === 'skill', 'ack skill');
  assert.equal(ack.ok, true, 'ack aceito: ' + JSON.stringify(ack));
  assert.equal(ack.action, 'skill', 'ack identifica ação');
  const ev = await waitFor(a.c, (m) => m.type === 'event', 'evento skill');
  assert.ok(['cast', 'hit', 'skill'].includes(ev.kind), 'evento lançamento/impacto: ' + ev.kind);
  assert.equal(ev.src, a.id, 'evento associa emissor');
  // snapshot compatível: ainda chega e expõe eventos
  const st = await waitFor(a.c, (m) => m.type === 'state', 'state pós-skill');
  assert.ok(Array.isArray(st.snap.events), 'snapshot expõe events (compat)');
  a.c.ws.close(); b.c.ws.close();
});

test('evento: skill recusada gera ack recusado com motivo + erro compatível', async () => {
  const a = await newRoom('EvR1');
  const b = await joinRoom('EvR2', a.code);
  send(a.c, { type: 'ready', ready: true });
  send(b.c, { type: 'ready', ready: true });
  await waitFor(a.c, (m) => m.type === 'state' && m.snap.state === 'playing', 'início');
  a.c.queue.length = 0;
  send(a.c, { type: 'skill', slot: 'Q', skill: 'rending-strike', target: a.id });
  const ack = await waitFor(a.c, (m) => m.type === 'ack' && m.ok === false, 'ack recusa');
  assert.match(ack.error || '', /si mesmo|inválido/i, 'motivo ao emissor');
  const err = await waitFor(a.c, (m) => m.type === 'error', 'erro compatível');
  assert.ok(err.msg, 'mantém type error legado');
  a.c.ws.close(); b.c.ws.close();
});

test('evento: dano absorvido por escudo gera aceito+bloqueio sem fingir dano HP', async () => {
  const a = await newRoom('ShA');
  const b = await joinRoom('ShB', a.code);
  send(a.c, { type: 'ready', ready: true });
  send(b.c, { type: 'ready', ready: true });
  await waitFor(a.c, (m) => m.type === 'state' && m.snap.state === 'playing', 'início');
  await meet(a, b);
  // b ativa escudo (HEAD energizing-shield 505/3s)
  send(b.c, { type: 'skill', slot: 'HEAD', skill: 'energizing-shield' });
  await waitFor(b.c, (m) => m.type === 'state' && m.snap.players.find((p) => p.id === b.id).shield > 0, 'escudo ativo', 15000);
  a.c.queue.length = 0; b.c.queue.length = 0;
  // a ataca b de perto: aceito imediato, absorvido total vira bloqueio
  send(a.c, { type: 'attack', target: b.id });
  const ack = await waitFor(a.c, (m) => m.type === 'ack' && m.action === 'attack', 'ack attack');
  assert.equal(ack.ok, true, 'ataque aceito mesmo absorvido: ' + JSON.stringify(ack));
  const ev = await waitFor(a.c, (m) => m.type === 'event' && (m.kind === 'blocked' || m.kind === 'hit'), 'evento bloqueio/impacto', 15000);
  assert.equal(ev.kind, 'blocked', 'absorvido total gera bloqueio, não hit fingido: ' + JSON.stringify(ev));
  assert.ok((ev.absorbed || 0) > 0, 'evento informa absorvido');
  assert.equal(ev.dmg || 0, 0, 'sem dano HP quando absorvido');
  a.c.ws.close(); b.c.ws.close();
});

test('evento: comandos consecutivos não sobrescrevem (ack por comando)', async () => {
  // self-buff sem posição (HEAD) para determinismo: 1º aceito, 2º em recarga
  const a = await newRoom('CcA');
  const b = await joinRoom('CcB', a.code);
  send(a.c, { type: 'ready', ready: true });
  send(b.c, { type: 'ready', ready: true });
  await waitFor(a.c, (m) => m.type === 'state' && m.snap.state === 'playing', 'início');
  a.c.queue.length = 0;
  send(a.c, { type: 'skill', slot: 'HEAD', skill: 'energizing-shield' });
  send(a.c, { type: 'skill', slot: 'HEAD', skill: 'energizing-shield' });
  const acks = [];
  for (let i = 0; i < 2; i++) acks.push(await waitFor(a.c, (m) => m.type === 'ack' && m.action === 'skill', 'ack ' + i));
  // 1º aceito, 2º recusado por recarga (sem erro cruzado/consumo duplo)
  assert.equal(acks[0].ok, true, '1º aceito');
  assert.equal(acks[1].ok, false, '2º recusado (CD) sem sobrescrever');
  assert.match(acks[1].error || '', /recarga/i);
  a.c.ws.close(); b.c.ws.close();
});

test('evento: ready recusado (2v2 sem equipe) gera ack+erro, sem confirmar', async () => {
  const a = await newRoom('RdyA', { mode: '2v2' });
  a.c.queue.length = 0;
  send(a.c, { type: 'ready', ready: true });
  const ack = await waitFor(a.c, (m) => m.type === 'ack' && m.action === 'ready', 'ack ready recusa');
  assert.equal(ack.ok, false, 'ready recusado tem ack ok:false');
  assert.match(ack.error || '', /equipe/i, 'motivo equipe ao emissor');
  const err = await waitFor(a.c, (m) => m.type === 'error', 'erro ready');
  assert.match(err.msg || '', /equipe/i, 'mantém type error legado');
  a.c.ws.close();
});

test('evento: toggle sem dano (assassin-spirit) emite cast, não hit', async () => {
  const dagger = { weapon: 'dagger', q: 'assassin-spirit', w: 'forbidden-stab', e: 'bloodthirsty-blade' };
  const a = await newRoom('TglA', { build: dagger });
  const b = await joinRoom('TglB', a.code, { build: dagger });
  send(a.c, { type: 'ready', ready: true });
  send(b.c, { type: 'ready', ready: true });
  await waitFor(a.c, (m) => m.type === 'state' && m.snap.state === 'playing', 'início');
  a.c.queue.length = 0;
  send(a.c, { type: 'skill', slot: 'Q', skill: 'assassin-spirit' });
  const ack = await waitFor(a.c, (m) => m.type === 'ack' && m.action === 'skill', 'ack toggle');
  assert.equal(ack.ok, true, 'toggle aceito');
  const ev = await waitFor(a.c, (m) => m.type === 'event' && m.action === 'skill', 'evento toggle');
  assert.equal(ev.kind, 'cast', 'toggled sem dano emite cast (sem som de acerto): ' + JSON.stringify(ev));
  a.c.ws.close(); b.c.ws.close();
});
