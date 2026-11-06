// VAVA-R3 sobre servidores reais: Hub + VAVA reais, WebSockets reais e simultâneos.
// Entrante DURANTE cardSelection recebe opções + tempo coerente, escolhe e não
// trava os demais. Cobre timeout (mudo ganha carta) e saída durante a escolha.
//
// NOTA (R9-Item1): o launch (código + htok do play) é real, mas Carol/Dave/
// Eve/Fran entram DIRETO no VAVA com esses dados reutilizados — SEM criar
// identidade no Hub (hello) nem entrar na sala do Hub (join_room) e SEM
// receber o evento play próprio. O Hub nunca os registra como membros. O
// percurso completo Hub→jogo (identidade + entrada na sala + play próprio +
// 3 simultâneos nos dois lados + navegador real) está coberto em
// hub/test/vava-r3-latejoin-hub.test.js; este arquivo segue cobrindo a
// mecânica de cardSelection no jogo.
//
// Camada: integração (rede + protocolo + ticks reais do servidor, htok real do
// launch do Hub). O hook POST /__hub/test/cards só pula o countdown de 60s
// (declarado aqui); escolha, timers de 10s, mensagens e fases são reais.
// A chegada natural ao cardSelection (countdown → fase, sem hook) segue coberta
// em hub/test/e2e/flow9-catan-vava-natural.mjs (70s, 2 jogadores, chooseCard real).
// Lógica pura (sem rede) em Games/VAVA2D/packages/server/test/r34-cardspeed.test.ts.
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

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VAVA_ROOT = path.join(REPO_ROOT, 'Games', 'VAVA2D');

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
  console.log(`[r3] forceCards -> ${response.status} phase=${body.phase}`);
  assert.equal(body.phase, 'cardSelection');
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

// Entrante durante a escolha: o servidor distribui as opções dentro do
// addPlayer, que roda ANTES do 'joined' da sessão — o cardSelection pode
// chegar antes do joined (cliente real trata as mensagens independente da
// ordem, cada handler por tipo). Varre o inbox inteiro em vez do cursor.
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

test('VAVA-R3: entrante durante a escolha recebe opções+tempo, escolhe; timeout e saída cobertos', async (t) => {
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

  // --- Launch real pelo Hub (código + htok do play) ---
  const a = await connectClient(port);
  clients.push(a);
  await a.hello({ nick: 'R3Alice' });
  const b = await connectClient(port);
  clients.push(b);
  await b.hello({ nick: 'R3Bob' });
  a.send({ t: 'create_room', gameId: 'vava', capacity: 4 });
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

  // --- Jogadores reais no VAVA (criador + join com o htok do launch) ---
  const gsA = await connectClient(vavaPort);
  gameConns.push(gsA);
  gsA.send({ t: 'create', code: gameCode, name: 'R3Alice', htok });
  await gsA.next((m) => m.t === 'joined', 8000);
  const gsB = await connectClient(vavaPort);
  gameConns.push(gsB);
  gsB.send({ t: 'join', code: gameCode, name: 'R3Bob', htok });
  await gsB.next((m) => m.t === 'joined', 8000);
  // Vota só com a votação aberta (voto antes dela é ignorado pelo servidor).
  await gsA.next((m) => m.t === 'snapshot' && !!m.snap.mapVote, 10000);
  console.log('[r3] votação aberta; votando');
  gsA.send({ t: 'voteMap', map: 'field' });
  gsB.send({ t: 'voteMap', map: 'field' });
  await waitPhase(gsA, 'playing', 15000);
  console.log('[r3] vava playing');
  await waitForRoom(a, 'playing', 15000);
  console.log('[r3] hub playing');
  const snap = hub.snapshot();
  const hubEntry = snap.rooms.find((r) => r.code === hubRoom.room.code);
  assert.equal(hubEntry?.phase, 'playing');
  assert.equal(hubEntry?.match?.gameCode, gameCode);

  // --- Round 1: entrante tardio participa + fim antecipado (sem esperar 10s) ---
  await forceCards(vavaPort, gameCode);
  const selA = await waitCardSelection(gsA);
  console.log(`[r3] round1: A tem ${selA.cards.length} opcoes`);
  assert.equal(selA.cards.length, 3);
  const gsC = await connectClient(vavaPort);
  gameConns.push(gsC);
  const selC = await joinDuringCards(gsC, gameCode, htok, 'R3Carol');
  console.log('[r3] round1: C entrou');
  console.log(`[r3] round1: C tem ${selC.cards.length} opcoes, ${selC.seconds}s`);
  assert.equal(selC.cards.length, 3, 'entrante sem 3 opções');
  assert.ok(selC.seconds > 0 && selC.seconds <= 10, `tempo incoerente p/ entrante: ${selC.seconds}`);
  gsC.send({ t: 'chooseCard', card: selC.cards[0] });
  const selB = await waitCardSelection(gsB);
  gsA.send({ t: 'chooseCard', card: selA.cards[0] });
  gsB.send({ t: 'chooseCard', card: selB.cards[0] });
  // Todos (incluindo a entrante) escolheram: volta a playing SEM o timeout de 10s.
  await waitPhase(gsA, 'playing', 8000);
  await waitPhase(gsC, 'playing', 8000);
  assert.equal(lastSnapshot(gsA)?.you.cards.length, 1, 'A voltou sem carta');
  assert.equal(lastSnapshot(gsB)?.you.cards.length, 1, 'B voltou sem carta');
  assert.equal(lastSnapshot(gsC)?.you.cards.length, 1, 'entrante voltou sem carta');

  // --- Round 2: saída durante a escolha não trava + timeout dá carta ao mudo ---
  await forceCards(vavaPort, gameCode);
  const selA2 = await waitCardSelection(gsA);
  const selB2 = await waitCardSelection(gsB);
  const selC2 = await waitCardSelection(gsC);
  const gsD = await connectClient(vavaPort);
  gameConns.push(gsD);
  const selD = await joinDuringCards(gsD, gameCode, htok, 'R3Dave');
  assert.equal(selD.cards.length, 3, 'D sem opções');
  const gsE = await connectClient(vavaPort);
  gameConns.push(gsE);
  await joinDuringCards(gsE, gameCode, htok, 'R3Eve');
  await gsE.close(); // sai sem escolher: fantasma não pode prender a escolha
  const stateDuring = await (await fetch(
    `http://127.0.0.1:${vavaPort}/__hub/state?room=${gameCode}`,
    { headers: { 'x-hub-secret': SECRET } },
  )).json();
  assert.equal(stateDuring.room.players, 4, 'saída não refletiu (A,B,C,D)');
  gsA.send({ t: 'chooseCard', card: selA2.cards[0] });
  // B e C ainda não escolheram e D segue mudo: sem fim antecipado aqui.
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(lastSnapshot(gsA)?.phase, 'cardSelection', 'fim antecipado indevido com mudo presente');
  gsB.send({ t: 'chooseCard', card: selB2.cards[0] });
  gsC.send({ t: 'chooseCard', card: selC2.cards[0] });
  // D mudo: o timeout de 10s decide por ele (ninguém volta sem carta).
  await waitPhase(gsA, 'playing', 15000);
  await waitPhase(gsD, 'playing', 15000);
  assert.equal(lastSnapshot(gsA)?.you.cards.length, 2);
  assert.equal(lastSnapshot(gsD)?.you.cards.length, 1, 'mudo voltou sem carta no timeout');

  // --- Round 3: saída de quem faltava termina na hora (sem esperar timeout) ---
  await forceCards(vavaPort, gameCode);
  const r3a = await waitCardSelection(gsA);
  const r3b = await waitCardSelection(gsB);
  const gsF = await connectClient(vavaPort);
  gameConns.push(gsF);
  const r3f = await joinDuringCards(gsF, gameCode, htok, 'R3Fran');
  gsA.send({ t: 'chooseCard', card: r3a.cards[0] });
  gsB.send({ t: 'chooseCard', card: r3b.cards[0] });
  gsF.send({ t: 'chooseCard', card: r3f.cards[0] });
  // C escolheu no round 2 mas ainda não neste; D também não. D sai sem escolher:
  // restam A,B,C,F e nem todos escolheram → continua. C escolhe; D fora.
  const r3c = await waitCardSelection(gsC);
  gsC.send({ t: 'chooseCard', card: r3c.cards[0] });
  await gsD.close(); // D sai sem escolher; todos os restantes já escolheram → na hora
  await waitPhase(gsA, 'playing', 8000);
  await waitPhase(gsF, 'playing', 8000);
  assert.equal(lastSnapshot(gsF)?.you.cards.length, 1, 'F voltou sem carta');
});
