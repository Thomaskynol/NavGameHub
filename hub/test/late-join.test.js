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

// R5: quem chega com o jogo ainda no pregame (lobby + joinable) recebe play
// (join); waiting só quando a partida começou ou lotou.
test('R5: entrada no pregame recebe play; após o início, espera', async (t) => {
  const fake = await startFakeGame({ id: 'arcade' });
  const { hub, port } = await startTestHub({ ports: { arcade: fake.port } });
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

  const a = await connectClient(port);
  clients.push(a);
  await a.hello({ nick: 'Alice' });
  const b = await connectClient(port);
  clients.push(b);
  await b.hello({ nick: 'Bob' });
  a.send({ t: 'create_room', gameId: 'arcade', capacity: 4 });
  const room = await waitForRoom(a, 'lobby');
  b.send({ t: 'join_room', code: room.room.code });
  await waitForRoom(b, 'lobby');
  a.send({ t: 'set_ready', ready: true });
  b.send({ t: 'set_ready', ready: true });
  await waitForRoom(a, 'launching');
  const playA = await waitForPlay(a, 1);
  const gameCode = new URL(playA.url).searchParams.get('room');

  // O jogo ainda está no lobby e aceita jogadores (conforme: informa o dono).
  fake.createRoom(gameCode, {
    phase: 'lobby', players: 2, capacity: 6, joinable: true,
    hubOwner: new URL(playA.url).searchParams.get('htok'),
  });
  await waitForPlay(b, 0);
  await waitForRoom(a, 'playing');

  const c = await connectClient(port);
  clients.push(c);
  await c.hello({ nick: 'Carol' });
  c.send({ t: 'join_room', code: room.room.code });
  // O play (join) chega junto da promoção a player: espera o play primeiro
  // (cursor do helper) e depois confirma o papel na sala.
  const playC = await waitForPlay(c, 0);
  assert.equal(new URL(playC.url).searchParams.get('room'), gameCode);
  const arrived = await c.next(
    (message) => message.t === 'room'
      && message.room.phase === 'playing'
      && message.room.you.role === 'player',
    3000,
  );
  assert.equal(arrived.room.you.role, 'player');

  // A partida começou: recém-chegado espera, sem play.
  fake.setRoom(gameCode, { phase: 'playing', joinable: false });
  await waitForCondition(() => hub.snapshot().rooms[0].match.joinable === false);
  const d = await connectClient(port);
  clients.push(d);
  await d.hello({ nick: 'Dave' });
  d.send({ t: 'join_room', code: room.room.code });
  const waiting = await waitForRoom(d, 'playing');
  assert.equal(waiting.room.you.role, 'waiting');
  await delay(80);
  assert.equal(d.messages.some((message) => message.t === 'play'), false);
});

test('R5: jogo lotado mantém o recém-chegado em espera', async (t) => {
  const fake = await startFakeGame({ id: 'arcade' });
  const { hub, port } = await startTestHub({ ports: { arcade: fake.port } });
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
  const playA = await waitForPlay(a, 1);
  const gameCode = new URL(playA.url).searchParams.get('room');
  // Lobby, mas sem vaga no jogo (conforme: informa o dono).
  fake.createRoom(gameCode, {
    phase: 'lobby', players: 6, capacity: 6, joinable: true,
    hubOwner: new URL(playA.url).searchParams.get('htok'),
  });
  await waitForPlay(b, 0);
  await waitForRoom(a, 'playing');

  const c = await connectClient(port);
  clients.push(c);
  await c.hello({ nick: 'Carol' });
  c.send({ t: 'join_room', code: room.room.code });
  const waiting = await waitForRoom(c, 'playing');
  assert.equal(waiting.room.you.role, 'waiting');
  await delay(80);
  assert.equal(c.messages.some((message) => message.t === 'play'), false);
});
