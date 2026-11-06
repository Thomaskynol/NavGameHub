// VAVA R3+R4 — regressão (TDD: RED antes do fix, GREEN depois).
// R3: entrante em cardSelection participa (opções + tempo) e ninguém volta sem carta.
// R4: preditor usa a mesma velocidade efetiva do servidor (arma × speedBoost × giant).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOVE,
  PLAYER,
  TICK_DT,
  WEAPONS,
  pointBlockedByObstacle,
  obstaclesFor,
} from '@vava/shared';
import type {
  MapId,
  PlayerInput,
  ServerMessage,
  Snapshot,
} from '@vava/shared';
import { Room } from '../src/room.js';
import { Predictor } from '../../client/src/predictor.js';

const DT = TICK_DT;

function captureClient(inbox: ServerMessage[]) {
  return { send(message: ServerMessage): void { inbox.push(message); } };
}

function cardSelectionOf(inbox: ServerMessage[]) {
  return inbox.filter((m) => m.t === 'cardSelection') as { t: 'cardSelection'; cards: string[]; seconds: number }[];
}

function lastSnapshot(inbox: ServerMessage[]): Snapshot | null {
  for (let i = inbox.length - 1; i >= 0; i -= 1) {
    const message = inbox[i];
    if (message && message.t === 'snapshot') return (message as { snap: Snapshot }).snap;
  }
  return null;
}

function playersOf(room: Room): Map<string, any> {
  return (room as unknown as { players: Map<string, any> }).players;
}

/** Sala real com 2 jogadores em playing (voto + beginMatch pelo caminho real). */
function playingRoom(code: string, map: MapId = 'field') {
  const room = new Room(code);
  const inboxes = new Map<string, ServerMessage[]>();
  const mk = (name: string) => {
    const inbox: ServerMessage[] = [];
    const player = room.addPlayer(captureClient(inbox), name)!;
    assert.ok(player, 'sala cheia antes da hora');
    inboxes.set(player.id, inbox);
    return player;
  };
  const a = mk('A');
  const b = mk('B');
  room.update(); // waiting: inicia a votação
  room.handleVoteMap(a.id, map);
  room.handleVoteMap(b.id, map);
  room.update(); // resolve: playing
  assert.equal(room.phase, 'playing');
  assert.equal(room.mapId, map);
  return { room, a, b, inboxes };
}

/** Avança pelo caminho real até a escolha de cartas (cardRoundTimer de 60s).
 *  +2 ticks de folga: o decremento repetido de 1/60 deixa resíduo float e o
 *  limiar só cai no tick 3601. */
function toCardSelection(room: Room) {
  for (let i = 0; i < 60 * 60 + 120 && room.phase !== 'cardSelection'; i += 1) {
    room.update(DT);
  }
  assert.equal(room.phase, 'cardSelection');
}

function addNamed(room: Room, name: string) {
  const inbox: ServerMessage[] = [];
  const player = room.addPlayer(captureClient(inbox), name)!;
  assert.ok(player, `${name} recusado (sala cheia?)`);
  return { player, inbox };
}

function chooseFirst(room: Room, player: { id: string }) {
  const record = playersOf(room).get(player.id);
  assert.ok(record.pendingCardOptions.length > 0, `${record.name} sem opções`);
  room.handleChooseCard(player.id, record.pendingCardOptions[0]);
}

// Ponto livre no mapa para medir paridade de movimento sem parede no caminho.
function freeSpot(map: MapId): { x: number; y: number } {
  const obstacles = obstaclesFor(map);
  const candidates = [
    { x: 200, y: 200 }, { x: 1200, y: 200 }, { x: 2200, y: 200 },
    { x: 200, y: 1400 }, { x: 1200, y: 1400 }, { x: 2200, y: 1400 },
  ];
  for (const spot of candidates) {
    if (!pointBlockedByObstacle(spot.x, spot.y, PLAYER.radius + 45, obstacles)) return spot;
  }
  throw new Error(`sem ponto livre em ${map}`);
}

/** Direção cardeal com o maior trecho livre a partir do ponto (passo 10u). */
function bestRun(map: MapId, spot: { x: number; y: number }): { move: number; length: number } {
  const obstacles = obstaclesFor(map);
  const dirs = [
    { move: MOVE.right, dx: 1, dy: 0 },
    { move: MOVE.left, dx: -1, dy: 0 },
    { move: MOVE.down, dx: 0, dy: 1 },
    { move: MOVE.up, dx: 0, dy: -1 },
  ];
  let best: { move: number; length: number } = { move: MOVE.right, length: 0 };
  for (const dir of dirs) {
    let length = 0;
    for (let d = 10; d <= 600; d += 10) {
      if (pointBlockedByObstacle(spot.x + dir.dx * d, spot.y + dir.dy * d, PLAYER.radius + 5, obstacles)) break;
      length = d;
    }
    if (length > best.length) best = { move: dir.move, length };
  }
  return best;
}

/** Paridade servidor×preditor em N inputs idênticos.
 *  Retorna { divergence, travel }: travel prova que o teste andou de verdade
 *  (sem parede mascarando divergência com os dois lados parados). */
function parityDivergence(
  room: Room,
  player: { id: string },
  inbox: ServerMessage[],
  opts: { ticks: number; move: number; syncEvery?: number; syncLast?: boolean; syncAt?: number },
): { divergence: number; travel: number } {
  const record = playersOf(room).get(player.id);
  const startX = record.physics.x;
  const startY = record.physics.y;
  (room as unknown as { sendSnapshotTo(p: unknown): void }).sendSnapshotTo(record);
  const start = lastSnapshot(inbox);
  assert.ok(start, 'sem snapshot inicial');
  const pred = new Predictor();
  pred.setMap(room.mapId);
  pred.applyServerState(start.you);
  let seq = 0;
  for (let i = 0; i < opts.ticks; i += 1) {
    const input: PlayerInput = {
      seq: (seq += 1),
      move: opts.move,
      aim: 0,
      shoot: false,
      reload: false,
      dash: false,
      grenade: false,
    };
    room.handleInput(player.id, input);
    room.update(DT);
    pred.step(input);
    const isSyncTick = opts.syncAt === i + 1
      || (opts.syncEvery && (i + 1) % opts.syncEvery === 0);
    if (isSyncTick && (opts.syncLast || i + 1 < opts.ticks)) {
      // Reconciliação como o jogo real: snapshot periódico + replay de pendentes.
      (room as unknown as { sendSnapshotTo(p: unknown): void }).sendSnapshotTo(record);
      const snap = lastSnapshot(inbox);
      assert.ok(snap, 'sem snapshot na reconciliação');
      pred.applyServerState(snap.you);
    }
  }
  const end = pred.state;
  assert.ok(end, 'preditor sem estado');
  return {
    divergence: Math.hypot(record.physics.x - end.x, record.physics.y - end.y),
    travel: Math.hypot(record.physics.x - startX, record.physics.y - startY),
  };
}

function placeForParity(room: Room, player: { id: string }, needRun = 380) {
  const record = playersOf(room).get(player.id);
  const spot = freeSpot(room.mapId);
  const run = bestRun(room.mapId, spot);
  assert.ok(run.length >= needRun, `teste desonesto: sem corredor de ${needRun}u no ${room.mapId} (melhor: ${run.length}u)`);
  record.physics.x = spot.x;
  record.physics.y = spot.y;
  record.physics.vx = 0;
  record.physics.vy = 0;
  return { record, move: run.move };
}

// ---------------- R3 ----------------

test('R3: entrante em cardSelection recebe opções + tempo restante', () => {
  const { room } = playingRoom('R3-OPTS');
  toCardSelection(room);
  const { player, inbox } = addNamed(room, 'C');
  const record = playersOf(room).get(player.id);
  assert.equal(record.pendingCardOptions.length, 3, 'entrante sem 3 opções');
  const messages = cardSelectionOf(inbox);
  assert.equal(messages.length, 1, 'entrante sem mensagem cardSelection');
  assert.equal(messages[0]!.cards.length, 3);
  assert.ok(messages[0]!.seconds > 0 && messages[0]!.seconds <= 10, `tempo restante absurdo: ${messages[0]!.seconds}`);
});

test('R3: fim antecipado quando todos (incluindo o entrante) escolhem', () => {
  const { room, a, b } = playingRoom('R3-EARLY');
  toCardSelection(room);
  const { player: c } = addNamed(room, 'C');
  chooseFirst(room, a);
  chooseFirst(room, b);
  assert.equal(room.phase, 'cardSelection', 'terminou sem o entrante escolher');
  chooseFirst(room, c);
  assert.equal(room.phase, 'playing', 'travou mesmo com todos escolhendo');
});

test('R3: timeout dá carta a quem ficou mudo (ninguém volta sem carta)', () => {
  const { room, a, b } = playingRoom('R3-TIMEOUT');
  toCardSelection(room);
  const { player: c } = addNamed(room, 'C');
  chooseFirst(room, a);
  chooseFirst(room, b);
  // C fica mudo: timeout de 10s decide por ele.
  for (let i = 0; i < 10 * 60 + 5; i += 1) room.update(DT);
  assert.equal(room.phase, 'playing');
  for (const p of playersOf(room).values()) {
    assert.equal(p.cards.length, 1, `${p.name} voltou sem carta`);
  }
  assert.ok(c);
});

test('R3: saída durante a escolha não trava o fim antecipado', () => {
  const { room, a, b } = playingRoom('R3-LEAVE');
  toCardSelection(room);
  chooseFirst(room, a);
  room.removePlayer(b.id);
  // Só A resta e já escolheu: não pode esperar o timeout de um fantasma.
  assert.equal(room.phase, 'playing');
});

test('R3: 3 entrantes simultâneos participam e o fim antecipado funciona', () => {
  const { room, a, b } = playingRoom('R3-BURST');
  toCardSelection(room);
  const late = [addNamed(room, 'C'), addNamed(room, 'D'), addNamed(room, 'E')];
  for (const { player, inbox } of late) {
    assert.equal(cardSelectionOf(inbox).length, 1, 'entrante sem opções');
    assert.ok(playersOf(room).get(player.id).pendingCardOptions.length > 0);
  }
  chooseFirst(room, a);
  chooseFirst(room, b);
  for (const { player } of late) chooseFirst(room, player);
  assert.equal(room.phase, 'playing');
  for (let i = 0; i < 5; i += 1) room.update(DT);
  for (const p of playersOf(room).values()) {
    assert.equal(p.cards.length, 1, `${p.name} voltou sem carta`);
  }
});

// NÃO cobre a validação htok da camada Hub — só o vínculo hubOwner já estabelecido na sala.
test('R3: entrada com vínculo Hub na sala em cardSelection também recebe opções', () => {
  const { room } = playingRoom('R3-HUB');
  room.hubOwner = 'htok-dono';
  toCardSelection(room);
  const { inbox } = addNamed(room, 'ViaHub');
  assert.equal(cardSelectionOf(inbox).length, 1, 'jogador do Hub sem opções');
});

// ---------------- R4 ----------------

for (const map of ['field', 'city'] as const) {
  test(`R4: paridade c/ speedBoost no mapa ${map} (60 inputs idênticos)`, () => {
    const { room, a, inboxes } = playingRoom(`R4-BOOST-${map}`, map);
    const { record, move } = placeForParity(room, a);
    record.speedBoost = 5;
    const { divergence, travel } = parityDivergence(room, a, inboxes.get(a.id)!, { ticks: 60, move });
    assert.ok(travel > 100, `teste desonesto no ${map}: andou só ${travel.toFixed(1)} unid`);
    assert.ok(divergence < 2, `divergência ${divergence.toFixed(1)} unid no ${map} (bug ~102)`);
  });
}

test('R4: paridade c/ giant (0.9x) e combinação boost+giant (1.5x·0.9x)', () => {
  for (const setup of [
    { boost: 0, giant: 15, label: 'giant' },
    { boost: 5, giant: 15, label: 'boost+giant' },
  ] as const) {
    const { room, a, inboxes } = playingRoom(`R4-GIANT-${setup.label}`);
    const { record, move } = placeForParity(room, a);
    record.speedBoost = setup.boost;
    record.giant = setup.giant;
    const { divergence, travel } = parityDivergence(room, a, inboxes.get(a.id)!, { ticks: 60, move });
    assert.ok(travel > 100, `teste desonesto (${setup.label}): andou só ${travel.toFixed(1)} unid`);
    assert.ok(divergence < 2, `divergência ${divergence.toFixed(1)} unid (${setup.label})`);
  }
});

test('R4: paridade na troca de arma (minigun 150) com speedBoost', () => {
  const { room, a, inboxes } = playingRoom('R4-WEAPON');
  const { record, move } = placeForParity(room, a);
  record.weapon = 'minigun';
  record.speedBoost = 5;
  const expected = (WEAPONS as any).minigun.speed * 1.5;
  assert.equal(expected, 225);
  const { divergence, travel } = parityDivergence(room, a, inboxes.get(a.id)!, {
    ticks: 60,
    move,
  });
  assert.ok(travel > 100, `teste desonesto (minigun): andou só ${travel.toFixed(1)} unid`);
  assert.ok(divergence < 2, `divergência ${divergence.toFixed(1)} unid (minigun+boost)`);
});

test('R4: mesma velocidade em 1 tick após cruzeiro — matriz arma×boost×giant×mapa', () => {
  for (const map of ['field', 'city'] as const) {
    for (const weapon of ['pistol', 'minigun'] as const) {
      for (const boost of [5, 0]) {
        for (const giant of [15, 0]) {
          const { room, a, inboxes } = playingRoom(`R4-1T-${map}-${weapon}-b${boost}-g${giant}`, map);
          const { record, move } = placeForParity(room, a, 260);
          record.weapon = weapon;
          record.speedBoost = boost;
          record.giant = giant;
          // Cruzeiro: 30 ticks só no servidor (parado, a rampa de aceleração
          // anda maxDelta igual dos dois lados e mascararia a velocidade-alvo).
          let seq = 0;
          const cruise: PlayerInput = {
            seq: 0, move, aim: 0, shoot: false,
            reload: false, dash: false, grenade: false,
          };
          for (let i = 0; i < 30; i += 1) {
            cruise.seq = ++seq;
            room.handleInput(a.id, { ...cruise });
            room.update(DT);
          }
          (room as unknown as { sendSnapshotTo(p: unknown): void }).sendSnapshotTo(record);
          const snap = lastSnapshot(inboxes.get(a.id)!);
          assert.ok(snap, 'sem snapshot');
          const pred = new Predictor();
          pred.setMap(map);
          pred.applyServerState(snap.you);
          const input: PlayerInput = { ...cruise, seq: ++seq };
          const before = { x: record.physics.x, y: record.physics.y };
          room.handleInput(a.id, { ...input });
          room.update(DT);
          pred.step(input);
          const serverDisp = Math.hypot(record.physics.x - before.x, record.physics.y - before.y);
          const predDisp = Math.hypot(pred.state!.x - before.x, pred.state!.y - before.y);
          assert.ok(serverDisp > 1, `teste desonesto (${map}/${weapon}/b${boost}/g${giant}): servidor parado na parede`);
          assert.ok(
            Math.abs(serverDisp - predDisp) < 0.05,
            `${map}/${weapon}/boost=${boost}/giant=${giant}: server ${serverDisp.toFixed(3)} vs pred ${predDisp.toFixed(3)}`,
          );
        }
      }
    }
  }
});

test('R4: paridade através da expiração do boost (transição 1.5x→1x)', () => {
  const { room, a, inboxes } = playingRoom('R4-EXPIRE');
  const { record, move } = placeForParity(room, a);
  record.speedBoost = 0.5; // expira no meio dos 60 ticks
  const { divergence, travel } = parityDivergence(room, a, inboxes.get(a.id)!, {
    ticks: 60,
    move,
    // Reconciliação no tick 20 (antes da expiração): exercita snapshot +
    // replay de pendentes sem mascarar a transição 1.5x→1x do tick 30.
    syncAt: 20,
  });
  assert.ok(record.speedBoost <= 0, 'boost deveria ter expirado');
  assert.ok(travel > 100, `teste desonesto (expiração): andou só ${travel.toFixed(1)} unid`);
  assert.ok(divergence < 3, `divergência ${divergence.toFixed(1)} unid na expiração`);
});

test('R4: replay com latência cruza a expiração sem skew de 1 tick', () => {
  // Com RTT há inputs pendentes (enviados, ainda não consumidos) no snapshot.
  // Se o boost expira dentro desses pendentes, o replay precisa decrementar o
  // timer por input como o servidor (1 tick de boost a mais = ~1.9 unid).
  // boost 3.5 ticks: snapshot com 2.5 ticks restando (meio-tick, sem flip de
  // round) e 5 pendentes cruzando a transição 1.5x→1x.
  const { room, a, inboxes } = playingRoom('R4-REPLAY');
  const { record, move } = placeForParity(room, a);
  record.speedBoost = 3.5 * DT;
  const inbox = inboxes.get(a.id)!;
  (room as unknown as { sendSnapshotTo(p: unknown): void }).sendSnapshotTo(record);
  let snap = lastSnapshot(inbox);
  assert.ok(snap, 'sem snapshot inicial');
  const pred = new Predictor();
  pred.setMap(room.mapId);
  pred.applyServerState(snap.you);
  const startX = record.physics.x;
  const startY = record.physics.y;
  let seq = 0;
  const mkInput = (): PlayerInput => ({
    seq: (seq += 1),
    move,
    aim: 0,
    shoot: false,
    reload: false,
    dash: false,
    grenade: false,
  });
  // Rajada de 6 (RTT): cliente previu todos localmente, servidor ainda não consumiu.
  for (let i = 0; i < 6; i += 1) {
    const input = mkInput();
    room.handleInput(a.id, input);
    pred.step(input);
  }
  room.update(DT);
  (room as unknown as { sendSnapshotTo(p: unknown): void }).sendSnapshotTo(record);
  snap = lastSnapshot(inbox);
  assert.ok(snap, 'sem snapshot na reconciliação');
  pred.applyServerState(snap.you); // replay dos 5 pendentes cruza a expiração
  for (let i = 0; i < 5; i += 1) room.update(DT);
  // Cruzeiro pós-replay: deslocamento honesto (fora da parede) sem mudar o offset.
  for (let i = 0; i < 30; i += 1) {
    const input = mkInput();
    room.handleInput(a.id, input);
    room.update(DT);
    pred.step(input);
  }
  assert.ok(record.speedBoost <= 0, 'boost deveria ter expirado');
  const travel = Math.hypot(record.physics.x - startX, record.physics.y - startY);
  const end = pred.state;
  assert.ok(end, 'preditor sem estado');
  const divergence = Math.hypot(record.physics.x - end.x, record.physics.y - end.y);
  assert.ok(travel > 100, `teste desonesto (replay): andou só ${travel.toFixed(1)} unid`);
  assert.ok(divergence < 0.5, `skew de replay: ${divergence.toFixed(2)} unid (esperado < 0.5, só round)`);
});
