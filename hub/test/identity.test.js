import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectClient,
  startFakeGame,
  startTestHub,
  waitForCondition,
  waitForRoom,
} from './helpers.mjs';

test('identidade: normalização NFKC, unicidade e reconexão com token', async (t) => {
  const arcade = await startFakeGame({ id: 'arcade' });
  const { hub, port } = await startTestHub({ ports: { arcade: arcade.port } });
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
  const helloA = await a.hello({ nick: '  Alice   Smith  ' });
  assert.equal(helloA.t, 'hello_ok');
  assert.equal(helloA.you.nick, 'Alice Smith');
  assert.match(helloA.token, /^[0-9a-f]{64}$/);

  const catalog = await a.next((message) => message.t === 'catalog');
  assert.equal(catalog.games.length, 4);
  assert.ok(catalog.games.some((game) => game.id === 'arcade'));
  assert.deepEqual(catalog.rooms, []);

  const b = await connectClient(port);
  clients.push(b);
  const taken = await b.hello({ nick: 'alice smith' });
  assert.equal(taken.t, 'error');
  assert.equal(taken.code, 'NICK_TAKEN');

  const takenFullwidth = await b.hello({ nick: 'ＡＬＩＣＥ ＳＭＩＴＨ' });
  assert.equal(takenFullwidth.code, 'NICK_TAKEN');

  const badShort = await b.hello({ nick: 'a' });
  assert.equal(badShort.code, 'BAD_NICK');

  const badChars = await b.hello({ nick: 'bad!' });
  assert.equal(badChars.code, 'BAD_NICK');

  const helloB = await b.hello({ nick: 'Bob' });
  assert.equal(helloB.t, 'hello_ok');

  a.send({ t: 'create_room', gameId: 'arcade', capacity: 6 });
  const roomA = await waitForRoom(a, 'lobby');
  assert.equal(roomA.room.hostId, helloA.you.id);
  assert.equal(roomA.room.members.length, 1);

  b.send({ t: 'join_room', code: roomA.room.code.toLowerCase() });
  const roomB = await waitForRoom(b, 'lobby');
  assert.equal(roomB.room.members.length, 2);
  assert.equal(roomB.room.hostId, helloA.you.id);

  // A reconecta com o token: a conexão mais recente vence.
  const a2 = await connectClient(port);
  clients.push(a2);
  const helloA2 = await a2.hello({ token: helloA.token });
  assert.equal(helloA2.t, 'hello_ok');
  assert.equal(helloA2.you.id, helloA.you.id);
  assert.equal(helloA2.you.nick, 'Alice Smith');
  assert.equal(helloA2.room.code, roomA.room.code);

  const oldClose = await a.closed;
  assert.equal(oldClose.code, 4001);

  const snapshot = hub.snapshot();
  const alice = snapshot.players.filter((player) => player.nick === 'Alice Smith');
  assert.equal(alice.length, 1);
  assert.equal(alice[0].connected, true);

  const reconnectedView = await b.next(
    (message) => message.t === 'room'
      && message.room.members.find((member) => member.nick === 'Alice Smith')?.connected === true,
  );
  assert.ok(reconnectedView);

  a2.send({ t: 'ping', ts: 123 });
  const pong = await a2.next((message) => message.t === 'pong');
  assert.equal(pong.ts, 123);
});

test('identidade: need_nick e liberação após o prazo de queda', async (t) => {
  const arcade = await startFakeGame({ id: 'arcade' });
  const { hub, port } = await startTestHub({
    ports: { arcade: arcade.port },
    timings: { disconnectGrace: 500 },
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

  const anonymous = await connectClient(port);
  clients.push(anonymous);
  const needNick = await anonymous.hello({});
  assert.equal(needNick.t, 'need_nick');
  const helloAnon = await anonymous.hello({ nick: 'Anon' });
  assert.equal(helloAnon.t, 'hello_ok');

  const a = await connectClient(port);
  clients.push(a);
  const helloA = await a.hello({ nick: 'Alice' });
  const b = await connectClient(port);
  clients.push(b);
  const helloB = await b.hello({ nick: 'Bob' });

  a.send({ t: 'create_room', gameId: 'arcade', capacity: 6 });
  const room = await waitForRoom(a, 'lobby');
  b.send({ t: 'join_room', code: room.room.code });
  await waitForRoom(b, 'lobby');

  await b.close();
  await waitForCondition(
    () => hub.snapshot().rooms[0].members.find((member) => member.nick === 'Bob')?.connected === false,
  );

  // Dentro do prazo, o token reata a mesma identidade e a mesma vaga.
  const b2 = await connectClient(port);
  clients.push(b2);
  const reconnected = await b2.hello({ token: helloB.token });
  assert.equal(reconnected.t, 'hello_ok');
  assert.equal(reconnected.you.id, helloB.you.id);
  assert.equal(reconnected.room.code, room.room.code);
  await waitForCondition(
    () => hub.snapshot().rooms[0].members.find((member) => member.nick === 'Bob')?.connected === true,
  );

  // Depois do prazo, identidade e vaga são liberadas.
  await b2.close();
  await waitForCondition(
    () => !hub.snapshot().players.some((player) => player.nick === 'Bob'),
    1_000,
  );
  assert.equal(hub.snapshot().rooms[0].members.length, 1);

  const b3 = await connectClient(port);
  clients.push(b3);
  const helloB3 = await b3.hello({ nick: 'Bob' });
  assert.equal(helloB3.t, 'hello_ok');
  b3.send({ t: 'join_room', code: room.room.code });
  await waitForRoom(b3, 'lobby');

  // Ao expirar a queda do anfitrião, o restante mais antigo assume.
  await a.close();
  await waitForCondition(
    () => hub.snapshot().rooms[0]?.hostId === helloB3.you.id,
    1_000,
  );

  b3.send({ t: 'leave_room' });
  const left = await b3.next((message) => message.t === 'left');
  assert.equal(left.t, 'left');
  await waitForCondition(() => hub.snapshot().rooms.length === 0);
});
