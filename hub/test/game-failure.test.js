import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectClient,
  delay,
  startFakeGame,
  startTestHub,
  waitForPlay,
  waitForRoom,
} from './helpers.mjs';

async function launchPlaying(t, timings = {}) {
  const fake = await startFakeGame({ id: 'arcade' });
  const { hub, port } = await startTestHub({
    ports: { arcade: fake.port },
    timings: {
      playPollInterval: 15,
      playNotFoundLimit: 3,
      playErrorLimit: 3,
      playErrorTimeout: 5000,
      stateTimeout: 100,
      ...timings,
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
    try {
      await fake.close();
    } catch {
      // já encerrado no teste
    }
  });

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
  a.send({ t: 'set_ready', ready: true });
  b.send({ t: 'set_ready', ready: true });
  const play = await waitForPlay(a, 1);
  const gameCode = new URL(play.url).searchParams.get('room');
  const htok = new URL(play.url).searchParams.get('htok');
  fake.createRoom(gameCode, { phase: 'playing', players: 2, capacity: 2, joinable: false, hubOwner: htok });
  await waitForPlay(b, 0);
  await waitForRoom(a, 'playing');
  return { hub, port, fake, clients, a, b, gameCode };
}

// R8: erro transitório isolado não encerra a partida.
test('R8: falha única de state mantém playing sem GAME_FAILED', async (t) => {
  const { hub, fake, clients, a } = await launchPlaying(t);
  fake.setFailState(1);
  await delay(150);
  assert.equal(hub.snapshot().rooms[0].phase, 'playing');
  assert.ok(a.messages.every((message) => !(message.t === 'error' && message.code === 'GAME_FAILED')));
});

// R8: servidor do jogo some → FALHA clara, grupo volta a lobby utilizável.
test('R8: pane persistente vira FALHA e devolve lobby utilizável', async (t) => {
  const { hub, fake, clients, a, gameCode } = await launchPlaying(t);
  await fake.close();

  const failure = await a.next(
    (message) => message.t === 'error' && message.code === 'GAME_FAILED',
    3000,
  );
  assert.match(failure.message, /parou de responder|FALHA|falha|interrompida/i);
  await waitForRoom(a, 'lobby');
  const room = hub.snapshot().rooms[0];
  assert.equal(room.phase, 'lobby');
  assert.equal(room.match, null);
  assert.ok(room.members.every((member) => member.ready === false));

  // Lobby utilizável: anfitrião pode reconfigurar; nada ficou preso em playing.
  a.send({ t: 'set_capacity', capacity: 4 });
  await a.next((message) => message.t === 'room' && message.room.capacity === 4);
  assert.equal(hub.snapshot().rooms[0].phase, 'lobby');
  assert.equal(fake.rooms.has(gameCode), true, 'jogo morto não confirma remoção');
});

// R8: erro durante o lançamento não falha na hora; falha no prazo.
test('R8: launch com jogo fora do ar observa launching e falha no prazo', async (t) => {
  const { hub, port } = await startTestHub({
    // Health forçada online, mas state/close recusam (porta 1): o launch
    // precisa tolerar o erro até o prazo, não falhar na hora.
    ports: {},
    probe: async () => true,
    timings: { launchTimeout: 150, launchPollInterval: 10, stateTimeout: 50 },
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
  });
  const a = await connectClient(port);
  clients.push(a);
  await a.hello({ nick: 'Alice' });
  const b = await connectClient(port);
  clients.push(b);
  await b.hello({ nick: 'Bob' });
  a.send({ t: 'create_room', gameId: 'arcade', capacity: 6 });
  await waitForRoom(a, 'lobby');
  const created = a.messages.filter((m) => m.t === 'room').at(-1);
  b.send({ t: 'join_room', code: created.room.code });
  await waitForRoom(b, 'lobby');
  a.send({ t: 'set_ready', ready: true });
  b.send({ t: 'set_ready', ready: true });
  await waitForRoom(a, 'launching');
  assert.equal(a.messages.some((message) => message.t === 'play'), false);
  const failure = await a.next(
    (message) => message.t === 'error' && message.code === 'LAUNCH_FAILED',
    3000,
  );
  assert.equal(failure.code, 'LAUNCH_FAILED');
  await waitForRoom(a, 'lobby');
});
