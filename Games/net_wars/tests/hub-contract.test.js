// Contrato Game Hub (hub/PROTOCOLO.md): state por sala, close com dono, /health,
// códigos verbatim + htok, standalone intacto. Servidor real em porta efêmera.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { validHtok } from '../shared/protocol.js';
import { shouldAutoEnter } from '../client/hub.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 18221;
const SECRET = 'hub-s3cr3t-teste';

function startServer() {
  return spawn('node', ['server/main.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', HUB_SECRET: SECRET },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function ready(child) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/__hub/state`);
      if (r.ok) return;
    } catch { /* subindo */ }
    if (child.exitCode != null) throw new Error('server morreu ao subir');
    await wait(100);
  }
  throw new Error('server não subiu');
}

// hello → { ws, welcome } ou { ws, denied } (rejeitado fecha com 1013).
function hello(room, name, extra = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
    let done = false;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve({ ws, ...v }); } };
    const timer = setTimeout(() => reject(new Error('timeout welcome/denied')), 8000);
    ws.on('message', (buf) => {
      try {
        const m = JSON.parse(String(buf));
        if (m.t === 'welcome') finish({ welcome: m });
        else if (m.t === 'event' && m.kind === 'denied') finish({ denied: m.reason });
      } catch { /* ignora */ }
    });
    ws.on('error', () => {});
    ws.on('close', (code) => finish({ denied: `close-${code}` }));
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name, room, ...extra })));
  });
}

const stateOf = async (code) =>
  (await fetch(`http://127.0.0.1:${PORT}/__hub/state?room=${encodeURIComponent(code)}`));
const closeRoom = async (code, htok, secret = SECRET) => {
  const p = new URLSearchParams({ room: code });
  if (htok != null) p.set('htok', htok);
  return fetch(`http://127.0.0.1:${PORT}/__hub/close?${p}`, {
    method: 'POST', headers: { 'x-hub-secret': secret },
  });
};

describe('hub contract: validHtok + shouldAutoEnter (puros)', () => {
  it('validHtok aceita 1..64 [A-Za-z0-9_-], resto é "sem dono"', () => {
    assert.ok(validHtok('abc123'));
    assert.ok(validHtok('A-_9'.repeat(16))); // 64 ok
    assert.ok(!validHtok(''));
    assert.ok(!validHtok('x'.repeat(65)));
    assert.ok(!validHtok('com espaço'));
    assert.ok(!validHtok('com!pont'));
    assert.ok(!validHtok(undefined));
    assert.ok(!validHtok(123));
  });
  it('shouldAutoEnter: create=1 fica no lobby, create=0 entra, sem create segue expect', () => {
    assert.equal(shouldAutoEnter({ create: '1', expect: 4 }), false);
    assert.equal(shouldAutoEnter({ create: '1', expect: 1 }), false);
    assert.equal(shouldAutoEnter({ create: '0', expect: 4 }), true);
    assert.equal(shouldAutoEnter({ create: '', expect: 0 }), true);
    assert.equal(shouldAutoEnter({ create: '', expect: 3 }), false);
    assert.equal(shouldAutoEnter({}), true);
  });
});

describe('hub contract: state por sala + close com dono', () => {
  let srv;
  before(async () => { srv = startServer(); await ready(srv); });
  after(() => { srv.kill(); });

  it('código livre → 404 {ok:false}', async () => {
    const r = await stateOf('livre1');
    assert.equal(r.status, 404);
    const b = await r.json();
    assert.equal(b.ok, false);
  });

  it('sem ?room= mantém o formato lista legado', async () => {
    const b = await (await fetch(`http://127.0.0.1:${PORT}/__hub/state`)).json();
    assert.ok(Array.isArray(b.rooms));
    assert.equal(typeof b.uptimeS, 'number');
  });

  it('/health responde 2xx', async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`);
    assert.ok(r.ok, `health ${r.status}`);
  });

  it('create=1 (hello + htok) cria a sala; envelope com hubOwner === htok', async () => {
    const c = await hello('abc123', 'criador', { htok: 'HTOK-1' });
    assert.ok(c.welcome?.id, `welcome esperado (${JSON.stringify(c.denied)})`);
    const r = await stateOf('abc123');
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.ok, true);
    assert.equal(b.room.code, 'abc123');
    assert.equal(b.room.phase, 'lobby');
    assert.equal(b.room.players, 1);
    assert.equal(b.room.capacity, 12);
    assert.equal(b.room.joinable, true);
    assert.equal(typeof b.room.hubOwner, 'string');
    assert.equal(b.room.hubOwner, 'HTOK-1');
    c.ws.close();
    await wait(300);
  });

  it('?room= é case-insensitive (Hub passa MAIÚSCULA, cliente cria minúscula)', async () => {
    const c = await hello('def456', 'p', { htok: 'HTOK-C' });
    assert.ok(c.welcome?.id);
    const r = await stateOf('DEF456');
    assert.equal(r.status, 200);
    assert.equal((await r.json()).room.hubOwner, 'HTOK-C');
    c.ws.close();
    await wait(300);
  });

  it('create=0 mesmo htok entra; htok divergente/ausente → CODE_TAKEN', async () => {
    const host = await hello('jogo01', 'host', { htok: 'HTOK-J' });
    assert.ok(host.welcome?.id);
    const joiner = await hello('jogo01', 'entra', { htok: 'HTOK-J' });
    assert.ok(joiner.welcome?.id, `retentativa legítima entra (${joiner.denied})`);
    const st = await (await stateOf('jogo01')).json();
    assert.equal(st.room.players, 2);
    const alien = await hello('jogo01', 'alheio', { htok: 'OUTRO' });
    assert.equal(alien.denied, 'CODE_TAKEN', `dono divergente barrado (${JSON.stringify(alien.welcome)})`);
    alien.ws.close();
    const semHtok = await hello('jogo01', 'sem', {});
    assert.equal(semHtok.denied, 'CODE_TAKEN', `sem htok barrado em sala com dono (${JSON.stringify(semHtok.welcome)})`);
    semHtok.ws.close();
    host.ws.close(); joiner.ws.close();
    await wait(300);
  });

  it('playing → phase playing; close sem segredo/htok errado → 403 e sala intacta', async () => {
    const host = await hello('mtx999', 'host', { htok: 'HTOK-M' });
    assert.ok(host.welcome?.id);
    host.ws.send(JSON.stringify({ t: 'start' }));
    await wait(600);
    assert.equal((await (await stateOf('mtx999')).json()).room.phase, 'playing');

    const noSecret = await fetch(`http://127.0.0.1:${PORT}/__hub/close?room=mtx999&htok=HTOK-M`, { method: 'POST' });
    assert.equal(noSecret.status, 403);
    const wrongHtok = await closeRoom('mtx999', 'HTOK-ERRADO');
    assert.equal(wrongHtok.status, 403);
    assert.equal((await wrongHtok.json()).ok, false);
    // sala intacta após as recusas
    const st = await (await stateOf('mtx999')).json();
    assert.equal(st.ok, true);
    assert.equal(st.room.phase, 'playing');
    assert.equal(st.room.players, 1);
    host.ws.close();
    await wait(300);
  });

  it('close certo → {ok:true,closed:true}; idempotente; inexistente → 200 closed:false', async () => {
    const c = await hello('fech01', 'h', { htok: 'HTOK-F' });
    assert.ok(c.welcome?.id);
    const ok1 = await closeRoom('fech01', 'HTOK-F');
    assert.equal(ok1.status, 200);
    assert.deepEqual(await ok1.json(), { ok: true, closed: true });
    const ok2 = await closeRoom('fech01', 'HTOK-F');
    assert.equal(ok2.status, 200);
    assert.deepEqual(await ok2.json(), { ok: true, closed: false });
    const nf = await closeRoom('nuncaexistiu', null);
    assert.equal(nf.status, 200);
    assert.deepEqual(await nf.json(), { ok: true, closed: false });
    c.ws.close();
    await wait(300);
  });

  it('sala standalone (sem htok): close SEM htok fecha; COM htok → 403 e preserva', async () => {
    const c = await hello('sola01', 'solo', {});
    assert.ok(c.welcome?.id);
    const withHtok = await closeRoom('sola01', 'HTOK-ALHEIO');
    assert.equal(withHtok.status, 403);
    assert.equal((await (await stateOf('sola01')).json()).room.players, 1, 'standalone intacta');
    const plain = await closeRoom('sola01', null);
    assert.equal(plain.status, 200);
    assert.deepEqual(await plain.json(), { ok: true, closed: true });
    c.ws.close();
    await wait(300);
  });

  it('standalone sem htok segue funcionando (hello, lista, corpo JSON legado no close)', async () => {
    const c = await hello('legado1', 'p1', {});
    assert.ok(c.welcome?.id);
    const list = await (await fetch(`http://127.0.0.1:${PORT}/__hub/state`)).json();
    assert.ok(list.rooms.some((r) => r.room === 'legado1'));
    const viaBody = await fetch(`http://127.0.0.1:${PORT}/__hub/close`, {
      method: 'POST', headers: { 'x-hub-secret': SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: 'legado1' }),
    });
    assert.equal(viaBody.status, 200);
    assert.deepEqual(await viaBody.json(), { ok: true, closed: true });
    c.ws.close();
    await wait(300);
  });

  it('over → phase results', async () => {
    const c = await hello('curta01', 'h', { htok: 'HTOK-R', len: 5 });
    assert.ok(c.welcome?.id);
    c.ws.send(JSON.stringify({ t: 'start' }));
    await wait(6500);
    const st = await (await stateOf('curta01')).json();
    assert.equal(st.room.phase, 'results');
    c.ws.close();
    await wait(300);
  });
});
