import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectClient,
  startFakeGame,
  startTestHub,
  waitForPlay,
  waitForRoom,
} from './helpers.mjs';

// Identidade da partida (contrato htok): o Hub só trata como própria a sala
// do jogo cuja resposta contém `hubOwner === htok` do launch. Resposta sem o
// campo obrigatório NÃO é aceita silenciosamente: é CONFLITO (novo código,
// sem enviar demais jogadores para lá; esgotado o limite, LAUNCH_CONFLICT
// com sala recuperável). Modo independente dos jogos fora do Hub preservado
// (sem htok, regras legadas no jogo).

async function setup(t, timings = {}) {
  const fake = await startFakeGame({ id: 'arcade' });
  const { hub, port } = await startTestHub({
    ports: { arcade: fake.port },
    timings: { launchTimeout: 5000, ...timings },
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

async function readyPair({ port, clients }, nickA = 'Alice', nickB = 'Bob') {
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
  await waitForRoom(a, 'launching');
  return { a, b, roomCode: room.room.code };
}

function playInfo(message) {
  const url = new URL(message.url);
  return {
    create: url.searchParams.get('create'),
    room: url.searchParams.get('room'),
    htok: url.searchParams.get('htok'),
  };
}

test('campo hubOwner ausente NÃO é tratado como próprio (conflito, sem play para sala alheia)', async (t) => {
  const { hub, port, fake, clients } = await setup(t);
  const { a, b } = await readyPair({ port, clients });

  const first = await waitForPlay(a, 1);
  const taken = playInfo(first).room;
  const htok = playInfo(first).htok;
  assert.ok(htok);

  // Jogo legado/incompatível: state SEM o campo obrigatório.
  fake.createRoom(taken, {
    phase: 'lobby', players: 2, capacity: 2, joinable: false,
  });
  delete fake.rooms.get(taken).hubOwner;
  assert.equal('hubOwner' in fake.rooms.get(taken), false);

  // Esperado: conflito — novo código com o MESMO htok, sem enviar join à sala alheia.
  const second = await waitForPlay(a, 1, 4000);
  const next = playInfo(second);
  assert.notStrictEqual(next.room, taken);
  assert.equal(next.htok, htok);

  // Completa o launch no código novo (com dono correto) e vai para playing.
  fake.createRoom(next.room, {
    phase: 'lobby', players: 2, capacity: 2, joinable: false, hubOwner: htok,
  });
  const joinB = await waitForPlay(b, 0);
  assert.equal(playInfo(joinB).room, next.room);
  await waitForRoom(a, 'playing');
  assert.equal(hub.snapshot().rooms[0].match.gameCode, next.room);

  // Nenhum join (create=0) apontou para a sala sem identidade; sem close destrutivo.
  // (O primeiro create=1 apontou para `taken` antes da ocupação estrangeira —
  // é a tentativa legítima que no jogo real receberia CODE_TAKEN.)
  for (const m of [...a.messages, ...b.messages]) {
    if (m.t !== 'play') continue;
    if (playInfo(m).create === '0') assert.notStrictEqual(playInfo(m).room, taken);
  }
  assert.equal(
    fake.requests.filter((r) => r.method === 'POST' && r.path === '/__hub/close' && r.room === taken).length,
    0,
  );
});

test('hubOwner null explícito é conflito (não é minha)', async (t) => {
  const { hub, port, fake, clients } = await setup(t);
  const { a, b } = await readyPair({ port, clients });

  const first = await waitForPlay(a, 1);
  const taken = playInfo(first).room;
  const htok = playInfo(first).htok;
  fake.createRoom(taken, {
    phase: 'lobby', players: 2, capacity: 2, joinable: false, hubOwner: null,
  });

  const second = await waitForPlay(a, 1, 4000);
  const next = playInfo(second);
  assert.notStrictEqual(next.room, taken);
  assert.equal(next.htok, htok);

  fake.createRoom(next.room, {
    phase: 'lobby', players: 2, capacity: 2, joinable: false, hubOwner: htok,
  });
  await waitForPlay(b, 0);
  await waitForRoom(a, 'playing');
  assert.equal(hub.snapshot().rooms[0].match.gameCode, next.room);
});

test('dono divergente é conflito (nunca adota a sala alheia)', async (t) => {
  const { hub, port, fake, clients } = await setup(t);
  const { a, b } = await readyPair({ port, clients });

  const first = await waitForPlay(a, 1);
  const taken = playInfo(first).room;
  const htok = playInfo(first).htok;
  fake.createRoom(taken, {
    phase: 'lobby', players: 2, capacity: 2, joinable: false, hubOwner: 'tok-de-outra-partida',
  });

  const second = await waitForPlay(a, 1, 4000);
  const next = playInfo(second);
  assert.notStrictEqual(next.room, taken);
  assert.equal(next.htok, htok);
  assert.equal(fake.rooms.get(taken).hubOwner, 'tok-de-outra-partida');

  fake.createRoom(next.room, {
    phase: 'lobby', players: 2, capacity: 2, joinable: false, hubOwner: htok,
  });
  await waitForPlay(b, 0);
  await waitForRoom(a, 'playing');
});

test('dono correto vai para playing (identidade comprovada antes dos demais)', async (t) => {
  const { hub, port, fake, clients } = await setup(t);
  const { a, b } = await readyPair({ port, clients });

  const first = await waitForPlay(a, 1);
  const gameCode = playInfo(first).room;
  const htok = playInfo(first).htok;
  fake.createRoom(gameCode, {
    phase: 'lobby', players: 2, capacity: 2, joinable: false, hubOwner: htok,
  });

  const joinB = await waitForPlay(b, 0);
  assert.equal(playInfo(joinB).room, gameCode);
  await waitForRoom(a, 'playing');
  await waitForRoom(b, 'playing');
  assert.equal(hub.snapshot().rooms[0].match.gameCode, gameCode);
});

test('erro de comunicação transitório não encerra; persistente falha com sala recuperável', async (t) => {
  const { hub, port, fake, clients } = await setup(t, { launchTimeout: 600, launchPollInterval: 20 });
  const { a } = await readyPair({ port, clients });

  const first = await waitForPlay(a, 1);
  const gameCode = playInfo(first).room;
  const htok = playInfo(first).htok;

  // 2 falhas transitórias, depois a sala aparece com o dono correto.
  fake.setFailState(2);
  setTimeout(() => {
    fake.createRoom(gameCode, {
      phase: 'lobby', players: 2, capacity: 2, joinable: false, hubOwner: htok,
    });
  }, 60);
  await waitForRoom(a, 'playing', 5000);
  assert.equal(hub.snapshot().rooms[0].match.gameCode, gameCode);
});
