// VAVA — votação de mapa (Campo x Cidade) antes da partida: maioria vence,
// empate sorteia, abstenção ignora, todos jogam no mesmo mapa congelado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CITY_OBSTACLES, PLAYER, pointBlockedByObstacle } from '@vava/shared';
import type { ServerMessage, Snapshot } from '@vava/shared';
import { Room } from '../src/room.js';

const noop = { send(): void {} };

function captureClient(inbox: ServerMessage[]) {
  return { send(message: ServerMessage): void { inbox.push(message); } };
}

function setupRoom() {
  const room = new Room('VOTO');
  const inboxA: ServerMessage[] = [];
  const inboxB: ServerMessage[] = [];
  const a = room.addPlayer(captureClient(inboxA), 'A');
  const b = room.addPlayer(captureClient(inboxB), 'B');
  assert.ok(a && b);
  room.update(); // waiting: inicia a votação
  assert.equal(room.phase, 'waiting');
  return { room, a, b, inboxA, inboxB };
}

function lastSnapshot(inbox: ServerMessage[]): Snapshot | null {
  for (let i = inbox.length - 1; i >= 0; i -= 1) {
    const message = inbox[i];
    if (message && message.t === 'snapshot') return message.snap;
  }
  return null;
}

function snapshotsOf(inbox: ServerMessage[]): Snapshot[] {
  return inbox.filter((m) => m.t === 'snapshot').map((m) => (m as { snap: Snapshot }).snap);
}

test('votação aparece no snapshot e maioria vence (cidade)', () => {
  const { room, a, b, inboxA } = setupRoom();
  for (let i = 0; i < 5; i += 1) room.update(); // garante um broadcast (a cada 3 ticks)
  const voting = lastSnapshot(inboxA);
  assert.ok(voting?.mapVote, 'snapshot sem mapVote durante a votação');
  assert.equal(voting.mapVote.total, 2);

  room.handleVoteMap(a.id, 'city');
  room.handleVoteMap(b.id, 'city');
  room.update(); // todos votaram: resolve na hora
  assert.equal(room.phase, 'playing');
  assert.equal(room.mapId, 'city');
});

test('maioria campo vence; voto inválido é ignorado', () => {
  const { room, a, b } = setupRoom();
  room.handleVoteMap(a.id, 'field');
  room.handleVoteMap(b.id, 'deserto'); // inválido
  room.handleVoteMap('p_fantasma', 'city'); // estranho
  room.update();
  assert.equal(room.phase, 'waiting', 'voto inválido não conta como voto');
  room.handleVoteMap(b.id, 'field');
  room.update();
  assert.equal(room.phase, 'playing');
  assert.equal(room.mapId, 'field');
});

test('abstenção: um voto decide; timer expira e resolve', () => {
  const { room, a } = setupRoom();
  room.handleVoteMap(a.id, 'city');
  for (let i = 0; i < 60 * 11; i += 1) room.update(); // ~11s > 10s do timer
  assert.equal(room.phase, 'playing');
  assert.equal(room.mapId, 'city');
});

test('empate sorteia entre os dois mapas', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 30; i += 1) {
    const { room, a, b } = setupRoom();
    room.handleVoteMap(a.id, 'city');
    room.handleVoteMap(b.id, 'field');
    room.update();
    assert.equal(room.phase, 'playing');
    seen.add(room.mapId);
  }
  assert.ok(seen.has('city') && seen.has('field'), `sorteio viciado: ${[...seen]}`);
});

test('todos os clientes recebem o mesmo mapa congelado', () => {
  const { room, a, b, inboxA, inboxB } = setupRoom();
  room.handleVoteMap(a.id, 'city');
  room.handleVoteMap(b.id, 'city');
  room.update();
  for (let i = 0; i < 10; i += 1) room.update();
  const snapsA = snapshotsOf(inboxA);
  const snapsB = snapshotsOf(inboxB);
  assert.ok(snapsA.length > 0 && snapsB.length > 0);
  for (const snap of [...snapsA, ...snapsB]) {
    assert.equal(snap.mapId, 'city');
    assert.equal(snap.mapId, room.mapId);
  }
  // Mapa congelado: voto no meio da partida é ignorado.
  room.handleVoteMap(a.id, 'field');
  room.update();
  assert.equal(room.mapId, 'city');
});

test('cidade: spawns da partida válidos (sem colisão)', () => {
  const { room, a, b } = setupRoom();
  room.handleVoteMap(a.id, 'city');
  room.handleVoteMap(b.id, 'city');
  room.update();
  assert.equal(room.mapId, 'city');
  const players = (room as unknown as { players: Map<string, { physics: { x: number; y: number } }> }).players;
  assert.equal(players.size, 2);
  for (const player of players.values()) {
    assert.ok(
      !pointBlockedByObstacle(player.physics.x, player.physics.y, PLAYER.radius, CITY_OBSTACLES),
      `spawn travado em ${player.physics.x},${player.physics.y}`,
    );
  }
});

test('revanche vota o mapa de novo', () => {
  const { room, a, b, inboxA } = setupRoom();
  room.handleVoteMap(a.id, 'field');
  room.handleVoteMap(b.id, 'field');
  room.update();
  assert.equal(room.mapId, 'field');
  room.forceEnd();
  assert.equal(room.phase, 'ended');
  for (let i = 0; i < 60 * 9; i += 1) room.update(); // intermission 8s
  assert.equal(room.phase, 'waiting');
  room.update();
  const voting = lastSnapshot(inboxA);
  assert.ok(voting?.mapVote, 'revanche sem nova votação');
  room.handleVoteMap(a.id, 'city');
  room.handleVoteMap(b.id, 'city');
  room.update();
  assert.equal(room.phase, 'playing');
  assert.equal(room.mapId, 'city');
});
