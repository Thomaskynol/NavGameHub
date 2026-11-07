import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectClient,
  delay,
  startFakeGame,
  startTestHub,
  waitForCondition,
  waitForRoom,
} from './helpers.mjs';

test('catálogo, /api/rooms, /health e proteção de caminho', async (t) => {
  const arcade = await startFakeGame({ id: 'arcade' });
  const vava = await startFakeGame({ id: 'vava' });
  const catan = await startFakeGame({ id: 'catan' });
  const netwars = await startFakeGame({ id: 'netwars' });
  const { hub, port } = await startTestHub({
    ports: { arcade: arcade.port, vava: vava.port, catan: catan.port, netwars: netwars.port },
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
    await vava.close();
    await catan.close();
    await netwars.close();
  });

  const a = await connectClient(port);
  clients.push(a);
  await a.hello({ nick: 'Alice' });

  const catalog = await a.next((message) => message.t === 'catalog');
  assert.equal(catalog.games.length, 4);
  assert.equal(catalog.games.every((game) => game.status === 'online'), true);
  assert.deepEqual(catalog.rooms, []);
  assert.deepEqual(Object.keys(catalog.games[0]).sort(), [
    'accent',
    'description',
    'id',
    'maxPlayers',
    'midMatchJoin',
    'minPlayers',
    'name',
    'status',
    'tagline',
    'tags',
  ].sort());

  a.send({ t: 'create_room', gameId: 'arcade', capacity: 2 });
  const room = await waitForRoom(a, 'lobby');
  const changed = await a.next(
    (message) => message.t === 'catalog' && message.rooms.length === 1,
  );
  assert.equal(changed.rooms[0].code, room.room.code);
  assert.equal(changed.rooms[0].gameId, 'arcade');
  assert.equal(changed.rooms[0].gameName, 'Asfalto Vivo');
  assert.equal(changed.rooms[0].capacity, 2);
  assert.equal(changed.rooms[0].occupancy, 1);
  assert.equal(changed.rooms[0].phase, 'lobby');
  assert.equal(changed.rooms[0].hostNick, 'Alice');

  const healthResponse = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), { ok: true });

  const roomsResponse = await fetch(`http://127.0.0.1:${port}/api/rooms`);
  assert.equal(roomsResponse.status, 200);
  const roomsBody = await roomsResponse.json();
  assert.equal(roomsBody.rooms.length, 1);
  assert.equal(roomsBody.rooms[0].code, room.room.code);

  const traversal = await fetch(`http://127.0.0.1:${port}/..%2fpackage.json`);
  assert.equal(traversal.status, 403);
  const traversalBody = await traversal.text();
  assert.equal(traversalBody.includes('"name": "game-hub"'), false);

  const missing = await fetch(`http://127.0.0.1:${port}/arquivo-inexistente.js`);
  assert.equal(missing.status, 404);

  const index = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /^text\/html/);
  assert.equal(index.headers.get('cache-control'), 'no-store');

  const fallback = await fetch(`http://127.0.0.1:${port}/sala/ABC`);
  assert.equal(fallback.status, 200);
  assert.match(fallback.headers.get('content-type'), /^text\/html/);
});

test('jogo offline não pode ser selecionado nem criado', async (t) => {
  const arcade = await startFakeGame({ id: 'arcade' });
  const vava = await startFakeGame({ id: 'vava' });
  let catanOnline = false;
  const { hub, port } = await startTestHub({
    ports: { arcade: arcade.port, vava: vava.port },
    timings: { healthInterval: 25, healthTimeout: 100 },
    probe: async (game) => (game.id === 'catan' ? catanOnline : true),
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
    await vava.close();
  });

  const a = await connectClient(port);
  clients.push(a);
  await a.hello({ nick: 'Alice' });

  const catalog = await a.next(
    (message) => message.t === 'catalog'
      && message.games.find((game) => game.id === 'catan')?.status === 'offline',
  );
  assert.equal(catalog.games.find((game) => game.id === 'catan').status, 'offline');

  a.send({ t: 'create_room', gameId: 'catan' });
  const offline = await a.next(
    (message) => message.t === 'error' && message.code === 'GAME_OFFLINE',
  );
  assert.equal(offline.code, 'GAME_OFFLINE');

  catanOnline = true;
  await a.next(
    (message) => message.t === 'catalog'
      && message.games.find((game) => game.id === 'catan')?.status === 'online',
    2_000,
  );

  a.send({ t: 'create_room', gameId: 'catan' });
  const room = await waitForRoom(a, 'lobby');
  assert.equal(room.room.gameId, 'catan');
  assert.equal(room.room.capacity, 4);
});

test('rate limit responde RATE sem derrubar a conexão', async (t) => {
  const arcade = await startFakeGame({ id: 'arcade' });
  const { hub, port } = await startTestHub({
    ports: { arcade: arcade.port },
    timings: { rateLimit: 5, rateWindow: 50 },
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

  for (let i = 0; i < 10; i += 1) a.send({ t: 'ping', ts: i });
  const rate = await a.next((message) => message.t === 'error' && message.code === 'RATE');
  assert.equal(rate.code, 'RATE');

  await waitForCondition(() => a.ws.readyState === 1);
  await delay(70);
  a.send({ t: 'ping', ts: 99 });
  const pong = await a.next((message) => message.t === 'pong' && message.ts === 99);
  assert.equal(pong.ts, 99);
});
