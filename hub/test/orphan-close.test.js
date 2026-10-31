import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectClient,
  delay,
  startFakeGame,
  startTestHub,
  waitForCondition,
  waitForPlay,
  waitForRoom,
} from './helpers.mjs';

async function setup(t, timings = {}) {
  const fake = await startFakeGame({ id: 'arcade' });
  const { hub, port } = await startTestHub({
    ports: { arcade: fake.port },
    timings: {
      graceDefault: 40, closeDelay: 60, launchPollInterval: 10, playPollInterval: 10, ...timings,
    },
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

async function launchMatch({ port, fake, clients, nickA = 'Alice', nickB = 'Bob' }) {
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
  const play = await waitForPlay(a, 1);
  const url = new URL(play.url);
  const gameCode = url.searchParams.get('room');
  fake.createRoom(gameCode, { phase: 'lobby', players: 2, capacity: 2, joinable: false });
  await waitForPlay(b, 0);
  await waitForRoom(a, 'playing');
  return { a, b, gameCode, htok: url.searchParams.get('htok') };
}

async function closeOf(fake, gameCode) {
  await waitForCondition(() => fake.requests.some(
    (request) => request.method === 'POST'
      && request.path === '/__hub/close'
      && request.room === gameCode,
  ), 3000);
  return fake.requests.find(
    (request) => request.method === 'POST'
      && request.path === '/__hub/close'
      && request.room === gameCode,
  );
}

// R3: sair depois do prazo (sala já voltou ao lobby, close ainda pendente).
test('R3: saída após o retorno ao lobby ainda fecha a partida', async (t) => {
  const { hub, port, fake, clients } = await setup(t);
  const { a, b, gameCode, htok } = await launchMatch({ port, fake, clients });
  assert.ok(htok);

  fake.setRoom(gameCode, { phase: 'results' });
  await waitForRoom(a, 'lobby');
  await waitForCondition(() => hub.snapshot().rooms[0].match === null);

  a.send({ t: 'leave_room' });
  b.send({ t: 'leave_room' });
  await waitForCondition(() => hub.snapshot().rooms.length === 0);
  const close = await closeOf(fake, gameCode);
  assert.equal(close.htok, htok);
  assert.equal(fake.rooms.has(gameCode), false);
});

// R3: sair antes do prazo (ainda em finished, graça pendente).
test('R3: saída durante a graça executa o close na destruição', async (t) => {
  const { hub, port, fake, clients } = await setup(t, { graceDefault: 400 });
  const { a, b, gameCode, htok } = await launchMatch({ port, fake, clients });

  fake.setRoom(gameCode, { phase: 'results' });
  await waitForRoom(a, 'finished');
  a.send({ t: 'leave_room' });
  b.send({ t: 'leave_room' });
  await waitForCondition(() => hub.snapshot().rooms.length === 0);
  const close = await closeOf(fake, gameCode);
  assert.equal(close.htok, htok);
  assert.equal(fake.rooms.has(gameCode), false);
});

// R3: partidas sucessivas — o close pendente da anterior não atinge a nova
// (identidade htok) e ambas são fechadas.
test('R3: partidas sucessivas fecham cada uma com seu htok', async (t) => {
  const { hub, port, fake, clients } = await setup(t, { closeDelay: 300 });
  const first = await launchMatch({ port, fake, clients, nickA: 'Alice', nickB: 'Bob' });
  fake.setRoom(first.gameCode, { phase: 'results' });
  await waitForRoom(first.a, 'lobby');

  // Segunda partida na mesma sala do Hub antes do close da primeira.
  first.a.send({ t: 'set_ready', ready: true });
  first.b.send({ t: 'set_ready', ready: true });
  const play = await waitForPlay(first.a, 1);
  const gameCode2 = new URL(play.url).searchParams.get('room');
  const htok2 = new URL(play.url).searchParams.get('htok');
  assert.notStrictEqual(gameCode2, first.gameCode);
  assert.notStrictEqual(htok2, first.htok);
  fake.createRoom(gameCode2, { phase: 'lobby', players: 2, capacity: 2, joinable: false });
  await waitForPlay(first.b, 0);
  await waitForRoom(first.a, 'playing');

  const close1 = await closeOf(fake, first.gameCode);
  assert.equal(close1.htok, first.htok);
  // A partida nova continua intacta: o close antigo não a removeu.
  assert.equal(fake.rooms.has(gameCode2), true);

  first.a.send({ t: 'leave_room' });
  first.b.send({ t: 'leave_room' });
  await waitForCondition(() => hub.snapshot().rooms.length === 0);
  const close2 = await closeOf(fake, gameCode2);
  assert.equal(close2.htok, htok2);
  assert.equal(fake.rooms.has(gameCode2), false);
});

// R3: fechamento com jogo fora do ar não derruba o Hub (best-effort + retry).
test('R3: close falho não quebra a limpeza nem o Hub', async (t) => {
  const { hub, port, fake, clients } = await setup(t);
  const { a, b, gameCode } = await launchMatch({ port, fake, clients });

  fake.setRoom(gameCode, { phase: 'results' });
  await waitForRoom(a, 'lobby');
  await fake.close();
  a.send({ t: 'leave_room' });
  b.send({ t: 'leave_room' });
  await waitForCondition(() => hub.snapshot().rooms.length === 0);
  await delay(400);

  // Hub segue utilizável: nova sala pode ser criada.
  const c = await connectClient(port);
  clients.push(c);
  await c.hello({ nick: 'Carol' });
  c.send({ t: 'create_room', gameId: 'arcade', capacity: 6 });
  await waitForRoom(c, 'lobby');
});
