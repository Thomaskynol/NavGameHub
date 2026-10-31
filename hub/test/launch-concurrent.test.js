import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import {
  connectClient,
  startFakeGame,
  startTestHub,
  waitForCondition,
  waitForPlay,
  waitForRoom,
} from './helpers.mjs';

// R2: dois lançamentos simultâneos que geram o MESMO candidato precisam
// terminar com códigos distintos (reserva síncrona + mutex por jogo).
// randomInt é forçado: 6 primeiras chamadas → 'C', seguintes → 'D'.
test('R2: lançamentos simultâneos com mesmo candidato ficam isolados', async (t) => {
  const arcade = await startFakeGame({ id: 'arcade' });
  const { hub, port } = await startTestHub({ ports: { arcade: arcade.port } });
  const clients = [];
  const originalRandomInt = crypto.randomInt;
  t.after(async () => {
    crypto.randomInt = originalRandomInt;
    syncBuiltinESMExports();
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

  async function makeReadyPair(nickA, nickB) {
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
    return { a, b, roomCode: room.room.code };
  }

  const first = await makeReadyPair('Alice', 'Bob');
  const second = await makeReadyPair('Carol', 'Dave');

  let calls = 0;
  crypto.randomInt = () => {
    calls += 1;
    return calls <= 6 ? 2 : 3;
  };
  syncBuiltinESMExports();
  let plays;
  try {
    first.a.send({ t: 'set_ready', ready: true });
    first.b.send({ t: 'set_ready', ready: true });
    second.a.send({ t: 'set_ready', ready: true });
    second.b.send({ t: 'set_ready', ready: true });
    plays = await Promise.all([
      waitForPlay(first.a, 1, 3000),
      waitForPlay(second.a, 1, 3000),
    ]);
  } finally {
    crypto.randomInt = originalRandomInt;
    syncBuiltinESMExports();
  }

  const gameCodeA = new URL(plays[0].url).searchParams.get('room');
  const gameCodeB = new URL(plays[1].url).searchParams.get('room');
  const htokA = new URL(plays[0].url).searchParams.get('htok');
  const htokB = new URL(plays[1].url).searchParams.get('htok');
  assert.equal(gameCodeA, 'CCCCCC');
  assert.equal(gameCodeB, 'DDDDDD');
  assert.notStrictEqual(gameCodeA, gameCodeB);
  assert.ok(htokA && htokA.length >= 16);
  assert.ok(htokB && htokB.length >= 16);
  assert.notStrictEqual(htokA, htokB);

  // Duas salas reais isoladas após o fix.
  arcade.createRoom(gameCodeA, { phase: 'lobby', players: 2, capacity: 2, joinable: false });
  arcade.createRoom(gameCodeB, { phase: 'lobby', players: 2, capacity: 2, joinable: false });
  await waitForPlay(first.b, 0);
  await waitForPlay(second.b, 0);
  await waitForRoom(first.a, 'playing');
  await waitForRoom(second.a, 'playing');
  const snapshot = hub.snapshot();
  assert.equal(snapshot.rooms.length, 2);
  const byCode = new Map(snapshot.rooms.map((room) => [room.code, room]));
  assert.equal(byCode.get(first.roomCode).match.gameCode, gameCodeA);
  assert.equal(byCode.get(second.roomCode).match.gameCode, gameCodeB);

  // Cada partida recebe seu próprio close com o htok do launch.
  arcade.setRoom(gameCodeA, { phase: 'results' });
  arcade.setRoom(gameCodeB, { phase: 'results' });
  for (const gameCode of [gameCodeA, gameCodeB]) {
    await waitForCondition(() => arcade.requests.some(
      (request) => request.method === 'POST'
        && request.path === '/__hub/close'
        && request.room === gameCode,
    ));
  }
  const closes = arcade.requests.filter(
    (request) => request.method === 'POST' && request.path === '/__hub/close',
  );
  const byRoom = new Map(closes.map((request) => [request.room, request.htok]));
  assert.equal(byRoom.get(gameCodeA), htokA);
  assert.equal(byRoom.get(gameCodeB), htokB);
});
