// Lane A — Hub × Catan real: código histórico bloqueado (state 409) e retry.
// Reproduz: Hub escolhe código histórico → state 404 (livre) → create CODE_TAKEN
// → state segue 404 → espera até prazo → LAUNCH_FAILED sem retry.
// Após o fix: state distingue livre (404) × bloqueado (409 CODE_TAKEN);
// o Hub tenta outro código até o limite, sem apagar histórico e sem mandar
// ninguém a sala alheia. O teste NÃO escolhe o 2º código manualmente:
// usa o que o Hub enviar no play.
//
// Integração determinística: banco temp + geração de códigos controlada via
// crypto.randomInt (C=2, D=3 no alfabeto do Hub). Sequência: CCCCCC (histórico,
// bloqueado) → DDDDDD (livre). O Hub deve pular o histórico e criar a sala
// correta com o htok do launch.
//
// PROVA VIA PROTOCOLO (não navegador): criador faz create_room e os outros
// dois fazem join_room de verdade no Catan via socket.io, com código + htok
// do SEU play, no mesmo caminho do cliente real (App.tsx). As TRÊS conexões
// ficam ABERTAS até o fim das verificações: um broadcast `state` lista os
// três membros com connected=true na mesma sala, e um chat de Alice chega
// aos sockets abertos de Bob e Carol — registro no banco sozinho não prova
// simultaneidade (conta membros mesmo desconectados).
// Execução: node --test hub/test/historic-retry.test.js (usa o BUILD DE
// PRODUÇÃO Games/Catan/dist/server.mjs com NODE_ENV=production, NÃO tsx src).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  SECRET,
  connectClient,
  startFakeGame,
  startTestHub,
  waitForCondition,
  waitForPlay,
  waitForRoom,
} from './helpers.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CATAN_ROOT = join(REPO_ROOT, 'Games', 'Catan');
const HIST_CODE = 'CCCCCC';
const FREE_CODE = 'DDDDDD';

async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}

function killTree(child) {
  try {
    if (child.exitCode === null) process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* já encerrado */ }
  }
}

async function startCatanServer(t, dbPath) {
  const port = await freePort();
  // BUILD DE PRODUÇÃO (identidade Lane B: dist/server.mjs m+03:42 posterior ao
  // src final — http.ts/handlers.ts 03:39 — com 409 CODE_TAKEN, `closed` e
  // roomCodeExists sem filtro closed). cwd = raiz do Catan (SPA fallback
  // resolve dist/client a partir do cwd em production).
  const entry = join(CATAN_ROOT, 'dist', 'server.mjs');
  const child = spawn(process.execPath, [entry], {
    cwd: CATAN_ROOT,
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DB_PATH: dbPath,
      HUB_SECRET: SECRET,
      HUB_TEST_HOOKS: '1',
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => killTree(child));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Catan não iniciou a tempo')), 20000);
    const onData = () => {
      fetch(`http://127.0.0.1:${port}/health`).then((r) => {
        if (r.ok) { clearTimeout(timer); resolve(); }
      }).catch(() => {});
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', (e) => { clearTimeout(timer); reject(e); });
    child.once('exit', (c) => { clearTimeout(timer); reject(new Error(`Catan saiu com código ${c}`)); });
    onData();
  });
  return port;
}

function initDbWithHistoric(dbPath, code) {
  // Cria o banco ANTES do Catan abrir (evita 2º DatabaseSync com lock/busy
  // enquanto o servidor segura o arquivo). closed=1 não entra no Store
  // (loadOpenRooms só carrega closed=0), mas roomCodeExists bloqueia reuse.
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        host_player_id TEXT NOT NULL,
        state_json TEXT,
        phase TEXT NOT NULL,
        version INTEGER NOT NULL,
        board_seed TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        closed INTEGER NOT NULL DEFAULT 0,
        hub_token TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS members (
        room_code TEXT NOT NULL,
        player_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        recovery_hash TEXT NOT NULL,
        is_host INTEGER NOT NULL,
        ready INTEGER NOT NULL,
        joined_at INTEGER NOT NULL,
        PRIMARY KEY (room_code, player_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_members_recovery ON members(recovery_hash);
      CREATE INDEX IF NOT EXISTS idx_members_room ON members(room_code);
      CREATE TABLE IF NOT EXISTS processed_commands (
        request_id TEXT NOT NULL,
        room_code TEXT NOT NULL,
        player_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (request_id, player_id)
      );
      CREATE TABLE IF NOT EXISTS chat (
        id TEXT PRIMARY KEY,
        room_code TEXT NOT NULL,
        player_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        text TEXT NOT NULL,
        at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_room ON chat(room_code, at);
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    db.prepare('PRAGMA user_version = 2').run();
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('format', '2')").run();
    const now = Date.now();
    db.prepare(
      'INSERT INTO rooms (code, name, host_player_id, state_json, phase, version, board_seed, created_at, updated_at, closed, hub_token) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 1, ?)',
    ).run(code, 'antiga', 'p-old', 'lobby', 0, 's', now, now, '');
    db.prepare(
      'INSERT INTO members (room_code, player_id, name, color, recovery_hash, is_host, ready, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(code, 'p-old', 'Zed', 'blue', 'hash-hist-1', 1, 0, now);
    db.prepare(
      'INSERT INTO chat (id, room_code, player_id, name, color, text, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('hist-c1', code, 'p-old', 'Zed', 'blue', 'adeus', now);
  } finally {
    db.close();
  }
}

function historicPreserved(dbPath, code) {
  const db = new DatabaseSync(dbPath);
  try {
    const m = db.prepare('SELECT COUNT(*) AS n FROM members WHERE room_code = ?').get(code).n;
    const c = db.prepare('SELECT COUNT(*) AS n FROM chat WHERE room_code = ?').get(code).n;
    const r = db.prepare('SELECT closed AS c FROM rooms WHERE code = ?').get(code);
    return { members: m, chat: c, closed: r?.c };
  } finally {
    db.close();
  }
}

async function catanState(port, code) {
  const res = await fetch(`http://127.0.0.1:${port}/__hub/state?room=${code}`, {
    headers: { 'x-hub-secret': SECRET },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function catanClose(port, code, htok) {
  const q = `room=${encodeURIComponent(code)}${htok ? `&htok=${encodeURIComponent(htok)}` : ''}`;
  const res = await fetch(`http://127.0.0.1:${port}/__hub/close?${q}`, {
    method: 'POST',
    headers: { 'x-hub-secret': SECRET },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// Socket.IO client via build ESM do Catan (hub não depende de socket.io-client).
// Conexão PERSISTENTE: acumula broadcasts `state`/`presence` (que refletem
// conexão ativa) e só desconecta no teardown do teste. Timeouts em
// connect/ack para falha nunca pendurar a suíte.
const CATAN_IO_TIMEOUT_MS = 5000;

function withTimeout(promise, ms, message) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

async function catanConnect(port, { timeoutMs = CATAN_IO_TIMEOUT_MS } = {}) {
  const mod = await import(join(CATAN_ROOT, 'node_modules', 'socket.io-client', 'build', 'esm', 'index.js'));
  const socket = mod.io(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
  const states = [];
  socket.on('state', (view) => { states.push(view); });
  try {
    await withTimeout(
      new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      }),
      timeoutMs,
      `Catan: socket.io não conectou em ${timeoutMs}ms`,
    );
  } catch (err) {
    try { socket.disconnect(); } catch { /* já fechado */ }
    throw err;
  }
  return { socket, states };
}

let catanRequestSeq = 0;

function catanLobbyAck(conn, payload, { timeoutMs = CATAN_IO_TIMEOUT_MS } = {}) {
  const requestId = `req-${Date.now()}-${(catanRequestSeq += 1)}`;
  return withTimeout(
    new Promise((resolve) => {
      conn.socket.emit('lobby', { requestId, payload }, (res) => resolve(res));
    }),
    timeoutMs,
    `Catan: sem ack de lobby em ${timeoutMs}ms (${payload.type})`,
  );
}

// Atalhos de uso único (pré-condição de colisão, testes close): conectam,
// fazem o ack com timeout e desconectam — sem prova de simultaneidade.
async function catanCreate(port, { roomCode, nickname, hubToken }) {
  const conn = await catanConnect(port);
  try {
    const payload = { type: 'create_room', nickname, roomCode };
    if (hubToken) payload.hubToken = hubToken;
    return await catanLobbyAck(conn, payload);
  } finally {
    conn.socket.disconnect();
  }
}

// Mesmo caminho do cliente real (App.tsx): após o create=1, os demais fazem
// join_room com { code, nickname, hubToken } — nunca create cego.
async function catanJoin(port, { code, nickname, hubToken }) {
  const conn = await catanConnect(port);
  try {
    const payload = { type: 'join_room', code, nickname };
    if (hubToken) payload.hubToken = hubToken;
    return await catanLobbyAck(conn, payload);
  } finally {
    conn.socket.disconnect();
  }
}

function parsePlay(play) {
  const q = new URL(play.url).searchParams;
  return { room: q.get('room'), htok: q.get('htok'), name: q.get('name'), create: q.get('create') };
}

function roomMembers(dbPath, code) {
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare('SELECT player_id AS id, name FROM members WHERE room_code = ? ORDER BY joined_at').all(code);
  } finally {
    db.close();
  }
}

test('histórico bloqueia (409) e Hub tenta outro código até playing — sem LAUNCH_FAILED', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-hist-'));
  const dbPath = join(dir, 'catan.db');
  t.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
  // Sockets persistentes do Catan: fechados no teardown mesmo em falha.
  const catanSockets = [];
  t.after(() => { for (const s of catanSockets) { try { s.disconnect(); } catch {} } });
  // Histórico injetado ANTES do Catan abrir o DB (sem lock/busy); closed=1
  // não entra no Store, mas bloqueia reuse via roomCodeExists.
  initDbWithHistoric(dbPath, HIST_CODE);
  const catanPort = await startCatanServer(t, dbPath);

  // Pré-condição: histórico bloqueia create, e state distingue bloqueado (409)
  // de livre (404). Livre de verdade continua 404.
  const stHist = await catanState(catanPort, HIST_CODE);
  assert.equal(stHist.status, 409, 'histórico deve ser 409 CODE_TAKEN, não 404 livre');
  assert.equal(stHist.body?.error, 'CODE_TAKEN');
  const stFree = await catanState(catanPort, FREE_CODE);
  assert.equal(stFree.status, 404, 'código nunca usado deve ser 404 livre');
  const clash = await catanCreate(catanPort, { roomCode: HIST_CODE, nickname: 'Bia', hubToken: 'dono-novo-1' });
  assert.equal(clash.ok, false);
  assert.equal(clash.error.code, 'CODE_TAKEN');
  const kept = historicPreserved(dbPath, HIST_CODE);
  assert.equal(kept.members, 1);
  assert.equal(kept.chat, 1);

  const { hub, port } = await startTestHub({
    ports: { catan: catanPort },
    timings: { launchTimeout: 8000, launchPollInterval: 20, playPollInterval: 20, stateTimeout: 1000, closeDelay: 60 },
  });
  const clients = [];
  const origRandomInt = crypto.randomInt;
  t.after(async () => {
    crypto.randomInt = origRandomInt;
    syncBuiltinESMExports();
    for (const c of clients) { try { await c.close(); } catch {} }
    await hub.close();
  });

  // 3 jogadores (mínimo do Catan).
  const a = await connectClient(port); clients.push(a);
  await a.hello({ nick: 'Alice' });
  const b = await connectClient(port); clients.push(b);
  await b.hello({ nick: 'Bob' });
  const c = await connectClient(port); clients.push(c);
  await c.hello({ nick: 'Carol' });
  a.send({ t: 'create_room', gameId: 'catan', capacity: 3 });
  const room = await waitForRoom(a, 'lobby');
  b.send({ t: 'join_room', code: room.room.code });
  await waitForRoom(b, 'lobby');
  c.send({ t: 'join_room', code: room.room.code });
  await waitForRoom(c, 'lobby');

  // Geração controlada: 6 primeiras chamadas → C (histórico), seguintes → D (livre).
  let calls = 0;
  crypto.randomInt = () => { calls += 1; return calls <= 6 ? 2 : 3; };
  syncBuiltinESMExports();
  try {
    a.send({ t: 'set_ready', ready: true });
    b.send({ t: 'set_ready', ready: true });
    c.send({ t: 'set_ready', ready: true });
  } finally {
    // Mantém o patch até o primeiro play (verify usa 12 chamadas); restaura
    // após 500ms para não afetar outros randomInt (Hub room codes já criados).
    setTimeout(() => { crypto.randomInt = origRandomInt; syncBuiltinESMExports(); }, 500);
  }

  await waitForRoom(a, 'launching');
  // O Hub NÃO pode enviar o grupo ao código histórico: o único play create=1
  // deve trazer código livre (o teste não escolhe o 2º código — observa o Hub).
  const playA = await waitForPlay(a, 1, 8000);
  const infoA = parsePlay(playA);
  assert.equal(infoA.create, '1');
  assert.equal(infoA.name, 'Alice');
  assert.ok(infoA.htok && infoA.htok.length >= 16);
  assert.notStrictEqual(infoA.room, HIST_CODE, 'Hub não pode mandar o grupo à sala histórica/alheia');
  assert.equal(infoA.room, FREE_CODE, 'com sequência C→D, o retry deve cair no código livre');
  const gameCode = infoA.room;
  const htok = infoA.htok;

  // O criador cria a sala correta no Catan real com o htok do launch — a
  // conexão PERMANECE ABERTA até o fim das verificações (prova de
  // simultaneidade, não só registro no banco).
  const sockA = await catanConnect(catanPort);
  catanSockets.push(sockA.socket);
  const created = await catanLobbyAck(sockA, { type: 'create_room', nickname: 'Alice', roomCode: gameCode, hubToken: htok });
  assert.equal(created.ok, true, `create no Catan real deve funcionar: ${JSON.stringify(created)}`);

  // Cada play é aguardado e conferido (código, htok, nome, create) e cada
  // membro entra com os dados do SEU play — nunca com o play alheio. O Hub
  // só emite create=0 após o create do criador existir no jogo (poll),
  // por isso Bob/Carol aguardam o próprio play antes do join.
  const playB = await waitForPlay(b, 0, 8000);
  const infoB = parsePlay(playB);
  assert.equal(infoB.create, '0');
  assert.equal(infoB.name, 'Bob');
  assert.equal(infoB.room, gameCode);
  assert.equal(infoB.htok, htok);
  const sockB = await catanConnect(catanPort);
  catanSockets.push(sockB.socket);
  const joinedB = await catanLobbyAck(sockB, { type: 'join_room', code: infoB.room, nickname: 'Bob', hubToken: infoB.htok });
  assert.equal(joinedB.ok, true, `Bob deve entrar na sala nova: ${JSON.stringify(joinedB)}`);

  const playC = await waitForPlay(c, 0, 8000);
  const infoC = parsePlay(playC);
  assert.equal(infoC.create, '0');
  assert.equal(infoC.name, 'Carol');
  assert.equal(infoC.room, gameCode);
  assert.equal(infoC.htok, htok);
  const sockC = await catanConnect(catanPort);
  catanSockets.push(sockC.socket);
  const joinedC = await catanLobbyAck(sockC, { type: 'join_room', code: infoC.room, nickname: 'Carol', hubToken: infoC.htok });
  assert.equal(joinedC.ok, true, `Carol deve entrar na sala nova: ${JSON.stringify(joinedC)}`);

  // Nenhum play apontou para o histórico.
  for (const cl of [a, b, c]) {
    for (const m of cl.messages.filter((x) => x.t === 'play')) {
      assert.notStrictEqual(new URL(m.url).searchParams.get('room'), HIST_CODE);
    }
  }

  // Simultaneidade: com as TRÊS conexões abertas, um broadcast `state` lista
  // os três membros corretos na mesma sala, todos connected=true. players=3
  // no HTTP ou no banco não provaria isso (contam membros desconectados).
  let simultaneous = null;
  await waitForCondition(() => {
    const views = [...sockA.states, ...sockB.states, ...sockC.states];
    simultaneous = views.find((v) => (
      v?.roomCode === gameCode
      && Array.isArray(v.players) && v.players.length === 3
      && v.players.every((p) => p.connected === true)
    )) ?? null;
    return simultaneous !== null;
  }, 5000, 20);
  assert.deepStrictEqual(simultaneous.players.map((p) => p.name).sort(), ['Alice', 'Bob', 'Carol']);

  // Prova viva: Alice envia chat pelo caminho real do cliente (Lobby.tsx →
  // lobby {type:'chat'}); os sockets AINDA ABERTOS de Bob e Carol recebem o
  // broadcast com a mensagem — quem desconectou não receberia nada.
  const probe = `sinc-${Date.now()}`;
  const chatAck = await catanLobbyAck(sockA, { type: 'chat', text: probe });
  assert.equal(chatAck.ok, true, `chat deve funcionar: ${JSON.stringify(chatAck)}`);
  let liveB = null;
  let liveC = null;
  await waitForCondition(() => {
    const hasProbe = (conn) => conn.states.some((v) => (v.chat ?? []).some((m) => m.text === probe && m.name === 'Alice'));
    liveB = hasProbe(sockB) ? true : null;
    liveC = hasProbe(sockC) ? true : null;
    return liveB && liveC;
  }, 5000, 20);
  for (const [label, s] of [['Alice', sockA], ['Bob', sockB], ['Carol', sockC]]) {
    assert.equal(s.socket.connected, true, `socket de ${label} deve seguir aberto`);
  }

  // O Hub leva a sala a playing (plays create=0 já conferidos acima).
  await waitForRoom(a, 'playing', 8000);
  await waitForRoom(b, 'playing', 8000);
  assert.equal(hub.snapshot().rooms[0].match.gameCode, gameCode);

  // Estado no jogo confirma dono + TRÊS jogadores na mesma sala nova.
  const stGame = await catanState(catanPort, gameCode);
  assert.equal(stGame.status, 200);
  assert.equal(stGame.body.room.hubOwner, htok);
  assert.equal(stGame.body.room.players, 3, 'os três devem estar na sala nova do Catan');
  const fresh = roomMembers(dbPath, gameCode).map((m) => m.name).sort();
  assert.deepStrictEqual(fresh, ['Alice', 'Bob', 'Carol']);
  // Ninguém em outra partida: só a sala nova está aberta; o histórico segue
  // fechado com o membro original e o chat intactos.
  const kept2 = historicPreserved(dbPath, HIST_CODE);
  assert.equal(kept2.members, 1, 'histórico preservado após retry');
  assert.equal(kept2.chat, 1);
  assert.equal(kept2.closed, 1);
  assert.deepStrictEqual(roomMembers(dbPath, HIST_CODE).map((m) => m.name), ['Zed']);
  assert.equal((await catanState(catanPort, HIST_CODE)).status, 409);

  // Sala do Hub utilizável após o fluxo (grupo não ficou preso em launching).
  assert.equal(hub.snapshot().rooms[0].phase, 'playing');

  // Hub segue utilizável: novo cliente cria outra sala e fica em lobby.
  const d = await connectClient(port); clients.push(d);
  await d.hello({ nick: 'Dave' });
  d.send({ t: 'create_room', gameId: 'catan', capacity: 3 });
  const room2 = await waitForRoom(d, 'lobby');
  assert.ok(room2.room.code);
  assert.notStrictEqual(room2.room.code, room.room.code);
  assert.equal(hub.snapshot().rooms.length, 2);
});

test('Catan close: sucesso/inexistente idempotente com closed booleano; 403 preserva', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-close-'));
  const dbPath = join(dir, 'catan.db');
  t.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
  const catanPort = await startCatanServer(t, dbPath);
  await new Promise((r) => setTimeout(r, 300));

  const code = 'CLSEX2';
  const tok = 'tok-dono-1';
  const created = await catanCreate(catanPort, { roomCode: code, nickname: 'Ana', hubToken: tok });
  assert.equal(created.ok, true, `create deve funcionar: ${JSON.stringify(created)}`);

  // Dono certo fecha: 200 {ok:true, closed:true}.
  const first = await catanClose(catanPort, code, tok);
  assert.equal(first.status, 200);
  assert.deepStrictEqual(first.body, { ok: true, closed: true });
  assert.equal((await catanState(catanPort, code)).status, 404);

  // Repetição idempotente: 200 {ok:true, closed:false}.
  const repeat = await catanClose(catanPort, code, tok);
  assert.equal(repeat.status, 200);
  assert.deepStrictEqual(repeat.body, { ok: true, closed: false });

  // Inexistente: 200 {ok:true, closed:false} (nada a fazer).
  const missing = await catanClose(catanPort, 'ZZZZZ9', 'qualquer');
  assert.equal(missing.status, 200);
  assert.deepStrictEqual(missing.body, { ok: true, closed: false });

  // 403 preserva sem destruir: sala com dono, htok errado → 403 e intacta.
  const code2 = 'CLSPR2';
  const tok2 = 'tok-novo-2';
  assert.equal((await catanCreate(catanPort, { roomCode: code2, nickname: 'Bia', hubToken: tok2 })).ok, true);
  const wrong = await catanClose(catanPort, code2, 'tok-errado');
  assert.equal(wrong.status, 403);
  assert.equal((await catanState(catanPort, code2)).status, 200);
  // Repetição do 403 também preserva.
  assert.equal((await catanClose(catanPort, code2, 'tok-errado')).status, 403);
  assert.equal((await catanState(catanPort, code2)).status, 200);

  // Reutilização: dono fecha, outro dono cria no mesmo código, tardio não atinge.
  assert.deepStrictEqual((await catanClose(catanPort, code2, tok2)).body, { ok: true, closed: true });
  const tok3 = 'tok-nova-3';
  assert.equal((await catanCreate(catanPort, { roomCode: code2, nickname: 'Cid', hubToken: tok3 })).ok, true);
  assert.equal((await catanClose(catanPort, code2, tok2)).status, 403);
  assert.equal((await catanState(catanPort, code2)).status, 200);
  assert.deepStrictEqual((await catanClose(catanPort, code2, tok3)).body, { ok: true, closed: true });
});

test('Hub close: sucesso documentado (200) e recusa (403/409) sem retry — 1 request cada', async (t) => {
  // Servidor contador: documenta 200 {closed:false} e 403/409 como finais.
  let posts = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/__hub/close') {
      posts.push({ room: url.searchParams.get('room'), htok: url.searchParams.get('htok') });
      const room = url.searchParams.get('room');
      if (room === 'FORBID') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'FORBIDDEN' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, closed: false }));
      return;
    }
    if (url.pathname === '/__hub/state') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'NOT_FOUND' }));
      return;
    }
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => { await new Promise((r) => server.close(r)); });
  const fakePort = server.address().port;

  const { hub } = await startTestHub({ ports: { arcade: fakePort } });
  t.after(async () => { await hub.close(); });

  posts = [];
  const ok = await hub.closeGameRoom('arcade', 'ANY234', 'tok-x');
  assert.equal(ok.status, 200);
  assert.equal(ok.closed, false);
  assert.equal(ok.notMine, false);
  assert.equal(posts.length, 1, 'sucesso documentado (200 closed:false) não repete request');

  posts = [];
  const denied = await hub.closeGameRoom('arcade', 'FORBID', 'tok-errado');
  assert.equal(denied.status, 403);
  assert.equal(denied.notMine, true);
  assert.equal(posts.length, 1, 'recusa 403 não insiste');
});
