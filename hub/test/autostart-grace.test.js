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

// R6: desconexão de quem não está pronto NÃO dispara autostart enquanto a
// vaga estiver na graça; reavalia após a saída/expiração.
test('R6: queda de não-pronto segura o início até expirar a graça', async (t) => {
  const fake = await startFakeGame({ id: 'arcade' });
  const { hub, port } = await startTestHub({
    ports: { arcade: fake.port },
    timings: { disconnectGrace: 200, launchTimeout: 800, launchPollInterval: 10 },
  });
  const clients = [];
  t.after(async () => {
    for (const client of clients) {
      try {
        if (client.ws.readyState !== 3) client.ws.terminate();
      } catch {
        // já encerrado
      }
      try {
        await client.close();
      } catch {
        // já encerrado
      }
    }
    await hub.close();
    await fake.close();
  });

  const names = ['ReadyA', 'ReadyB', 'NotReady'];
  for (const nick of names) {
    const client = await connectClient(port);
    clients.push(client);
    await client.hello({ nick });
  }
  const [a, b, c] = clients;
  a.send({ t: 'create_room', gameId: 'arcade', capacity: 3 });
  const room = await waitForRoom(a, 'lobby');
  b.send({ t: 'join_room', code: room.room.code });
  await waitForRoom(b, 'lobby');
  c.send({ t: 'join_room', code: room.room.code });
  await waitForRoom(c, 'lobby');
  a.send({ t: 'set_ready', ready: true });
  b.send({ t: 'set_ready', ready: true });
  await waitForCondition(() => {
    const current = hub.snapshot().rooms[0];
    return current.members.filter((m) => m.ready).length === 2 && current.phase === 'lobby';
  });

  // Queda (sem leave): a vaga segue ocupada na graça.
  c.ws.terminate();
  await delay(120);
  const held = hub.snapshot().rooms[0];
  assert.equal(held.phase, 'lobby');
  assert.equal(held.members.length, 3);
  const dropped = held.members.find((m) => m.nick === 'NotReady');
  assert.equal(dropped.ready, false);
  assert.equal(dropped.connected, false);

  // Graça expirada → vaga liberada → autostart reavaliado e dispara.
  await waitForCondition(() => hub.snapshot().rooms[0].phase === 'launching', 2000);
  const launched = hub.snapshot().rooms[0];
  assert.equal(launched.members.length, 2);
});
