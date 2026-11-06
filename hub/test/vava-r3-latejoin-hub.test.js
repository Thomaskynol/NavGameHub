// VAVA-R3-HUB: entrada tardia REAL pelo Hub (Hub+VAVA reais, WS reais).
//
// Camada: integração (rede + protocolo + ticks reais, htok real do launch).
// Hook: POST /__hub/test/cards SÓ antecipa a seleção (pula o countdown);
// escolha, timers de 10s, mensagens e fases são reais. Percurso que o teste
// antigo (vava-r3-latejoin.test.js) NÃO cobre: lá Carol/Dave entram DIRETO
// no VAVA com código+htok reutilizados, sem identidade/entrada pelo Hub.
//
// Caminho real aqui: Alice+Bob criam/iniciam sala Hub → VAVA em seleção →
// Carol cria identidade no Hub (hello), entra na MESMA sala (join_room),
// recebe room (role player, midMatchJoin) + evento play PRÓPRIO (create=0)
// → entra no VAVA com ESSES dados → 3 simultâneos no Hub e no jogo → Carol
// recebe opções e escolhe → demais concluem → timeout (Dave mudo ganha
// carta) e saída durante a escolha (Eve fecha sem escolher) sem ultrapassar
// a capacidade do Hub. Caso negativo: sem evento play do Hub, a entrada no
// VAVA é recusada (OWNER_MISMATCH) e detectada como faltante nos dois lados.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SECRET,
  connectClient,
  startTestHub,
  waitForPlay,
  waitForRoom,
} from './helpers.mjs';
import { launchBrowser, strictCollector } from './e2e/e2e-helpers.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VAVA_ROOT = path.join(REPO_ROOT, 'Games', 'VAVA2D');
const HUB_CAPACITY = 4;

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function killTree(child) {
  try {
    if (child.exitCode === null) process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // já encerrado
    }
  }
}

async function startVavaServer(t) {
  const port = await freePort();
  const tsx = path.join(VAVA_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const entry = path.join(VAVA_ROOT, 'packages', 'server', 'src', 'index.ts');
  const child = spawn(process.execPath, [tsx, entry], {
    cwd: VAVA_ROOT,
    detached: true,
    env: {
      ...process.env, PORT: String(port), HOST: '127.0.0.1', HUB_SECRET: SECRET, HUB_TEST_HOOKS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    killTree(child);
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('VAVA não iniciou a tempo')), 15000);
    const onData = () => {
      fetch(`http://127.0.0.1:${port}/health`).then((response) => {
        if (response.ok) {
          clearTimeout(timer);
          resolve();
        }
      }).catch(() => {
        // ainda subindo
      });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`VAVA saiu com código ${code}`));
    });
    onData();
  });
  return port;
}

async function forceCards(vavaPort, gameCode) {
  const response = await fetch(
    `http://127.0.0.1:${vavaPort}/__hub/test/cards?room=${gameCode}`,
    { method: 'POST', headers: { 'x-hub-secret': SECRET } },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  console.log(`[r3h] forceCards -> ${response.status} phase=${body.phase}`);
  assert.equal(body.phase, 'cardSelection');
}

async function gameState(vavaPort, gameCode) {
  return (await fetch(
    `http://127.0.0.1:${vavaPort}/__hub/state?room=${gameCode}`,
    { headers: { 'x-hub-secret': SECRET } },
  )).json();
}

function lastSnapshot(client) {
  const snaps = client.messages.filter((m) => m.t === 'snapshot');
  return snaps.length > 0 ? snaps[snaps.length - 1].snap : null;
}

async function waitPhase(client, phase, timeout) {
  return client.next((m) => m.t === 'snapshot' && m.snap.phase === phase, timeout);
}

async function waitCardSelection(client, timeout = 8000) {
  return client.next((m) => m.t === 'cardSelection' && Array.isArray(m.cards), timeout);
}

// Entrante DURANTE cardSelection: o cardSelection pode chegar antes do
// joined (addPlayer distribui antes) — varre o inbox inteiro, como o teste
// antigo; o cliente real trata por tipo, independente da ordem.
async function joinDuringCards(conn, gameCode, htok, name, timeout = 8000) {
  conn.send({ t: 'join', code: gameCode, name, htok });
  await conn.next((m) => m.t === 'joined', timeout);
  const t0 = Date.now();
  for (;;) {
    const found = conn.messages.find(
      (m) => m.t === 'cardSelection' && Array.isArray(m.cards),
    );
    if (found) return found;
    if (Date.now() - t0 > timeout) throw new Error(`sem cardSelection p/ entrante ${name}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

// Entrada tardia REAL pelo Hub: hello + join_room na sala em playing +
// evento play próprio; devolve os dados DO PRÓPRIO play p/ entrar no VAVA.
async function hubLateJoin(port, clients, hubCode, nick, gameCode, htok) {
  const c = await connectClient(port);
  clients.push(c);
  await c.hello({ nick });
  c.send({ t: 'join_room', code: hubCode });
  const room = await c.next(
    (m) => m.t === 'room' && m.room.phase === 'playing',
    8000,
  );
  assert.equal(room.room.you.role, 'player', `${nick} sem role player no Hub (midMatchJoin)`);
  const play = await waitForPlay(c, 0, 8000);
  const url = new URL(play.url);
  assert.equal(url.searchParams.get('room'), gameCode, `${nick} com gameCode alheio`);
  assert.equal(url.searchParams.get('htok'), htok, `${nick} sem o htok do launch`);
  assert.equal(url.searchParams.get('name'), nick, `${nick} sem nome próprio no play`);
  assert.equal(url.searchParams.get('create'), '0', `${nick} com create!=0`);
  return { client: c, play, url };
}

function assertCapacity(hub, hubCode) {
  const entry = hub.snapshot().rooms.find((r) => r.code === hubCode);
  assert.ok(
    entry.members.length <= entry.capacity,
    `capacidade estourada: ${entry.members.length}/${entry.capacity}`,
  );
  return entry;
}

async function launchAB(t, port, clients, gameConns, vavaPort, hub) {
  const a = await connectClient(port);
  clients.push(a);
  await a.hello({ nick: 'R3H-Alice' });
  const b = await connectClient(port);
  clients.push(b);
  await b.hello({ nick: 'R3H-Bob' });
  a.send({ t: 'create_room', gameId: 'vava', capacity: HUB_CAPACITY });
  const hubRoom = await waitForRoom(a, 'lobby');
  b.send({ t: 'join_room', code: hubRoom.room.code });
  await waitForRoom(b, 'lobby');
  a.send({ t: 'set_ready', ready: true });
  const playAP = waitForPlay(a, 1, 15000);
  b.send({ t: 'set_ready', ready: true });
  const playA = await playAP;
  const urlA = new URL(playA.url);
  const gameCode = urlA.searchParams.get('room');
  const htok = urlA.searchParams.get('htok');
  assert.ok(gameCode && gameCode.length === 4);
  assert.ok(htok && htok.length >= 16);

  const gsA = await connectClient(vavaPort);
  gameConns.push(gsA);
  gsA.send({ t: 'create', code: gameCode, name: 'R3H-Alice', htok });
  await gsA.next((m) => m.t === 'joined', 8000);
  const gsB = await connectClient(vavaPort);
  gameConns.push(gsB);
  gsB.send({ t: 'join', code: gameCode, name: 'R3H-Bob', htok });
  await gsB.next((m) => m.t === 'joined', 8000);
  await gsA.next((m) => m.t === 'snapshot' && !!m.snap.mapVote, 10000);
  gsA.send({ t: 'voteMap', map: 'field' });
  gsB.send({ t: 'voteMap', map: 'field' });
  await waitPhase(gsA, 'playing', 15000);
  await waitForRoom(a, 'playing', 15000);
  return { a, b, gsA, gsB, hubRoom, gameCode, htok };
}

test('VAVA-R3-HUB: Carol entra pelo Hub (play próprio), 3 simultâneos; timeout e saída sem estourar capacidade', async (t) => {
  const vavaPort = await startVavaServer(t);
  const { hub, port } = await startTestHub({ ports: { vava: vavaPort } });
  const clients = [];
  const gameConns = [];
  let browser = null;
  let carolCtx = null;
  const strict = strictCollector('r3h');
  t.after(async () => {
    try {
      if (carolCtx) await carolCtx.close();
    } catch {
      // já encerrado
    }
    try {
      if (browser) await browser.close();
    } catch {
      // já encerrado
    }
    for (const c of gameConns) {
      try {
        await c.close();
      } catch {
        // já encerrado
      }
    }
    for (const client of clients) {
      try {
        await client.close();
      } catch {
        // já encerrado
      }
    }
    await hub.close();
  });

  const { hubRoom, gameCode, htok, gsA, gsB } = await launchAB(t, port, clients, gameConns, vavaPort, hub);
  const hubCode = hubRoom.room.code;

  // --- Carol REAL pelo NAVEGADOR (interface real do Hub + do VAVA) ---
  // Identidade no Hub, entrada na mesma sala, play próprio no iframe (o jogo
  // entra sozinho via ?hub=1) e escolha clicando nas opções reais do VAVA.
  await forceCards(vavaPort, gameCode);
  const selA0 = await waitCardSelection(gsA);
  void selA0;
  browser = await launchBrowser();
  carolCtx = await browser.newContext();
  const carolPage = await carolCtx.newPage();
  carolPage.on('pageerror', (e) => console.log('[r3h] pageerror(Carol):', String(e).slice(0, 160)));
  strict.attach(carolPage);
  await carolPage.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await carolPage.locator('#nick-input').fill('R3H-Carol');
  await carolPage.locator('#identity-submit').click();
  await carolPage.locator('#join-code').waitFor({ timeout: 10000 });
  await carolPage.locator('#join-code').fill(hubCode);
  await carolPage.locator('#join-submit').click();
  await carolPage.locator('#room-code').waitFor({ timeout: 10000 });
  assert.equal(((await carolPage.locator('#room-code').textContent()) || '').trim(), hubCode);
  console.log('[r3h] Carol (navegador) entrou na sala do Hub');
  const frameEl = carolPage.locator('#match-frame-wrap iframe');
  await frameEl.waitFor({ timeout: 20000 });
  const srcC = await frameEl.getAttribute('src');
  const urlC = new URL(srcC);
  assert.equal(urlC.searchParams.get('room'), gameCode, 'iframe de Carol com gameCode alheio');
  assert.equal(urlC.searchParams.get('htok'), htok, 'iframe de Carol sem o htok do launch');
  assert.equal(urlC.searchParams.get('name'), 'R3H-Carol', 'iframe sem nome próprio');
  assert.equal(urlC.searchParams.get('create'), '0', 'iframe de Carol com create!=0');
  console.log('[r3h] Carol (navegador) recebeu play próprio no iframe');
  const carolFrame = carolPage.frameLocator('#match-frame-wrap iframe');
  async function carolChoose(tag) {
    await carolFrame.locator('.card-option').first().waitFor({ timeout: 10000 });
    const n = await carolFrame.locator('.card-option').count();
    assert.equal(n, 3, `Carol sem 3 opções visíveis no navegador (${tag})`);
    await carolFrame.locator('.card-option').first().click();
    console.log(`[r3h] Carol (navegador) escolheu carta (${tag})`);
  }
  // O jogo entra sozinho no iframe: espera os 3 jogadores no VAVA.
  {
    const t0 = Date.now();
    let players = 0;
    while (Date.now() - t0 < 10000) {
      players = (await gameState(vavaPort, gameCode)).room?.players ?? 0;
      if (players === 3) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(players, 3, 'jogo sem 3 (iframe de Carol não entrou?)');
  }

  // --- 3 simultâneos no Hub e no jogo ---
  const entry = assertCapacity(hub, hubCode);
  assert.equal(entry.members.length, 3, 'Hub sem 3 simultâneos');
  assert.ok(entry.members.some((m) => m.nick === 'R3H-Carol' && m.role === 'player'));
  const vst = await gameState(vavaPort, gameCode);
  assert.equal(vst.room.players, 3, 'jogo sem 3 simultâneos');
  console.log('[r3h] 3 simultâneos: Hub=3 jogo=3 (Carol via Hub)');

  // --- Round 1: Carol recebe opções+tempo, escolhe; demais concluem ---
  // (forceCards acima; A já tem seleção, B recebe por broadcast; Carol clica
  // no navegador — a volta antecipada a playing prova que ela escolheu, pois
  // o timeout de 10s não teria decorrido)
  const selA = selA0;
  const selB = await waitCardSelection(gsB);
  for (const [n, s] of [['A', selA], ['B', selB]]) {
    assert.equal(s.cards.length, 3, `${n} sem 3 opções`);
    assert.ok(s.seconds > 0 && s.seconds <= 10, `tempo incoerente p/ ${n}: ${s.seconds}`);
  }
  await carolChoose('round1');
  gsA.send({ t: 'chooseCard', card: selA.cards[0] });
  gsB.send({ t: 'chooseCard', card: selB.cards[0] });
  await waitPhase(gsA, 'playing', 8000);
  await waitPhase(gsB, 'playing', 8000);
  assert.equal(lastSnapshot(gsA)?.you.cards.length, 1, 'A voltou sem carta');
  assert.equal(lastSnapshot(gsB)?.you.cards.length, 1, 'B voltou sem carta');
  // Carol voltou com carta: o HUD do VAVA no navegador mostra o slot
  // (espera o snapshot chegar ao iframe antes de contar).
  await carolFrame.locator('#cards .card-slot').first().waitFor({ timeout: 8000 });
  assert.ok(
    (await carolFrame.locator('#cards .card-slot').count()) >= 1,
    'HUD de Carol sem slot de carta após a escolha',
  );

  // --- Round 2: Dave REAL pelo Hub (durante a seleção), mudo → timeout ---
  await forceCards(vavaPort, gameCode);
  const selA2pre = await waitCardSelection(gsA);
  void selA2pre;
  const { client: d } = await hubLateJoin(port, clients, hubCode, 'R3H-Dave', gameCode, htok);
  const gsD = await connectClient(vavaPort);
  gameConns.push(gsD);
  const selD2 = await joinDuringCards(gsD, gameCode, htok, 'R3H-Dave');
  const entry2 = assertCapacity(hub, hubCode);
  assert.equal(entry2.members.length, 4, 'Hub sem 4 (no limite da capacidade)');
  assert.equal((await gameState(vavaPort, gameCode)).room.players, 4);
  const selB2 = await waitCardSelection(gsB);
  assert.equal(selD2.cards.length, 3, 'Dave sem opções');
  const selA2 = selA2pre;
  gsA.send({ t: 'chooseCard', card: selA2.cards[0] });
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(lastSnapshot(gsA)?.phase, 'cardSelection', 'fim antecipado indevido com Dave mudo');
  gsB.send({ t: 'chooseCard', card: selB2.cards[0] });
  await carolChoose('round2');
  // Dave mudo: o timeout de 10s decide por ele.
  await waitPhase(gsA, 'playing', 15000);
  await waitPhase(gsD, 'playing', 15000);
  assert.equal(lastSnapshot(gsA)?.you.cards.length, 2);
  assert.equal(lastSnapshot(gsD)?.you.cards.length, 1, 'Dave mudo voltou sem carta no timeout');

  // --- Round 3: Dave sai (jogo+Hub); Eve REAL pelo Hub entra e sai sem escolher ---
  await gsD.close();
  d.send({ t: 'leave_room' });
  await d.next((m) => m.t === 'left', 5000);
  assertCapacity(hub, hubCode);
  const { client: e } = await hubLateJoin(port, clients, hubCode, 'R3H-Eve', gameCode, htok);
  const gsE = await connectClient(vavaPort);
  gameConns.push(gsE);
  gsE.send({ t: 'join', code: gameCode, name: 'R3H-Eve', htok });
  await gsE.next((m) => m.t === 'joined', 8000);
  const entry3 = assertCapacity(hub, hubCode);
  assert.equal(entry3.members.length, 4, 'Eve não ocupou a vaga de Dave no Hub');
  assert.equal((await gameState(vavaPort, gameCode)).room.players, 4, 'jogo sem 4 (A,B,C,E)');
  await forceCards(vavaPort, gameCode);
  const r3a = await waitCardSelection(gsA);
  const r3b = await waitCardSelection(gsB);
  gsA.send({ t: 'chooseCard', card: r3a.cards[0] });
  gsB.send({ t: 'chooseCard', card: r3b.cards[0] });
  await carolChoose('round3');
  await gsE.close(); // Eve sai sem escolher: não pode prender a escolha
  const t0 = Date.now();
  await waitPhase(gsA, 'playing', 8000);
  assert.ok(Date.now() - t0 < 8000, 'volta deveria ser imediata (todos os restantes escolheram)');
  // Eve segue no Hub (ocupa vaga) mas fora do jogo.
  const entry4 = assertCapacity(hub, hubCode);
  assert.equal(entry4.members.length, 4);
  assert.equal((await gameState(vavaPort, gameCode)).room.players, 3, 'saída de Eve não refletiu');
  void e;
  const v = strict.verdict();
  assert.equal(v.ok, true, `navegador de Carol com falha: ${v.detail}`);
});

test('VAVA-R3-HUB negativo: sem play do Hub, a entrada é recusada e faltante', async (t) => {
  const vavaPort = await startVavaServer(t);
  const { hub, port } = await startTestHub({ ports: { vava: vavaPort } });
  const clients = [];
  const gameConns = [];
  t.after(async () => {
    for (const c of gameConns) {
      try {
        await c.close();
      } catch {
        // já encerrado
      }
    }
    for (const client of clients) {
      try {
        await client.close();
      } catch {
        // já encerrado
      }
    }
    await hub.close();
  });

  const { hubRoom, gameCode, gsA } = await launchAB(t, port, clients, gameConns, vavaPort, hub);
  void gsA;

  // Mallory tem identidade no Hub mas NUNCA entra na sala: nenhum play chega.
  const m = await connectClient(port);
  clients.push(m);
  await m.hello({ nick: 'R3H-Mallory' });
  let gotPlay = false;
  try {
    await waitForPlay(m, 0, 800);
    gotPlay = true;
  } catch {
    // esperado: sem join_room, sem evento de lançamento
  }
  assert.equal(gotPlay, false, 'play sem entrada na sala?');

  // Sem o htok do launch, a tentativa direta no VAVA é recusada.
  const gsM = await connectClient(vavaPort);
  gameConns.push(gsM);
  gsM.send({ t: 'join', code: gameCode, name: 'R3H-Mallory', htok: '0'.repeat(32) });
  const err = await gsM.next((x) => x.t === 'error', 5000);
  assert.ok(
    String(err.message).includes('OWNER_MISMATCH'),
    `recusa inesperada: ${err.message}`,
  );

  // Entrada faltante nos dois lados: Hub segue com 2, jogo segue com 2.
  const entry = hub.snapshot().rooms.find((r) => r.code === hubRoom.room.code);
  assert.equal(entry.members.length, 2, 'Hub com intruso?');
  assert.ok(!entry.members.some((x) => x.nick === 'R3H-Mallory'));
  assert.equal((await gameState(vavaPort, gameCode)).room.players, 2, 'jogo com intruso?');
  console.log('[r3h] negativo ok: sem play do Hub, entrada recusada e faltante');
});
