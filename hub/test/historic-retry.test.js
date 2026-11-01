// Lane A — Hub × Catan real: código histórico bloqueado (state 409) e retry.
// Reproduz: Hub escolhe código histórico → state 404 (livre) → create CODE_TAKEN
// → state segue 404 → espera até prazo → LAUNCH_FAILED sem retry.
// Após o fix: state distingue livre (404) × bloqueado (409 CODE_TAKEN);
// o Hub tenta outro código até o limite, sem apagar histórico e sem mandar
// ninguém a sala alheia. O teste NÃO escolhe o 2º código manualmente:
// usa o que o Hub enviar no play.
//
// Integração determinística: banco temp + geração de códigos controlada via
// crypto.randomInt (C=2, D=3 no alfabeto do Hub). Sequência: CCCCC C (histórico,
// bloqueado) → DDDDDD (livre). O Hub deve pular o histórico e criar a sala
// correta com o htok do launch.
//
// Execução: node --test hub/test/historic-retry.test.js (usa tsx src, NÃO dist).
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
  const tsx = join(CATAN_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const entry = join(CATAN_ROOT, 'src', 'server', 'index.ts');
  const child = spawn(process.execPath, [tsx, entry], {
    cwd: CATAN_ROOT,
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DB_PATH: dbPath,
      HUB_SECRET: SECRET,
      HUB_TEST_HOOKS: '1',
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
async function catanCreate(port, { roomCode, nickname, hubToken }) {
  const mod = await import(join(CATAN_ROOT, 'node_modules', 'socket.io-client', 'build', 'esm', 'index.js'));
  const socket = mod.io(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  try {
    const payload = { type: 'create_room', nickname, roomCode };
    if (hubToken) payload.hubToken = hubToken;
    const res = await new Promise((resolve) => {
      socket.emit('lobby', { requestId: `req-${Date.now()}`, payload }, (r) => resolve(r));
    });
    return res;
  } finally {
    socket.disconnect();
  }
}

test('histórico bloqueia (409) e Hub tenta outro código até playing — sem LAUNCH_FAILED', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-hist-'));
  const dbPath = join(dir, 'catan.db');
  t.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
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
  const urlA = new URL(playA.url);
  const gameCode = urlA.searchParams.get('room');
  const htok = urlA.searchParams.get('htok');
  assert.ok(htok && htok.length >= 16);
  assert.notStrictEqual(gameCode, HIST_CODE, 'Hub não pode mandar o grupo à sala histórica/alheia');
  assert.equal(gameCode, FREE_CODE, 'com sequência C→D, o retry deve cair no código livre');

  // Nenhum play apontou para o histórico.
  for (const cl of [a, b, c]) {
    for (const m of cl.messages.filter((x) => x.t === 'play')) {
      assert.notStrictEqual(new URL(m.url).searchParams.get('room'), HIST_CODE);
    }
  }

  // O criador cria a sala correta no Catan real com o htok do launch.
  const created = await catanCreate(catanPort, { roomCode: gameCode, nickname: 'Alice', hubToken: htok });
  assert.equal(created.ok, true, `create no Catan real deve funcionar: ${JSON.stringify(created)}`);

  // Os demais entram (create=0) e o Hub leva a sala a playing.
  await waitForPlay(b, 0, 8000);
  await waitForPlay(c, 0, 8000);
  await waitForRoom(a, 'playing', 8000);
  await waitForRoom(b, 'playing', 8000);
  assert.equal(hub.snapshot().rooms[0].match.gameCode, gameCode);

  // Estado no jogo confirma dono; histórico segue intacto e bloqueado.
  const stGame = await catanState(catanPort, gameCode);
  assert.equal(stGame.status, 200);
  assert.equal(stGame.body.room.hubOwner, htok);
  const kept2 = historicPreserved(dbPath, HIST_CODE);
  assert.equal(kept2.members, 1, 'histórico preservado após retry');
  assert.equal(kept2.chat, 1);
  assert.equal((await catanState(catanPort, HIST_CODE)).status, 409);

  // Sala do Hub utilizável após o fluxo (grupo não ficou preso em launching).
  assert.equal(hub.snapshot().rooms[0].phase, 'playing');
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
