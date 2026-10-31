import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectClient,
  startFakeGame,
  startTestHub,
  waitForPlay,
  waitForRoom,
} from './helpers.mjs';

// R7: portas do ambiente prevalecem sobre o manifesto (URLs, sondas, health).
test('R7: ARCADE_PORT do ambiente chega ao health e às URLs', async (t) => {
  const arcade = await startFakeGame({ id: 'arcade' });
  const previous = process.env.ARCADE_PORT;
  process.env.ARCADE_PORT = String(arcade.port);
  let hub;
  const clients = [];
  t.after(async () => {
    if (previous === undefined) delete process.env.ARCADE_PORT;
    else process.env.ARCADE_PORT = previous;
    for (const client of clients) {
      try {
        await client.close();
      } catch {
        // já encerrado
      }
    }
    if (hub) await hub.close();
    await arcade.close();
  });

  // Sem override explícito: o manifesto (porta 1, recusada) diria offline.
  // Com ARCADE_PORT, a sonda usa a porta do ambiente e o jogo fica online.
  const started = await startTestHub({ ports: {} });
  hub = started.hub;
  const client = await connectClient(started.port);
  clients.push(client);
  await client.hello({ nick: 'PortProbe' });
  const catalog = await client.next((message) => message.t === 'catalog');
  assert.equal(catalog.games.find((game) => game.id === 'arcade').status, 'online');
});

test('R7: HUB_PORT do ambiente prevalece sobre o manifesto', async (t) => {
  const arcade = await startFakeGame({ id: 'arcade' });
  const previousHub = process.env.HUB_PORT;
  const previousArcade = process.env.ARCADE_PORT;
  const { createHub } = await import('../server.js');
  const { makeManifest, SECRET: TEST_SECRET } = await import('./helpers.mjs');
  // Porta livre real: em produção o Hub escuta nela (HUB_PORT) e a anuncia.
  const { createServer } = await import('node:http');
  const holder = createServer();
  await new Promise((resolve) => holder.listen(0, '127.0.0.1', resolve));
  const hubPort = holder.address().port;
  await new Promise((resolve) => holder.close(resolve));
  process.env.HUB_PORT = String(hubPort);
  process.env.ARCADE_PORT = String(arcade.port);
  let hub;
  const clients = [];
  t.after(async () => {
    if (previousHub === undefined) delete process.env.HUB_PORT;
    else process.env.HUB_PORT = previousHub;
    if (previousArcade === undefined) delete process.env.ARCADE_PORT;
    else process.env.ARCADE_PORT = previousArcade;
    for (const client of clients) {
      try {
        await client.close();
      } catch {
        // já encerrado
      }
    }
    if (hub) await hub.close();
    await arcade.close();
  });

  // Manifesto com hubPort propositalmente errado: o ambiente vence.
  const manifest = makeManifest({});
  manifest.hubPort = 9999;
  hub = createHub({
    manifest,
    secret: TEST_SECRET,
    log: () => {},
    timings: {
      disconnectGrace: 80, launchPollInterval: 10, launchTimeout: 400,
      playPollInterval: 15, healthInterval: 60000, stateTimeout: 250,
    },
  });
  await hub.listen(hubPort, '127.0.0.1');
  const a = await connectClient(hubPort);
  clients.push(a);
  await a.hello({ nick: 'Alice' });
  const b = await connectClient(hubPort);
  clients.push(b);
  await b.hello({ nick: 'Bob' });
  a.send({ t: 'create_room', gameId: 'arcade', capacity: 6 });
  const created = await waitForRoom(a, 'lobby');
  b.send({ t: 'join_room', code: created.room.code });
  await waitForRoom(b, 'lobby');
  a.send({ t: 'set_ready', ready: true });
  b.send({ t: 'set_ready', ready: true });
  const play = await waitForPlay(a, 1);
  const hubUrl = new URL(new URL(play.url).searchParams.get('hubUrl'));
  assert.equal(hubUrl.port, String(hubPort));
  assert.notEqual(hubUrl.port, '9999');
});
