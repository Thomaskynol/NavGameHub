import test from 'node:test';
import assert from 'node:assert/strict';
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

async function setup(t, gameIds, timings = {}) {
  const fakes = {};
  const ports = {};
  for (const id of gameIds) {
    fakes[id] = await startFakeGame({ id });
    ports[id] = fakes[id].port;
  }
  const { hub, port } = await startTestHub({ ports, timings });
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
    for (const fake of Object.values(fakes)) await fake.close();
  });
  return { hub, port, fakes, clients };
}

async function startMatch({ fakes, clients, port, gameId, capacity, codeLength, duringLaunch }) {
  const a = await connectClient(port);
  clients.push(a);
  const helloA = await a.hello({ nick: 'Alice' });
  const b = await connectClient(port);
  clients.push(b);
  const helloB = await b.hello({ nick: 'Bob' });

  a.send({ t: 'create_room', gameId, capacity });
  const room = await waitForRoom(a, 'lobby');
  b.send({ t: 'join_room', code: room.room.code });
  await waitForRoom(b, 'lobby');

  a.send({ t: 'set_ready', ready: true });
  b.send({ t: 'set_ready', ready: true });

  await waitForRoom(a, 'launching');
  const playA = await waitForPlay(a, 1);
  const urlA = new URL(playA.url);
  const gameCode = urlA.searchParams.get('room');
  assert.equal(gameCode.length, codeLength);

  if (duringLaunch) {
    await duringLaunch({ gameCode, urlA, playA, roomCode: room.room.code });
  }

  fakes[gameId].createRoom(gameCode, {
    phase: 'lobby',
    players: 2,
    capacity,
    joinable: gameId === 'vava',
  });
  const playB = await waitForPlay(b, 0);
  await waitForRoom(a, 'playing');
  await waitForRoom(b, 'playing');

  return {
    a,
    b,
    helloA,
    helloB,
    roomCode: room.room.code,
    gameCode,
    urlA,
    playB,
  };
}

test('lançamento Arcade: create=1 no criador, create=0 nos demais e retorno', async (t) => {
  const { hub, port, fakes, clients } = await setup(t, ['arcade']);
  const c = await connectClient(port);
  clients.push(c);
  await c.hello({ nick: 'Carol' });
  let launchingError = null;
  const match = await startMatch({
    fakes,
    clients,
    port,
    gameId: 'arcade',
    capacity: 6,
    codeLength: 6,
    duringLaunch: async ({ roomCode }) => {
      c.send({ t: 'join_room', code: roomCode });
      launchingError = await c.next(
        (message) => message.t === 'error' && message.code === 'LAUNCHING',
      );
    },
  });

  const { a, b, helloA, gameCode, urlA, playB, roomCode } = match;
  assert.equal(launchingError.code, 'LAUNCHING');
  assert.equal(urlA.hostname, '127.0.0.1');
  assert.equal(urlA.port, String(fakes.arcade.port));
  assert.equal(urlA.pathname, '/');
  assert.equal(urlA.searchParams.get('hub'), '1');
  assert.equal(urlA.searchParams.get('room'), gameCode);
  assert.equal(urlA.searchParams.get('name'), 'Alice');
  assert.equal(urlA.searchParams.get('create'), '1');
  assert.equal(urlA.searchParams.get('expect'), '2');
  assert.equal(urlA.searchParams.get('slot'), '0');
  const hubUrl = new URL(urlA.searchParams.get('hubUrl'));
  assert.equal(hubUrl.port, String(port));
  assert.equal(hubUrl.searchParams.get('room'), roomCode);

  const urlB = new URL(playB.url);
  assert.equal(urlB.searchParams.get('name'), 'Bob');
  assert.equal(urlB.searchParams.get('create'), '0');
  assert.equal(urlB.searchParams.get('slot'), '1');
  assert.equal(urlB.searchParams.get('room'), gameCode);

  const playing = hub.snapshot().rooms[0];
  assert.equal(playing.phase, 'playing');
  assert.equal(playing.match.gameCode, gameCode);
  assert.equal(playing.hostId, helloA.you.id);

  // O jogo informa o resultado; o Hub mantém a partida durante a graça.
  fakes.arcade.setRoom(gameCode, { phase: 'results' });
  const finished = await waitForRoom(a, 'finished');
  assert.equal(finished.room.match.gameCode, gameCode);
  assert.ok(hub.snapshot().rooms[0].match);

  // Depois da graça: lobby, sem match, todos não prontos.
  await waitForRoom(a, 'lobby');
  await waitForCondition(() => hub.snapshot().rooms[0].match === null);
  const returned = hub.snapshot().rooms[0];
  assert.equal(returned.phase, 'lobby');
  assert.equal(returned.members.every((member) => member.ready === false), true);

  // POST /__hub/close após o atraso configurado.
  await waitForCondition(() => fakes.arcade.requests.some(
    (request) => request.method === 'POST'
      && request.path === '/__hub/close'
      && request.room === gameCode,
  ));
  const closeRequest = fakes.arcade.requests.find(
    (request) => request.method === 'POST'
      && request.path === '/__hub/close'
      && request.room === gameCode,
  );
  assert.equal(closeRequest.secret, SECRET);

  b.send({ t: 'ping', ts: 7 });
  const pong = await b.next((message) => message.t === 'pong');
  assert.equal(pong.ts, 7);
});

test('lançamento: sem sala no jogo, volta ao lobby com LAUNCH_FAILED', async (t) => {
  const { hub, port, fakes, clients } = await setup(t, ['arcade'], {
    launchTimeout: 120,
    launchPollInterval: 10,
  });

  const a = await connectClient(port);
  clients.push(a);
  await a.hello({ nick: 'Alice' });
  const b = await connectClient(port);
  clients.push(b);
  await b.hello({ nick: 'Bob' });

  a.send({ t: 'create_room', gameId: 'arcade', capacity: 6 });
  const room = await waitForRoom(a, 'lobby');
  b.send({ t: 'join_room', code: room.room.code });
  await waitForRoom(b, 'lobby');

  a.send({ t: 'set_ready', ready: true });
  b.send({ t: 'set_ready', ready: true });
  await waitForRoom(a, 'launching');
  await waitForPlay(a, 1);

  const failure = await a.next(
    (message) => message.t === 'error' && message.code === 'LAUNCH_FAILED',
  );
  assert.equal(failure.code, 'LAUNCH_FAILED');
  const back = await waitForRoom(a, 'lobby');
  assert.equal(back.room.match, null);
  assert.equal(back.room.you.ready, false);
  assert.equal(hub.snapshot().rooms[0].phase, 'lobby');
  assert.equal(hub.snapshot().rooms[0].match, null);

  // A sala do jogo nunca existiu; o servidor falso não recebeu close.
  assert.equal(fakes.arcade.rooms.size, 0);
});

test('VAVA: entrada no meio da partida como player e play create=0', async (t) => {
  const { port, fakes, clients } = await setup(t, ['vava']);
  const match = await startMatch({
    fakes,
    clients,
    port,
    gameId: 'vava',
    capacity: 8,
    codeLength: 4,
  });

  const c = await connectClient(port);
  clients.push(c);
  await c.hello({ nick: 'Carol' });
  c.send({ t: 'join_room', code: match.roomCode });
  const roomC = await waitForRoom(c, 'playing');
  assert.equal(roomC.room.you.role, 'player');
  assert.equal(roomC.room.members.length, 3);

  const playC = await waitForPlay(c, 0);
  const urlC = new URL(playC.url);
  assert.equal(urlC.searchParams.get('room'), match.gameCode);
  assert.equal(urlC.searchParams.get('name'), 'Carol');
  assert.equal(urlC.searchParams.get('create'), '0');
  assert.equal(urlC.searchParams.get('slot'), '2');
});

test('Arcade: entrada no meio aguarda e retorna como player', async (t) => {
  const { hub, port, fakes, clients } = await setup(t, ['arcade']);
  const match = await startMatch({
    fakes,
    clients,
    port,
    gameId: 'arcade',
    capacity: 6,
    codeLength: 6,
  });

  const c = await connectClient(port);
  clients.push(c);
  await c.hello({ nick: 'Carol' });
  c.send({ t: 'join_room', code: match.roomCode });
  const roomC = await waitForRoom(c, 'playing');
  assert.equal(roomC.room.you.role, 'waiting');
  assert.equal(roomC.room.members.length, 3);

  await delay(60);
  assert.equal(c.messages.some((message) => message.t === 'play'), false);

  match.b.send({ t: 'leave_match' });
  const bobWaiting = await match.b.next(
    (message) => message.t === 'room'
      && message.room.phase === 'playing'
      && message.room.you.role === 'waiting',
  );
  assert.equal(bobWaiting.room.you.role, 'waiting');

  fakes.arcade.setRoom(match.gameCode, { phase: 'results' });
  const finished = await waitForRoom(c, 'finished');
  assert.equal(finished.room.you.role, 'waiting');

  const back = await waitForRoom(c, 'lobby');
  assert.equal(back.room.you.role, 'player');
  assert.equal(back.room.you.ready, false);
  assert.equal(
    hub.snapshot().rooms[0].members.find((member) => member.nick === 'Carol').role,
    'player',
  );
  assert.equal(
    hub.snapshot().rooms[0].members.find((member) => member.nick === 'Bob').role,
    'player',
  );
});

test('isolamento: duas salas simultâneas no mesmo jogo têm gameCodes distintos', async (t) => {
  const { hub, port, fakes, clients } = await setup(t, ['arcade']);

  async function makeRoom(nickA, nickB) {
    const a = await connectClient(port);
    clients.push(a);
    await a.hello({ nick: nickA });
    const b = await connectClient(port);
    clients.push(b);
    await b.hello({ nick: nickB });
    a.send({ t: 'create_room', gameId: 'arcade', capacity: 6 });
    const room = await waitForRoom(a, 'lobby');
    b.send({ t: 'join_room', code: room.room.code });
    await waitForRoom(b, 'lobby');
    a.send({ t: 'set_ready', ready: true });
    b.send({ t: 'set_ready', ready: true });
    await waitForRoom(a, 'launching');
    const playA = await waitForPlay(a, 1);
    const gameCode = new URL(playA.url).searchParams.get('room');
    fakes.arcade.createRoom(gameCode, {
      phase: 'lobby',
      players: 2,
      capacity: 6,
      joinable: false,
    });
    await waitForPlay(b, 0);
    await waitForRoom(a, 'playing');
    await waitForRoom(b, 'playing');
    return { a, b, roomCode: room.room.code, gameCode };
  }

  const first = await makeRoom('Alice', 'Bob');
  const second = await makeRoom('Carol', 'Dave');
  assert.notStrictEqual(first.gameCode, second.gameCode);

  const snapshot = hub.snapshot();
  assert.equal(snapshot.rooms.length, 2);
  const byCode = new Map(snapshot.rooms.map((room) => [room.code, room]));
  assert.equal(byCode.get(first.roomCode).match.gameCode, first.gameCode);
  assert.equal(byCode.get(second.roomCode).match.gameCode, second.gameCode);

  // Finalizar a primeira sala não afeta a segunda.
  fakes.arcade.setRoom(first.gameCode, { phase: 'results' });
  await waitForRoom(first.a, 'finished');
  assert.equal(
    hub.snapshot().rooms.find((room) => room.code === second.roomCode).phase,
    'playing',
  );

  // Segunda sala finaliza de forma independente.
  fakes.arcade.setRoom(second.gameCode, { phase: 'results' });
  await waitForRoom(second.a, 'finished');

  // Ambas retornam ao lobby da própria sala.
  await waitForRoom(first.a, 'lobby');
  await waitForRoom(second.a, 'lobby');

  // Cada partida recebe seu próprio __hub/close.
  for (const gameCode of [first.gameCode, second.gameCode]) {
    await waitForCondition(() => fakes.arcade.requests.some(
      (request) => request.method === 'POST'
        && request.path === '/__hub/close'
        && request.room === gameCode,
    ));
  }
  const closes = fakes.arcade.requests.filter(
    (request) => request.method === 'POST' && request.path === '/__hub/close',
  );
  assert.equal(
    new Set(closes.map((request) => request.room)).size,
    2,
  );
});

test('HUB_PUBLIC_HOST define o host das URLs do jogo e da sala', async (t) => {
  const arcade = await startFakeGame({ id: 'arcade' });
  const { hub, port } = await startTestHub({
    ports: { arcade: arcade.port },
    publicHost: 'hub.example',
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
    await arcade.close();
  });

  const a = await connectClient(port);
  clients.push(a);
  await a.hello({ nick: 'Alice' });
  const b = await connectClient(port);
  clients.push(b);
  await b.hello({ nick: 'Bob' });

  a.send({ t: 'create_room', gameId: 'arcade', capacity: 6 });
  const room = await waitForRoom(a, 'lobby');
  b.send({ t: 'join_room', code: room.room.code });
  await waitForRoom(b, 'lobby');
  a.send({ t: 'set_ready', ready: true });
  b.send({ t: 'set_ready', ready: true });
  await waitForRoom(a, 'launching');
  const play = await waitForPlay(a, 1);
  const url = new URL(play.url);
  assert.equal(url.hostname, 'hub.example');
  assert.equal(url.port, String(arcade.port));
  assert.equal(new URL(url.searchParams.get('hubUrl')).hostname, 'hub.example');
});
