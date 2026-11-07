const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const WebSocket = require('ws');

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
      http.get({ host: '127.0.0.1', port, path: '/', timeout: 2000 }, (res) => {
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
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', () => {});
  await waitHttp200(PORT);
});

after(() => { if (server) server.kill('SIGTERM'); });

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const queue = [];
    const c = { ws, queue, lastState: null };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'state') c.lastState = m.snap;
      queue.push(m);
    });
    ws.on('open', () => resolve(c));
    ws.on('error', reject);
  });
}

function send(c, obj) { c.ws.send(JSON.stringify(obj)); }

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

test('protocolo: 2 clientes entram, prontos iniciam FFA', async () => {
  const a = await newRoom('ProtoA');
  const b = await joinRoom('ProtoB', a.code);
  send(a.c, { type: 'ready', ready: true });
  send(b.c, { type: 'ready', ready: true });
  const st = await waitFor(a.c, (m) => m.type === 'state' && m.snap.state === 'playing', 'início');
  assert.equal(st.snap.players.length, 2);
  a.c.ws.close(); b.c.ws.close();
});

test('protocolo: apelido duplicado é recusado', async () => {
  const a = await newRoom('Duplo');
  const b = await connect();
  send(b, { type: 'join', nick: 'duplo', room: a.code });
  const e = await waitFor(b, isErr, 'erro duplicado');
  assert.match(e.msg, /já usado/i);
  a.c.ws.close(); b.ws.close();
});

test('protocolo: skill inválida (auto-alvo) gera erro e não gasta energia', async () => {
  const a = await newRoom('Atk');
  const b = await joinRoom('Vit', a.code);
  send(a.c, { type: 'ready', ready: true });
  send(b.c, { type: 'ready', ready: true });
  await waitFor(a.c, (m) => m.type === 'state' && m.snap.state === 'playing', 'início');
  const before = a.c.lastState.players.find((p) => p.id === a.id).en;
  send(a.c, { type: 'skill', slot: 'Q', skill: 'rending-strike', target: a.id });
  const e = await waitFor(a.c, isErr, 'erro auto-alvo');
  assert.match(e.msg, /si mesmo|próprio|inválido/i);
  send(a.c, { type: 'move', x: 50, y: 50 });
  await waitFor(a.c, (m) => m.type === 'state', 'snapshot pós-erro');
  const afterEn = a.c.lastState.players.find((p) => p.id === a.id).en;
  assert.ok(afterEn >= before - 0.5, `energia preservada após alvo inválido (${before} -> ${afterEn})`);
  a.c.ws.close(); b.c.ws.close();
});

test('protocolo: ataque básico reduz vida visível no snapshot', async () => {
  const a = await newRoom('Atk2');
  const b = await joinRoom('Vit2', a.code);
  send(a.c, { type: 'ready', ready: true });
  send(b.c, { type: 'ready', ready: true });
  await waitFor(a.c, (m) => m.type === 'state' && m.snap.state === 'playing', 'início');
  const hpAntes = a.c.lastState.players.find((p) => p.id === b.id).hp;
  // Fora de alcance: o servidor persegue e ataca ao alcançar (chase).
  send(a.c, { type: 'attack', target: b.id });
  await waitFor(a.c, (m) => {
    if (m.type !== 'state') return false;
    const t = m.snap.players.find((p) => p.id === b.id);
    return t && t.hp < hpAntes;
  }, 'dano no snapshot', 30000);
  assert.ok(true, `vida caiu de ${hpAntes}`);
  a.c.ws.close(); b.c.ws.close();
});

test('protocolo: salas isoladas', async () => {
  const a = await newRoom('IsoA');
  const b = await newRoom('IsoB');
  assert.notEqual(a.code, b.code);
  assert.ok(!a.c.lastState.players.some((p) => p.nick === 'IsoB'), 'jogador da outra sala não aparece');
  a.c.ws.close(); b.c.ws.close();
});

test('protocolo: reconexão com segredo retoma a vaga', async () => {
  const a = await newRoom('Cai');
  const b = await joinRoom('Fica', a.code);
  send(a.c, { type: 'ready', ready: true });
  send(b.c, { type: 'ready', ready: true });
  await waitFor(a.c, (m) => m.type === 'state' && m.snap.state === 'playing', 'início');
  a.c.ws.close(); // queda involuntária
  await new Promise((r) => setTimeout(r, 500));
  const c = await connect();
  send(c, { type: 'join', nick: 'Cai', room: a.code, secret: a.secret });
  const jr = await waitFor(c, isJoined, 'rejoin');
  assert.equal(jr.reconnected, true);
  assert.equal(jr.id, a.id);
  b.c.ws.close(); c.ws.close();
});

test('protocolo PvE: resets de dano e cura são independentes', async () => {
  const { c, id } = await newRoom('Solo', {
    mode: 'pve',
    build: { weapon: 'holy-staff', q: 'generous-heal', w: 'holy-beam', e: 'desperate-prayer' },
  });
  send(c, { type: 'ready', ready: true });
  await waitFor(c, (m) => m.type === 'state' && m.snap.state === 'playing', 'treino ativo', 15000);
  const me = () => c.lastState.players.find((p) => p.id === id);
  // Dano no monstro via ataque básico (alcance 9; chase do servidor aproxima).
  send(c, { type: 'attack', target: '__monster__' });
  await waitFor(c, (m) => m.type === 'state' && m.snap.pve && m.snap.pve.dmgTotal > 0, 'dano registrado', 30000);
  // Espera o monstro ferir o jogador e cura a si mesmo (cura efetiva > 0).
  await waitFor(c, (m) => {
    if (m.type !== 'state') return false;
    const p = m.snap.players.find((x) => x.id === id);
    return p && p.hp < p.maxHp - 50;
  }, 'jogador ferido', 30000);
  send(c, { type: 'skill', slot: 'Q', skill: 'generous-heal', target: id });
  await waitFor(c, (m) => m.type === 'state' && m.snap.pve && m.snap.pve.healTotal > 0, 'cura registrada', 20000);
  const curaAntes = c.lastState.pve.healTotal;
  void me;
  send(c, { type: 'pveReset' });
  await waitFor(c, (m) => m.type === 'state' && m.snap.pve && m.snap.pve.dmgTotal === 0, 'dano zerado');
  assert.ok(c.lastState.pve.healTotal >= curaAntes, `cura preservada após reset de dano (${curaAntes} -> ${c.lastState.pve.healTotal})`);
  // Para o ataque (move cancela a perseguição) e congela o dano atual.
  send(c, { type: 'move', x: 50, y: 50 });
  await new Promise((r) => setTimeout(r, 1000));
  const dmgCongelado = c.lastState.pve.dmgTotal;
  send(c, { type: 'pveReset', heal: true });
  await waitFor(c, (m) => m.type === 'state' && m.snap.pve && m.snap.pve.healTotal === 0, 'cura zerada');
  assert.equal(c.lastState.pve.dmgTotal, dmgCongelado, `reset de cura não zera/muda o dano (${dmgCongelado} -> ${c.lastState.pve.dmgTotal})`);
  c.ws.close();
});
