// Fluxo real Hub <-> Net Wars (servidor de verdade, sem fake).
// Cobre: catálogo online, create/join/ready pelo Hub, play create=1/0,
// partida com início do host, fim por timer, retorno à mesma sala,
// fechamento com htok, duas salas independentes, close com htok errado,
// modo standalone e reconexão (dentro e fora do fantasma de 30s).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import {
  connectClient,
  delay,
  SECRET,
  startTestHub,
  waitForRoom,
} from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_DIR = path.join(ROOT, 'Games', 'net_wars');
const GAME_PORT = 18211;

function gameHello({ name, room, htok, resume, resumeToken }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${GAME_PORT}`);
    const messages = [];
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch { /* noop */ }
      reject(new Error(`sem welcome p/ ${name} (recebido: ${JSON.stringify(messages).slice(0, 200)})`));
    }, 5000);
    ws.on('message', (data) => {
      let m;
      try { m = JSON.parse(data.toString()); } catch { return; }
      messages.push(m);
      if (m.t === 'welcome') {
        clearTimeout(timer);
        resolve({ ws, welcome: m, messages });
      }
      if (m.t === 'event' && m.kind === 'denied') {
        clearTimeout(timer);
        const err = new Error(`denied:${m.reason}`);
        err.denied = m.reason;
        err.ws = ws;
        reject(err);
      }
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    ws.on('open', () => {
      const hello = { t: 'hello', name, room };
      if (htok) hello.htok = htok;
      if (resume) hello.resume = resume;
      if (resumeToken) hello.resumeToken = resumeToken;
      ws.send(JSON.stringify(hello));
    });
  });
}

async function gameState(code) {
  const res = await fetch(`http://127.0.0.1:${GAME_PORT}/__hub/state?room=${encodeURIComponent(code)}`, {
    headers: { 'x-hub-secret': SECRET },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function gameClose(code, htok) {
  const params = new URLSearchParams({ room: code });
  if (htok !== undefined) params.set('htok', htok);
  const res = await fetch(`http://127.0.0.1:${GAME_PORT}/__hub/close?${params.toString()}`, {
    method: 'POST',
    headers: { 'x-hub-secret': SECRET },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function waitGameUp(timeout = 15000) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${GAME_PORT}/health`);
      if (res.ok) return;
    } catch { /* ainda subindo */ }
    if (Date.now() - start > timeout) throw new Error('Net Wars não subiu');
    await delay(100);
  }
}

test('Net Wars real: Hub -> partida -> retorno -> mesma sala', async (t) => {
  const game = spawn(process.execPath, ['server/main.js'], {
    cwd: GAME_DIR,
    env: {
      ...process.env, PORT: String(GAME_PORT), HOST: '127.0.0.1',
      HUB_SECRET: SECRET, MATCH_LEN_S: '3',
    },
    stdio: 'ignore',
  });
  const gameSockets = [];
  const track = (ws) => { gameSockets.push(ws); return ws; };
  t.after(async () => {
    for (const ws of gameSockets) {
      try { ws.terminate(); } catch { /* noop */ }
    }
    try { game.kill('SIGKILL'); } catch { /* noop */ }
  });

  await waitGameUp();

  const manifest = {
    hubPort: 0,
    games: [{
      id: 'netwars', name: 'Net Wars', tagline: 't', description: 'd',
      minPlayers: 2, maxPlayers: 12, midMatchJoin: false,
      codeLength: 6, port: GAME_PORT, healthPath: '/health',
      accent: '#7df9ff', tags: [],
    }],
  };
  const { hub, port } = await startTestHub({
    manifest, secret: SECRET, timings: { launchTimeout: 20000 },
  });
  t.after(() => hub.close());

  const clients = [];
  t.after(async () => {
    for (const c of clients) { try { await c.close(); } catch { /* noop */ } }
  });

  // Catálogo: jogo real online via health.
  const a = await connectClient(port);
  const b = await connectClient(port);
  clients.push(a, b);
  await a.hello({ nick: 'Ana' });
  const catalog = await a.next(
    (m) => m.t === 'catalog' && m.games.some((g) => g.id === 'netwars' && g.status === 'online'),
    10000,
  );
  assert.ok(catalog.games.some((g) => g.id === 'netwars' && g.status === 'online'));

  // Sala 1: cria, entra, prontos -> launching -> play.
  await b.hello({ nick: 'Beto' });
  a.send({ t: 'create_room', gameId: 'netwars', capacity: 2 });
  const lobby = await waitForRoom(a, 'lobby', 5000);
  const hubCode = lobby.room.code;
  b.send({ t: 'join_room', code: hubCode });
  await waitForRoom(b, 'lobby', 5000);
  a.send({ t: 'set_ready', ready: true });
  b.send({ t: 'set_ready', ready: true });
  const playA = await a.next((m) => m.t === 'play', 20000);
  const urlA = new URL(playA.url);
  const gameCode = urlA.searchParams.get('room');
  const htok = urlA.searchParams.get('htok');
  assert.equal(urlA.searchParams.get('create'), '1');
  assert.match(gameCode, /^[A-Z0-9]{6}$/);

  // O criador entra primeiro (create=1 cria a sala); só então o Hub
  // libera create=0 aos demais — igual ao iframe real do navegador.
  const ga = await gameHello({ name: 'Ana', room: gameCode, htok }).then((r) => (track(r.ws), r));
  assert.equal(ga.welcome.room.toUpperCase(), gameCode);

  const playB = await b.next((m) => m.t === 'play', 20000).catch((e) => {
    console.error('PLAY_B_TIMEOUT msgs:', JSON.stringify(b.messages.slice(-10)).slice(0, 2500));
    throw e;
  });
  const urlB = new URL(playB.url);
  assert.equal(urlB.searchParams.get('create'), '0');
  assert.equal(urlB.searchParams.get('room'), gameCode);
  assert.equal(urlB.searchParams.get('htok'), htok);

  // Entrada do segundo jogador; dono confere no state.
  const gb = await gameHello({ name: 'Beto', room: gameCode, htok }).then((r) => (track(r.ws), r));
  const st1 = await gameState(gameCode);
  assert.equal(st1.status, 200);
  assert.equal(st1.body.ok, true);
  assert.equal(st1.body.room.hubOwner, htok);
  assert.equal(st1.body.room.phase, 'lobby');

  // Início pelo host + fim por timer (MATCH_LEN_S=3) + retorno à sala.
  const mark = (name, p) => p.catch((e) => {
    console.error(`TIMEOUT em [${name}]; últimas Hub/A:`, JSON.stringify(a.messages.slice(-4)).slice(0, 1200));
    throw e;
  });
  ga.ws.send(JSON.stringify({ t: 'start' }));
  const playing = await mark('playing-sala1', waitForRoom(a, 'playing', 5000));
  assert.equal(playing.room.match.gameCode, gameCode);
  const backA = await waitForRoom(a, 'lobby', 15000);
  const backB = await waitForRoom(b, 'lobby', 15000);
  assert.equal(backA.room.code, hubCode, 'volta à mesma sala do Hub');
  assert.equal(backB.room.code, hubCode);
  assert.ok(backA.room.members.every((m) => m.ready === false), 'prontidão limpa');

  // Fechamento do Hub com o htok do launch; sala some no jogo.
  // (backA/backB já consumiram o retorno a lobby; sem novo broadcast aqui.)
  let stClosed = null;
  const start = Date.now();
  while (Date.now() - start < 8000) {
    const s = await gameState(gameCode);
    if (s.status === 404) { stClosed = s; break; }
    await delay(150);
  }
  assert.ok(stClosed, 'Hub fechou a sala no jogo (404)');

  // Sala 2: código distinto, fluxo independente.
  const c = await connectClient(port);
  const d = await connectClient(port);
  clients.push(c, d);
  await c.hello({ nick: 'Cid' });
  await d.hello({ nick: 'Duda' });
  c.send({ t: 'create_room', gameId: 'netwars', capacity: 2 });
  const lobby2 = await waitForRoom(c, 'lobby', 5000);
  d.send({ t: 'join_room', code: lobby2.room.code });
  await waitForRoom(d, 'lobby', 5000);
  c.send({ t: 'set_ready', ready: true });
  d.send({ t: 'set_ready', ready: true });
  const playC = await c.next((m) => m.t === 'play', 20000);
  const gameCode2 = new URL(playC.url).searchParams.get('room');
  const htok2 = new URL(playC.url).searchParams.get('htok');
  assert.notEqual(gameCode2, gameCode, 'partidas simultâneas usam códigos distintos');

  // Criador da sala 2 entra antes do convidado (mesma ordem do fluxo real).
  const gc = await gameHello({ name: 'Cid', room: gameCode2, htok: htok2 }).then((r) => (track(r.ws), r));
  await d.next((m) => m.t === 'play', 20000);

  // Close com htok errado/divergente: 403 e sala intacta.
  const bad = await gameClose(gameCode2, 'htok-de-outra-partida');
  assert.equal(bad.status, 403);
  const intact = await gameState(gameCode2);
  assert.equal(intact.status, 200);
  assert.equal(intact.body.room.hubOwner, htok2);

  const gd = await gameHello({ name: 'Duda', room: gameCode2, htok: htok2 }).then((r) => (track(r.ws), r));
  gc.ws.send(JSON.stringify({ t: 'start' }));
  await waitForRoom(c, 'playing', 5000);
  await waitForRoom(c, 'lobby', 15000);
  assert.ok(gd.welcome.room, 'segunda sala completa o fluxo');

  // Standalone preservado: sem htok, entra e joga; close afiliado não destrói.
  const solo = await gameHello({ name: 'Solo', room: 'livre1' }).then((r) => (track(r.ws), r));
  assert.equal(solo.welcome.room, 'livre1');
  const stSolo = await gameState('livre1');
  assert.equal(stSolo.body.room.hubOwner, null);
  const affClose = await gameClose('livre1', 'htok-qualquer');
  assert.equal(affClose.status, 403, 'close afiliado não fecha sala standalone');
  const ownClose = await gameClose('livre1');
  assert.deepEqual(ownClose, { status: 200, body: { ok: true, closed: true } });

  // Reconexão dentro do fantasma (30s): retoma sem duplicar.
  const g1 = await gameHello({ name: 'Ghost', room: 'fantasma1' }).then((r) => (track(r.ws), r));
  const { id: gid, resumeToken } = g1.welcome;
  assert.ok(resumeToken, 'welcome entrega resumeToken');
  g1.ws.terminate();
  await delay(300);
  const g2 = await gameHello({ name: 'Ghost', room: 'fantasma1', resume: gid, resumeToken }).then((r) => (track(r.ws), r));
  assert.equal(g2.welcome.resumed, true);
  const stGhost = await gameState('fantasma1');
  assert.equal(stGhost.body.room.players, 1, 'sem duplicar jogador');

  // Token errado com fantasma vivo: DUP + close 1013, sem roubar a vaga.
  // (gid antigo já foi consumido pelo resume acima; o caso DUP exige o id vivo.)
  g2.ws.terminate();
  await delay(300);
  const g2id = g2.welcome.id;
  await assert.rejects(
    gameHello({ name: 'Ghost', room: 'fantasma1', resume: g2id, resumeToken: 'errado' }),
    /denied:DUP/,
  );
  const g3 = await gameHello({ name: 'Ghost', room: 'fantasma1', resume: g2id, resumeToken }).then((r) => (track(r.ws), r));
  assert.equal(g3.welcome.resumed, true);
  const stGhost2 = await gameState('fantasma1');
  assert.equal(stGhost2.body.room.players, 1, 'sem duplicar jogador');

  // Fora do fantasma: após 30s o id antigo não retoma — vira entrada limpa.
  const h1 = await gameHello({ name: 'Expira', room: 'fantasma2' }).then((r) => (track(r.ws), r));
  const hid = h1.welcome.id;
  const htokSaved = h1.welcome.resumeToken;
  h1.ws.terminate();
  await delay(32000);
  const hexp = await gameHello({ name: 'Expira', room: 'fantasma2', resume: hid, resumeToken: htokSaved }).then((r) => (track(r.ws), r));
  assert.notEqual(hexp.welcome.resumed, true, 'fantasma expirado não retoma');
  const stExp = await gameState('fantasma2');
  assert.equal(stExp.body.room.players, 1, 'sem duplicar após expirar');
}, { timeout: 120000 });
