import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import {
  SECRET,
  connectClient,
  delay,
  startFakeGame,
  startTestHub,
  waitForCondition,
  waitForPlay,
  waitForRoom,
} from './helpers.mjs';

// Conflito de dono (Hub × jogo): o Hub reserva um código, outra partida ocupa
// o mesmo código no jogo com outro dono (ou sem dono) e o create do anfitrião
// recebe CODE_TAKEN. O Hub nunca pode mandar o grupo para a sala alheia:
// confere `hubOwner === htok` após o create e em todo poll, gera novo código
// (limite ~3) e, esgotado, devolve a sala ao lobby com LAUNCH_CONFLICT.

async function setup(t, timings = {}) {
  const fake = await startFakeGame({ id: 'arcade' });
  const { hub, port } = await startTestHub({
    ports: { arcade: fake.port },
    timings: { launchTimeout: 5000, ...timings },
  });
  const clients = [];
  t.after(async () => {
    for (const client of clients) {
      try {
        await client.close();
      } catch {
        // já encerrado
      }
    }
    await hub.close();
    await fake.close();
  });
  return { hub, port, fake, clients };
}

async function readyPair({ port, clients }, nickA = 'Alice', nickB = 'Bob') {
  const a = await connectClient(port);
  clients.push(a);
  await a.hello({ nick: nickA });
  const b = await connectClient(port);
  clients.push(b);
  await b.hello({ nick: nickB });
  a.send({ t: 'create_room', gameId: 'arcade', capacity: 2 });
  const room = await waitForRoom(a, 'lobby');
  b.send({ t: 'join_room', code: room.room.code });
  await waitForRoom(b, 'lobby');
  a.send({ t: 'set_ready', ready: true });
  b.send({ t: 'set_ready', ready: true });
  await waitForRoom(a, 'launching');
  return { a, b, roomCode: room.room.code };
}

function playCodes(client) {
  return client.messages
    .filter((message) => message.t === 'play')
    .map((message) => {
      try {
        const url = new URL(message.url);
        return {
          create: url.searchParams.get('create'),
          room: url.searchParams.get('room'),
          htok: url.searchParams.get('htok'),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function closePosts(fake, gameCode) {
  return fake.requests.filter(
    (request) => request.method === 'POST'
      && request.path === '/__hub/close'
      && request.room === gameCode,
  );
}

test('conflito na verificação: código ocupado com outro dono ganha novo código', async (t) => {
  const { hub, port, fake, clients } = await setup(t);

  const a = await connectClient(port);
  clients.push(a);
  await a.hello({ nick: 'Alice' });
  const b = await connectClient(port);
  clients.push(b);
  await b.hello({ nick: 'Bob' });
  a.send({ t: 'create_room', gameId: 'arcade', capacity: 2 });
  const room = await waitForRoom(a, 'lobby');
  b.send({ t: 'join_room', code: room.room.code });
  await waitForRoom(b, 'lobby');

  // A próxima consulta do Hub encontra o código já ocupado por outra partida
  // (entre a reserva e o create do anfitrião).
  fake.conflictOnce('tok-outro-dono');
  a.send({ t: 'set_ready', ready: true });
  b.send({ t: 'set_ready', ready: true });
  await waitForRoom(a, 'launching');

  // O Hub detecta o dono divergente ainda na verificação, reserva outro código
  // e o único play do criador já aponta para o novo código.
  const play = await waitForPlay(a, 1);
  const url = new URL(play.url);
  const gameCode = url.searchParams.get('room');
  const htok = url.searchParams.get('htok');
  assert.ok(htok && htok.length >= 16);
  assert.equal(playCodes(a).length, 1);

  const taken = [...fake.rooms.keys()].find((key) => key !== gameCode);
  assert.ok(taken);
  assert.equal(fake.rooms.get(taken).hubOwner, 'tok-outro-dono');

  fake.createRoom(gameCode, {
    phase: 'lobby', players: 2, capacity: 2, joinable: false, hubOwner: htok,
  });
  await waitForPlay(b, 0);
  await waitForRoom(a, 'playing');
  await waitForRoom(b, 'playing');
  assert.equal(hub.snapshot().rooms[0].match.gameCode, gameCode);

  // Nenhum play apontou para a sala alheia e ela segue intacta, sem close.
  for (const entry of [...playCodes(a), ...playCodes(b)]) {
    assert.notStrictEqual(entry.room, taken);
  }
  assert.equal(closePosts(fake, taken).length, 0);
});

test('conflito pós-create: ocupação estrangeira após o play gera novo código com mesmo htok', async (t) => {
  const { hub, port, fake, clients } = await setup(t);
  const { a, b } = await readyPair({ port, clients });

  // Verificação passou (livre), o criador recebeu o play — e SÓ então outra
  // partida ocupou o código com outro dono (create do criador = CODE_TAKEN).
  const first = await waitForPlay(a, 1);
  const firstUrl = new URL(first.url);
  const taken = firstUrl.searchParams.get('room');
  const htok = firstUrl.searchParams.get('htok');
  fake.createRoom(taken, {
    phase: 'lobby', players: 2, capacity: 2, joinable: false, hubOwner: 'tok-estrangeiro',
  });

  // O Hub vê o dono divergente no poll, reserva novo código e reemite play
  // create=1 ao criador — com o MESMO htok do launch.
  const second = await waitForPlay(a, 1);
  const secondUrl = new URL(second.url);
  const gameCode = secondUrl.searchParams.get('room');
  assert.notStrictEqual(gameCode, taken);
  assert.equal(secondUrl.searchParams.get('htok'), htok);

  fake.createRoom(gameCode, {
    phase: 'lobby', players: 2, capacity: 2, joinable: false, hubOwner: htok,
  });
  const joinB = await waitForPlay(b, 0);
  assert.equal(new URL(joinB.url).searchParams.get('room'), gameCode);
  await waitForRoom(a, 'playing');
  assert.equal(hub.snapshot().rooms[0].match.gameCode, gameCode);

  // Nenhum join (create=0) apontou para a sala alheia; sem close destrutivo.
  for (const entry of playCodes(b)) assert.notStrictEqual(entry.room, taken);
  assert.equal(fake.rooms.get(taken).hubOwner, 'tok-estrangeiro');
  assert.equal(closePosts(fake, taken).length, 0);
});

test('owner null explícito também é conflito (não é "minha")', async (t) => {
  const { hub, port, fake, clients } = await setup(t);
  const { a, b } = await readyPair({ port, clients });

  const first = await waitForPlay(a, 1);
  const taken = new URL(first.url).searchParams.get('room');
  const htok = new URL(first.url).searchParams.get('htok');
  // Sala sem dono no jogo (manual/legada): hubOwner null explícito.
  fake.createRoom(taken, {
    phase: 'lobby', players: 2, capacity: 2, joinable: false, hubOwner: null,
  });

  const second = await waitForPlay(a, 1);
  const gameCode = new URL(second.url).searchParams.get('room');
  assert.notStrictEqual(gameCode, taken);
  assert.equal(new URL(second.url).searchParams.get('htok'), htok);

  fake.createRoom(gameCode, {
    phase: 'lobby', players: 2, capacity: 2, joinable: false, hubOwner: htok,
  });
  await waitForPlay(b, 0);
  await waitForRoom(a, 'playing');
  assert.equal(hub.snapshot().rooms[0].match.gameCode, gameCode);
  assert.equal(closePosts(fake, taken).length, 0);
});

test('esgotamento de conflitos devolve a sala ao lobby com LAUNCH_CONFLICT', async (t) => {
  const { hub, port, fake, clients } = await setup(t);
  const { a, b } = await readyPair({ port, clients });

  // Todo código "existe" com outro dono: o Hub nunca consegue um código seu.
  fake.setPhantomOwner('tok-fantasma');
  const failure = await a.next(
    (message) => message.t === 'error' && message.code === 'LAUNCH_CONFLICT',
    8000,
  );
  assert.equal(failure.code, 'LAUNCH_CONFLICT');
  const back = await waitForRoom(a, 'lobby');
  assert.equal(back.room.match, null);
  assert.equal(back.room.you.ready, false);

  // Grupo intacto e utilizável: ninguém foi mandado a sala alheia.
  const snapshot = hub.snapshot().rooms[0];
  assert.equal(snapshot.phase, 'lobby');
  assert.equal(snapshot.match, null);
  assert.deepStrictEqual(
    snapshot.members.map((member) => member.nick).sort(),
    ['Alice', 'Bob'],
  );
  assert.equal(a.messages.some((message) => message.t === 'play'), false);
  assert.equal(b.messages.some((message) => message.t === 'play'), false);
  assert.equal(
    fake.requests.filter((request) => request.method === 'POST' && request.path === '/__hub/close').length,
    0,
  );

  // Sem prender o grupo: com o jogo livre, o lançamento seguinte funciona.
  fake.setPhantomOwner(null);
  a.send({ t: 'set_ready', ready: true });
  b.send({ t: 'set_ready', ready: true });
  await waitForRoom(a, 'launching');
  const play = await waitForPlay(a, 1);
  const gameCode = new URL(play.url).searchParams.get('room');
  fake.createRoom(gameCode, {
    phase: 'lobby',
    players: 2,
    capacity: 2,
    joinable: false,
    hubOwner: new URL(play.url).searchParams.get('htok'),
  });
  await waitForPlay(b, 0);
  await waitForRoom(a, 'playing');
});

test('close 403 não re-tenta e expõe o resultado (fake com dono)', async (t) => {
  const { hub, fake } = await setup(t);
  fake.createRoom('ABCDEF', {
    phase: 'lobby', players: 2, capacity: 2, joinable: false, hubOwner: 'tok-dono',
  });

  const wrong = await hub.closeGameRoom('arcade', 'ABCDEF', 'tok-errado');
  assert.equal(wrong.status, 403);
  assert.equal(wrong.closed, false);
  assert.equal(wrong.notMine, true);
  // Sem insistência destrutiva: exatamente 1 tentativa, sala intacta.
  assert.equal(closePosts(fake, 'ABCDEF').length, 1);
  assert.equal(fake.rooms.has('ABCDEF'), true);

  const right = await hub.closeGameRoom('arcade', 'ABCDEF', 'tok-dono');
  assert.equal(right.status, 200);
  assert.equal(right.closed, true);
  assert.equal(right.notMine, false);
  assert.equal(fake.rooms.has('ABCDEF'), false);

  // Fechar o que já sumiu: 200 sem closed (só 200 {closed:true} conta).
  const gone = await hub.closeGameRoom('arcade', 'ABCDEF', 'tok-dono');
  assert.equal(gone.status, 200);
  assert.equal(gone.closed, false);

  const log = hub.snapshot().closeLog.filter((entry) => entry.gameCode === 'ABCDEF');
  assert.equal(log.length, 3);
  assert.equal(log[0].notMine, true);
  assert.equal(log[0].status, 403);
  assert.equal(log[1].closed, true);
  assert.equal(log[2].closed, false);
});

test('reconexão legítima com mesmo htok continua em playing', async (t) => {
  const { hub, port, fake, clients } = await setup(t, { disconnectGrace: 5000 });
  const { a, b } = await readyPair({ port, clients });

  const play = await waitForPlay(a, 1);
  const gameCode = new URL(play.url).searchParams.get('room');
  const htok = new URL(play.url).searchParams.get('htok');
  const helloA = a.messages.find((message) => message.t === 'hello_ok');
  fake.createRoom(gameCode, {
    phase: 'lobby', players: 2, capacity: 2, joinable: false, hubOwner: htok,
  });
  await waitForPlay(b, 0);
  await waitForRoom(a, 'playing');

  // Queda e reconexão com o mesmo token: a sala segue playing, dono confere.
  await a.close();
  const a2 = await connectClient(port);
  clients.push(a2);
  const hello = await a2.hello({ token: helloA.token });
  assert.equal(hello.t, 'hello_ok');
  assert.equal(hello.room.phase, 'playing');
  assert.equal(hello.room.match.gameCode, gameCode);
  await a2.next((message) => message.t === 'play', 2000);

  await delay(150);
  assert.equal(hub.snapshot().rooms[0].phase, 'playing');
  assert.equal(hub.snapshot().rooms[0].match.gameCode, gameCode);
  const errors = a2.messages.filter(
    (message) => message.t === 'error' && (message.code === 'LAUNCH_CONFLICT' || message.code === 'GAME_FAILED'),
  );
  assert.equal(errors.length, 0);
});

// ---------- servidores reais ----------

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
  const tsx = `${VAVA_ROOT}/node_modules/tsx/dist/cli.mjs`;
  const entry = `${VAVA_ROOT}/packages/server/src/index.ts`;
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

function gameMessage(ws, payload, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', onMessage);
      reject(new Error('tempo esgotado esperando resposta do jogo'));
    }, timeout);
    function onMessage(data) {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (message.t === 'joined' || message.t === 'error') {
        clearTimeout(timer);
        ws.removeListener('message', onMessage);
        resolve(message);
      }
    }
    ws.on('message', onMessage);
    ws.send(JSON.stringify(payload));
  });
}

async function openGameSocket(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return ws;
}

async function gameState(port, code) {
  const response = await fetch(
    `http://127.0.0.1:${port}/__hub/state?room=${code}`,
    { headers: { 'x-hub-secret': SECRET } },
  );
  return { status: response.status, body: await response.text() };
}

test('Hub respeita close 403 do VAVA real e só considera 200 {closed:true}', async (t) => {
  const vavaPort = await startVavaServer(t);
  const { hub, port } = await startTestHub({ ports: { vava: vavaPort } });
  const clients = [];
  const gameSockets = [];
  t.after(async () => {
    for (const ws of gameSockets) {
      try {
        ws.terminate();
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

  const gs = await openGameSocket(vavaPort);
  gameSockets.push(gs);
  const joined = await gameMessage(gs, { t: 'create', code: 'ZX92', name: 'Ze', htok: 'tok-dono-6' });
  assert.equal(joined.t, 'joined');

  // Dono divergente: 403, sem retry destrutivo, sala intacta.
  const wrong = await hub.closeGameRoom('vava', 'ZX92', 'tok-errado');
  assert.equal(wrong.status, 403);
  assert.equal(wrong.notMine, true);
  assert.equal(wrong.closed, false);
  const still = await gameState(vavaPort, 'ZX92');
  assert.equal(still.status, 200);

  // Dono certo: 200 {closed:true}, sala some.
  const right = await hub.closeGameRoom('vava', 'ZX92', 'tok-dono-6');
  assert.equal(right.status, 200);
  assert.equal(right.closed, true);
  const gone = await gameState(vavaPort, 'ZX92');
  assert.equal(gone.status, 404);

  // Resultado registrado e exposto no snapshot.
  const log = hub.snapshot().closeLog.filter((entry) => entry.gameCode === 'ZX92');
  assert.ok(log.some((entry) => entry.notMine && entry.status === 403));
  assert.ok(log.some((entry) => entry.closed && entry.status === 200));
});

test('dois lançamentos simultâneos isolados contra VAVA real', async (t) => {
  const vavaPort = await startVavaServer(t);
  const { hub, port } = await startTestHub({
    ports: { vava: vavaPort },
    timings: {
      launchTimeout: 10000,
      launchPollInterval: 25,
      playPollInterval: 25,
      graceVava: 120,
      closeDelay: 60,
      stateTimeout: 1000,
    },
  });
  const clients = [];
  const gameSockets = [];
  t.after(async () => {
    for (const ws of gameSockets) {
      try {
        ws.terminate();
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

  async function launchVavaRoom(nickA, nickB) {
    const a = await connectClient(port);
    clients.push(a);
    await a.hello({ nick: nickA });
    const b = await connectClient(port);
    clients.push(b);
    await b.hello({ nick: nickB });
    a.send({ t: 'create_room', gameId: 'vava', capacity: 2 });
    const room = await waitForRoom(a, 'lobby');
    b.send({ t: 'join_room', code: room.room.code });
    await waitForRoom(b, 'lobby');
    return { a, b, roomCode: room.room.code };
  }

  const first = await launchVavaRoom('Alice', 'Bob');
  const second = await launchVavaRoom('Carol', 'Dave');
  first.a.send({ t: 'set_ready', ready: true });
  first.b.send({ t: 'set_ready', ready: true });
  second.a.send({ t: 'set_ready', ready: true });
  second.b.send({ t: 'set_ready', ready: true });

  const [playA, playB] = await Promise.all([
    waitForPlay(first.a, 1, 8000),
    waitForPlay(second.a, 1, 8000),
  ]);
  const urlA = new URL(playA.url);
  const urlB = new URL(playB.url);
  const codeA = urlA.searchParams.get('room');
  const codeB = urlB.searchParams.get('room');
  assert.notStrictEqual(codeA, codeB);
  assert.notStrictEqual(urlA.searchParams.get('htok'), urlB.searchParams.get('htok'));

  // Os criadores fazem create no jogo real, cada um com seu código+htok.
  const gsA = await openGameSocket(vavaPort);
  gameSockets.push(gsA);
  const joinedA = await gameMessage(gsA, {
    t: 'create', code: codeA, name: 'Alice', htok: urlA.searchParams.get('htok'),
  });
  assert.equal(joinedA.t, 'joined');
  const gsB = await openGameSocket(vavaPort);
  gameSockets.push(gsB);
  const joinedB = await gameMessage(gsB, {
    t: 'create', code: codeB, name: 'Carol', htok: urlB.searchParams.get('htok'),
  });
  assert.equal(joinedB.t, 'joined');

  await waitForPlay(first.b, 0, 8000);
  await waitForPlay(second.b, 0, 8000);
  await waitForRoom(first.a, 'playing', 8000);
  await waitForRoom(second.a, 'playing', 8000);
  const snapshot = hub.snapshot();
  assert.equal(snapshot.rooms.length, 2);
  const byCode = new Map(snapshot.rooms.map((room) => [room.code, room]));
  assert.equal(byCode.get(first.roomCode).match.gameCode, codeA);
  assert.equal(byCode.get(second.roomCode).match.gameCode, codeB);

  // Encerrar a primeira não afeta a segunda (isolamento).
  const endA = await fetch(`http://127.0.0.1:${vavaPort}/__hub/test/end?room=${codeA}`, {
    method: 'POST',
    headers: { 'x-hub-secret': SECRET },
  });
  assert.equal(endA.status, 200);
  await waitForRoom(first.a, 'finished', 8000);
  assert.equal(
    hub.snapshot().rooms.find((room) => room.code === second.roomCode).phase,
    'playing',
  );
  await waitForRoom(first.a, 'lobby', 8000);

  const endB = await fetch(`http://127.0.0.1:${vavaPort}/__hub/test/end?room=${codeB}`, {
    method: 'POST',
    headers: { 'x-hub-secret': SECRET },
  });
  assert.equal(endB.status, 200);
  await waitForRoom(second.a, 'lobby', 8000);

  // Cada partida foi fechada com seu próprio htok.
  for (const code of [codeA, codeB]) {
    await waitForCondition(async () => (await gameState(vavaPort, code)).status === 404, 8000);
  }
  const log = hub.snapshot().closeLog;
  for (const code of [codeA, codeB]) {
    assert.ok(log.some((entry) => entry.gameCode === code && entry.closed), `close de ${code}`);
  }
});
