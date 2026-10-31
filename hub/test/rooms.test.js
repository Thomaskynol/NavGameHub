import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectClient,
  startFakeGame,
  startTestHub,
  waitForCondition,
  waitForRoom,
} from './helpers.mjs';

async function setup(t, gameIds) {
  const fakes = {};
  const ports = {};
  for (const id of gameIds) {
    fakes[id] = await startFakeGame({ id });
    ports[id] = fakes[id].port;
  }
  const { hub, port } = await startTestHub({ ports });
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

test('salas: capacidade, troca de jogo, prontidão e sucessão de anfitrião', async (t) => {
  const { hub, port, clients } = await setup(t, ['arcade', 'catan', 'vava']);

  const a = await connectClient(port);
  clients.push(a);
  const helloA = await a.hello({ nick: 'Alice' });
  const b = await connectClient(port);
  clients.push(b);
  const helloB = await b.hello({ nick: 'Bob' });
  const c = await connectClient(port);
  clients.push(c);
  const helloC = await c.hello({ nick: 'Carol' });

  a.send({ t: 'create_room', gameId: 'arcade', capacity: 2 });
  const roomA = await waitForRoom(a, 'lobby');
  assert.equal(roomA.room.capacity, 2);
  assert.equal(roomA.room.gameId, 'arcade');
  assert.equal(roomA.room.members.length, 1);
  assert.equal(roomA.room.hostId, helloA.you.id);

  b.send({ t: 'join_room', code: roomA.room.code });
  const roomB = await waitForRoom(b, 'lobby');
  assert.equal(roomB.room.members.length, 2);
  assert.equal(roomB.room.you.role, 'player');

  c.send({ t: 'join_room', code: roomA.room.code });
  const full = await c.next((message) => message.t === 'error' && message.code === 'ROOM_FULL');
  assert.equal(full.code, 'ROOM_FULL');

  // Reduzir abaixo da ocupação é bloqueado.
  b.send({ t: 'set_ready', ready: true });
  await b.next((message) => message.t === 'room' && message.room.you.ready === true);
  a.send({ t: 'set_capacity', capacity: 1 });
  const below = await a.next((message) => message.t === 'error' && message.code === 'CAPACITY_LT_OCCUPANCY');
  assert.equal(below.code, 'CAPACITY_LT_OCCUPANCY');

  a.send({ t: 'set_capacity', capacity: 7 });
  const above = await a.next((message) => message.t === 'error' && message.code === 'CAPACITY_GT_MAX');
  assert.equal(above.code, 'CAPACITY_GT_MAX');

  // Mudança válida de capacidade reseta a prontidão de todos.
  a.send({ t: 'set_capacity', capacity: 3 });
  const grown = await b.next((message) => message.t === 'room' && message.room.capacity === 3);
  assert.equal(grown.room.you.ready, false);

  a.send({ t: 'set_capacity', capacity: 5 });
  await a.next((message) => message.t === 'room' && message.room.capacity === 5);

  // Catan (máximo 4) não cabe na capacidade 5; VAVA (máximo 8) cabe.
  a.send({ t: 'set_game', gameId: 'catan' });
  const catanTooSmall = await a.next(
    (message) => message.t === 'error' && message.code === 'CAPACITY_GT_MAX',
  );
  assert.equal(catanTooSmall.code, 'CAPACITY_GT_MAX');

  a.send({ t: 'set_game', gameId: 'nao-existe' });
  const badGame = await a.next((message) => message.t === 'error' && message.code === 'BAD_GAME');
  assert.equal(badGame.code, 'BAD_GAME');

  a.send({ t: 'set_game', gameId: 'vava' });
  const vavaRoom = await a.next(
    (message) => message.t === 'room' && message.room.gameId === 'vava',
  );
  assert.equal(vavaRoom.room.capacity, 5);

  a.send({ t: 'set_capacity', capacity: 4 });
  await a.next((message) => message.t === 'room' && message.room.capacity === 4);
  a.send({ t: 'set_game', gameId: 'catan' });
  const catanRoom = await a.next(
    (message) => message.t === 'room' && message.room.gameId === 'catan',
  );
  assert.equal(catanRoom.room.capacity, 4);
  assert.equal(catanRoom.room.members.every((member) => member.ready === false), true);

  b.send({ t: 'set_capacity', capacity: 2 });
  const notHostCapacity = await b.next(
    (message) => message.t === 'error' && message.code === 'NOT_HOST',
  );
  assert.equal(notHostCapacity.code, 'NOT_HOST');
  b.send({ t: 'set_game', gameId: 'arcade' });
  const notHostGame = await b.next(
    (message) => message.t === 'error' && message.code === 'NOT_HOST',
  );
  assert.equal(notHostGame.code, 'NOT_HOST');

  // Sucessão: o restante mais antigo assume quando o anfitrião sai.
  a.send({ t: 'leave_room' });
  const leftA = await a.next((message) => message.t === 'left');
  assert.equal(leftA.t, 'left');
  const successorView = await b.next(
    (message) => message.t === 'room' && message.room.hostId === helloB.you.id,
  );
  assert.equal(successorView.room.hostId, helloB.you.id);
  assert.equal(hub.snapshot().rooms[0].hostId, helloB.you.id);

  // Sala vazia é removida da lista.
  c.clear();
  b.send({ t: 'leave_room' });
  await b.next((message) => message.t === 'left');
  await waitForCondition(() => hub.snapshot().rooms.length === 0);
  const catalog = await c.next((message) => message.t === 'catalog' && message.rooms.length === 0);
  assert.deepEqual(catalog.rooms, []);
  assert.equal(helloC.you.nick, 'Carol');
});

test('salas: duas entradas simultâneas na última vaga, só uma vence', async (t) => {
  const { hub, port, clients } = await setup(t, ['arcade']);

  const a = await connectClient(port);
  clients.push(a);
  await a.hello({ nick: 'Alice' });
  const b = await connectClient(port);
  clients.push(b);
  await b.hello({ nick: 'Bob' });
  const c = await connectClient(port);
  clients.push(c);
  await c.hello({ nick: 'Carol' });

  a.send({ t: 'create_room', gameId: 'arcade', capacity: 2 });
  const room = await waitForRoom(a, 'lobby');

  const outcomeB = b.next((message) => message.t === 'room' || message.t === 'error');
  const outcomeC = c.next((message) => message.t === 'room' || message.t === 'error');
  b.send({ t: 'join_room', code: room.room.code });
  c.send({ t: 'join_room', code: room.room.code });
  const [resultB, resultC] = await Promise.all([outcomeB, outcomeC]);

  const successes = [resultB, resultC].filter((message) => message.t === 'room');
  const failures = [resultB, resultC].filter((message) => message.t === 'error');
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, 'ROOM_FULL');
  assert.equal(hub.snapshot().rooms[0].members.length, 2);
});

test('salas: entrar em sala inexistente e ações sem sala', async (t) => {
  const { port, clients } = await setup(t, ['arcade']);
  const a = await connectClient(port);
  clients.push(a);
  await a.hello({ nick: 'Alice' });

  a.send({ t: 'join_room', code: 'ZZZZZZ' });
  const missing = await a.next((message) => message.t === 'error' && message.code === 'ROOM_NOT_FOUND');
  assert.equal(missing.code, 'ROOM_NOT_FOUND');

  a.send({ t: 'set_ready', ready: true });
  const notInRoom = await a.next((message) => message.t === 'error' && message.code === 'NOT_IN_ROOM');
  assert.equal(notInRoom.code, 'NOT_IN_ROOM');

  a.send({ t: 'leave_room' });
  const leaveMissing = await a.next((message) => message.t === 'error' && message.code === 'NOT_IN_ROOM');
  assert.equal(leaveMissing.code, 'NOT_IN_ROOM');
});
