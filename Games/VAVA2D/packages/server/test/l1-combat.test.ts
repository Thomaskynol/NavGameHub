// L1 (R10 itens 1+2) — TDD RED: duelo/placar + armas/granadas/cartas.
// Caminho real (Room + votos + inputs + ticks); cada teste força o estado
// relevante de forma controlada e declara o fixture.
// Dúvidas de produto/balanceamento vão como teste-documentação (passa e
// descreve) ou como falha reproduzida (bug comprovado).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DUEL,
  DUEL_ARENA,
  GRENADE,
  PISTOL,
  PLAYER,
  TICK_DT,
  WEAPONS,
} from '@vava/shared';
import type { MapId, PlayerInput, ServerMessage, Snapshot } from '@vava/shared';
import { Room } from '../src/room.js';

const DT = TICK_DT;
const noop = { send(): void {} };

function captureClient(inbox: ServerMessage[]) {
  return { send(message: ServerMessage): void { inbox.push(message); } };
}

function playersOf(room: Room): Map<string, any> {
  return (room as unknown as { players: Map<string, any> }).players;
}

function priv(room: Room): any {
  return room as unknown as any;
}

function input(seq: number, aim = 0, over: Partial<PlayerInput> = {}): PlayerInput {
  return { seq, move: 0, aim, shoot: false, reload: false, dash: false, grenade: false, ...over };
}

/** Sala real com N jogadores em playing (voto + beginMatch pelo caminho real). */
function playingRoom(code: string, names = ['A', 'B'], map: MapId = 'field') {
  const room = new Room(code);
  const inboxes = new Map<string, ServerMessage[]>();
  const ps = names.map((name) => {
    const inbox: ServerMessage[] = [];
    const p = room.addPlayer(captureClient(inbox), name)!;
    assert.ok(p, `${name} recusado`);
    inboxes.set(p.id, inbox);
    return p;
  });
  room.update(); // waiting: abre votação
  room.handleVoteMap(ps[0]!.id, map);
  for (let i = 1; i < ps.length; i += 1) room.handleVoteMap(ps[i]!.id, map);
  room.update(); // resolve: playing
  assert.equal(room.phase, 'playing');
  for (const p of ps) {
    p.spawnProtect = 0;
    p.physics.vx = 0;
    p.physics.vy = 0;
  }
  // Determinismo: powerups aleatórios desligados (cada teste religa o que
  // precisa via triggerDuel/coleta forçada). Só active=false NÃO basta: o
  // respawn revive no 1º tick (respawnTimer 0) — trava o timer em 9999.
  for (const spawn of priv(room).powerupSpawns) {
    spawn.active = false;
    spawn.respawnTimer = 9999;
  }
  return { room, ps, inboxes };
}

function eventsOf(inbox: ServerMessage[], type: string): any[] {
  return inbox.filter((m) => m.t === 'event').map((m) => (m as any).e).filter((e) => e.type === type);
}

function allEvents(inboxes: Map<string, ServerMessage[]>, type: string): any[] {
  return [...inboxes.values()].flatMap((inbox) => eventsOf(inbox, type));
}

/** Força o powerup de duelo no jogador pelo caminho real (coleta no update). */
function triggerDuel(room: Room, player: { id: string }): void {
  const r = priv(room);
  const rec = playersOf(room).get(player.id);
  for (const spawn of r.powerupSpawns) {
    spawn.active = false;
    spawn.respawnTimer = 9999;
  }
  r.powerupSpawns[0].active = true;
  r.powerupSpawns[0].type = 'duel';
  r.powerupSpawns[0].x = rec.physics.x;
  r.powerupSpawns[0].y = rec.physics.y;
  rec.spawnProtect = 0;
  room.update(DT);
  assert.equal(r.pendingDuels.length, 1, 'powerup de duelo não ativou');
}

function runCountdown(room: Room): void {
  for (let i = 0; i < Math.ceil(DUEL.countdownSeconds / DT) + 5; i += 1) room.update(DT);
}

/** Ativa o duelo e completa o countdown; retorna os duelistas teleportados. */
function duelStarted(code: string, names = ['A', 'B']) {
  const { room, ps, inboxes } = playingRoom(code, names);
  const aOrigin = { x: ps[0]!.physics.x, y: ps[0]!.physics.y };
  const bOrigin = { x: ps[1]!.physics.x, y: ps[1]!.physics.y };
  triggerDuel(room, ps[0]!);
  assert.ok(priv(room).pendingDuels.length === 1);
  runCountdown(room);
  const a = playersOf(room).get(ps[0]!.id);
  const b = playersOf(room).get(ps[1]!.id);
  assert.ok(a.inDuel && b.inDuel, 'duelo não teleportou após o countdown');
  return { room, ps, inboxes, a, b, aOrigin, bOrigin };
}

function shootAt(room: Room, shooter: any, tx: number, ty: number, ticks: number): void {
  const aim = Math.atan2(ty - shooter.physics.y, tx - shooter.physics.x);
  let seq = (shooter.lastReceivedSeq ?? 0) + 1;
  for (let i = 0; i < ticks; i += 1) {
    room.handleInput(shooter.id, input(seq++, aim, { shoot: true }));
    room.update(DT);
  }
}

/** Atira até o almo matar (vítima renasce em 3s: rajada fixa além disso mede
 *  o respawn, não o abate). Retorna true se matou dentro do limite. */
function shootUntilKill(room: Room, shooter: any, target: any, maxTicks: number): boolean {
  const aim = Math.atan2(target.physics.y - shooter.physics.y, target.physics.x - shooter.physics.x);
  let seq = (shooter.lastReceivedSeq ?? 0) + 1;
  for (let i = 0; i < maxTicks; i += 1) {
    room.handleInput(shooter.id, input(seq++, aim, { shoot: true }));
    room.update(DT);
    if (!target.alive) return true;
  }
  return !target.alive;
}

// ---------------- DUELO ----------------

test('L1 duelo: ativação escolhe adversário vivo, avisa (duelStart 5s) e teleporta ao ringue', () => {
  const { room, ps, inboxes, a, b } = duelStarted('L1-DUEL-ACT');
  const starts = allEvents(inboxes, 'duelStart');
  assert.ok(starts.length >= 1, 'sem evento duelStart');
  assert.equal(starts[0].seconds, DUEL.countdownSeconds);
  assert.ok(a.physics.x >= DUEL_ARENA.minX && a.physics.x <= DUEL_ARENA.maxX);
  assert.ok(b.physics.x >= DUEL_ARENA.minX && b.physics.x <= DUEL_ARENA.maxX);
  assert.equal(a.duelPartner, b.id);
  assert.equal(b.duelPartner, a.id);
  assert.ok(a.duel > 0 && b.duel > 0);
  // Coerência de estados: snapshot expõe o duelo (par + timer do próprio).
  (room as unknown as { sendSnapshotTo(p: unknown): void }).sendSnapshotTo(a);
  let snap: Snapshot | null = null;
  for (let i = inboxes.get(a.id)!.length - 1; i >= 0; i -= 1) {
    const m = inboxes.get(a.id)![i];
    if (m && m.t === 'snapshot') { snap = (m as any).snap; break; }
  }
  assert.ok(snap, 'sem snapshot no duelo');
  assert.ok(snap.players.find((p) => p.id === a.id)?.duel, 'snapshot sem flag duel do duelista');
  assert.ok(snap.you.duel > 0, 'snapshot sem timer de duelo no SelfState');
  void ps;
  void room;
});

test('L1 duelo: isolamento — fora do duelo ninguém acerta duelista e vice-versa', () => {
  const { room, ps } = playingRoom('L1-DUEL-ISO', ['A', 'B', 'C']);
  triggerDuel(room, ps[0]!);
  runCountdown(room);
  const a = playersOf(room).get(ps[0]!.id);
  // Oponente é sorteado: parceiro real + um estranho real, sem presumir nomes.
  const partner = playersOf(room).get(a.duelPartner);
  const outsider = ps.map((p) => playersOf(room).get(p.id)).find((p) => !p.inDuel)!;
  assert.ok(a.inDuel && partner?.inDuel && outsider && !outsider.inDuel, 'duelo não tem 2 duelistas + 1 estranho');
  // Estranho colado no parceiro, atirando nele: o isolamento lógico barra.
  outsider.physics.x = partner.physics.x - 100;
  outsider.physics.y = partner.physics.y;
  outsider.physics.vx = 0; outsider.physics.vy = 0;
  outsider.spawnProtect = 0; partner.spawnProtect = 0;
  outsider.weapon = 'pistol'; outsider.ammo = 10; outsider.fireCooldown = 0;
  const hpBefore = partner.health;
  shootAt(room, outsider, partner.physics.x, partner.physics.y, 120);
  assert.equal(partner.health, hpBefore, 'outsider acertou duelista (isolamento quebrado)');
});

test('L1 duelo: parceiros se acertam normalmente dentro do ringue', () => {
  const { room, a, b } = duelStarted('L1-DUEL-HIT');
  a.spawnProtect = 0; b.spawnProtect = 0;
  a.weapon = 'pistol'; a.ammo = 10; a.fireCooldown = 0; a.reloading = 0;
  const hpBefore = b.health;
  shootAt(room, a, b.physics.x, b.physics.y, 120);
  assert.ok(b.health < hpBefore, 'parceiros de duelo não se acertam');
});

test('L1 duelo: vitória por eliminação — vencedor volta à origem com buff; placar documentado', () => {
  const { room, inboxes, a, b, aOrigin } = duelStarted('L1-DUEL-KILL');
  a.spawnProtect = 0; b.spawnProtect = 0;
  b.health = 25; // 1 tiro de pistola mata: caminho real da bala
  a.weapon = 'pistol'; a.ammo = 10; a.fireCooldown = 0; a.reloading = 0;
  const killsBefore = a.kills;
  assert.ok(shootUntilKill(room, a, b, 200), 'rajada do duelo não matou em 200 ticks');
  assert.equal(b.alive, false, 'vítima do duelo sobreviveu à rajada');
  assert.equal(a.inDuel, false, 'vencedor segue preso no duelo');
  assert.ok(Math.abs(a.physics.x - aOrigin.x) < 1 && Math.abs(a.physics.y - aOrigin.y) < 1, 'vencedor não voltou à origem');
  // COMPORTAMENTO DOCUMENTADO (sem decisão em docs/código sobre "3 kills"):
  // killPlayer dá +1 pelo abate e +2 extras no duelo = +3 no total.
  assert.equal(a.kills, killsBefore + 3, `placar do duelo mudou (esperado +3, obtido +${a.kills - killsBefore})`);
  assert.ok(a.damageBoost > 0 && a.speedBoost > 0, 'vencedor sem buff de duelo');
  const ends = allEvents(inboxes, 'duelEnd');
  assert.ok(ends.some((e) => e.reason === 'kill' && e.winnerId === a.id), 'sem duelEnd kill p/ o vencedor');
  const kills = allEvents(inboxes, 'kill');
  assert.ok(kills.some((k) => k.killerId === a.id && k.victimId === b.id), 'sem evento kill do duelo');
});

test('L1 duelo: timeout — ambos voltam às origens, sem buff e sem kills', () => {
  const { room, inboxes, a, b, aOrigin, bOrigin } = duelStarted('L1-DUEL-TIME');
  a.spawnProtect = 0; b.spawnProtect = 0;
  for (let i = 0; i < Math.ceil(DUEL.durationSeconds / DT) + 10; i += 1) room.update(DT);
  assert.equal(a.inDuel, false);
  assert.equal(b.inDuel, false);
  assert.ok(Math.abs(a.physics.x - aOrigin.x) < 1 && Math.abs(a.physics.y - aOrigin.y) < 1);
  assert.ok(Math.abs(b.physics.x - bOrigin.x) < 1 && Math.abs(b.physics.y - bOrigin.y) < 1);
  assert.equal(a.kills, 0);
  assert.equal(b.kills, 0);
  const ends = allEvents(inboxes, 'duelEnd');
  assert.ok(ends.some((e) => e.reason === 'timeout'), 'sem duelEnd timeout');
});

test('L1 duelo: saída no meio do duelo — sobrevivente volta à origem (W.O., sem bonus)', () => {
  const { room, inboxes, a, ps, aOrigin } = duelStarted('L1-DUEL-LEAVE');
  void a;
  room.removePlayer(ps[1]!.id);
  room.update(DT); // removePlayer enfileira; o flush é no update
  const surv = playersOf(room).get(ps[0]!.id);
  assert.equal(surv.inDuel, false);
  assert.ok(Math.abs(surv.physics.x - aOrigin.x) < 1 && Math.abs(surv.physics.y - aOrigin.y) < 1);
  assert.equal(surv.kills, 0, 'W.O. deu kills indevidos');
  const ends = allEvents(inboxes, 'duelEnd');
  assert.ok(ends.some((e) => e.reason === 'leave' && e.winnerId === surv.id), 'sem duelEnd leave p/ o sobrevivente');
});

test('L1 duelo: saída durante o countdown cancela sem teleportar', () => {
  const { room, inboxes, ps } = playingRoom('L1-DUEL-PRE', ['A', 'B']);
  const ax = playersOf(room).get(ps[0]!.id).physics.x;
  triggerDuel(room, ps[0]!);
  room.removePlayer(ps[1]!.id);
  assert.equal(priv(room).pendingDuels.length, 0, 'countdown fantasma após saída');
  for (let i = 0; i < Math.ceil(DUEL.countdownSeconds / DT) + 5; i += 1) room.update(DT);
  const surv = playersOf(room).get(ps[0]!.id);
  assert.equal(surv.inDuel, false);
  assert.ok(Math.abs(surv.physics.x - ax) < 2, 'sobrevivente teleportado sem duelo');
  const ends = allEvents(inboxes, 'duelEnd');
  assert.ok(ends.some((e) => e.reason === 'leave'), 'sem duelEnd leave do countdown');
});

test('L1 duelo: 3+ jogadores — terceiro joga livre; duelos simultâneos com 4', () => {
  const { room, ps } = playingRoom('L1-DUEL-4', ['A', 'B', 'C', 'D']);
  triggerDuel(room, ps[0]!);
  runCountdown(room);
  const a = playersOf(room).get(ps[0]!.id);
  const b = playersOf(room).get(ps[1]!.id);
  const c = playersOf(room).get(ps[2]!.id);
  const d = playersOf(room).get(ps[3]!.id);
  // Oponente do duelo é sorteado: deriva o par do estado real, sem presumir.
  assert.ok(a.inDuel, 'iniciador fora do duelo');
  const partner = playersOf(room).get(a.duelPartner);
  assert.ok(partner?.inDuel, 'parceiro fora do duelo');
  const pair = new Set([a.id, partner.id]);
  const free = [b, c, d].filter((p) => !pair.has(p.id));
  assert.equal(free.length, 2, 'duelo não pegou exatamente 2 de 4');
  for (const p of free) assert.equal(p.inDuel, false, 'terceiro arrastado ao duelo');
  // Segundo duelo entre os livres: força via coleta direta.
  const r = priv(room);
  const [f1, f2] = free;
  for (const spawn of r.powerupSpawns) {
    spawn.active = false;
    spawn.respawnTimer = 9999;
  }
  r.powerupSpawns[0].active = true;
  r.powerupSpawns[0].type = 'duel';
  r.powerupSpawns[0].x = f1!.physics.x;
  r.powerupSpawns[0].y = f1!.physics.y;
  f1!.spawnProtect = 0;
  room.update(DT);
  // C está livre e D livre: segundo countdown pode iniciar (candidatos = D
  // e possivelmente outros livres). Aceita 0 ou 1 pendente, mas nunca deve
  // incluir quem já está em duelo.
  for (const pend of r.pendingDuels as { a: string; b: string }[]) {
    assert.ok(!pair.has(pend.a) && !pair.has(pend.b), 'duelo simultâneo sequestrou duelista');
  }
  void d;
});

// ---------------- ARMAS ----------------

test('L1 armas: pistola 25 de dano, 4 tiros matam, cadência 0.28s, pente 10, recarga 1.35s', () => {
  const { room, ps } = playingRoom('L1-W-PISTOL');
  const a = playersOf(room).get(ps[0]!.id);
  const b = playersOf(room).get(ps[1]!.id);
  a.physics.x = 400; a.physics.y = 800; a.physics.vx = 0; a.physics.vy = 0;
  b.physics.x = 600; b.physics.y = 800; b.physics.vx = 0; b.physics.vy = 0;
  a.spawnProtect = 0; b.spawnProtect = 0;
  assert.equal(WEAPONS.pistol.damage, PISTOL.damage);
  assert.equal(PISTOL.damage, 25);
  assert.equal(PISTOL.fireInterval, 0.28);
  assert.equal(PISTOL.magSize, 10);
  assert.equal(PISTOL.reloadSeconds, 1.35);
  a.weapon = 'pistol'; a.ammo = 10; a.fireCooldown = 0; a.reloading = 0;
  assert.ok(shootUntilKill(room, a, b, 400), 'rajada de pistola não matou em 400 ticks');
  assert.equal(b.alive, false, '4+ tiros de pistola não mataram');
  assert.equal(a.kills, 1);
  assert.equal(b.deaths, 1);
  assert.equal(priv(room).players.get(a.id).kills, 1);
});

test('L1 armas: morte/respawn — 3s fora, volta com 100, proteção 1.5s, placar no snapshot', () => {
  const { room, ps, inboxes } = playingRoom('L1-W-RESPAWN');
  const a = playersOf(room).get(ps[0]!.id);
  const b = playersOf(room).get(ps[1]!.id);
  a.physics.x = 400; a.physics.y = 800; a.physics.vx = 0; a.physics.vy = 0;
  b.physics.x = 600; b.physics.y = 800; b.physics.vx = 0; b.physics.vy = 0;
  a.spawnProtect = 0; b.spawnProtect = 0;
  a.weapon = 'pistol'; a.ammo = 10; a.fireCooldown = 0; a.reloading = 0;
  assert.ok(shootUntilKill(room, a, b, 400), 'rajada de pistola não matou em 400 ticks');
  assert.equal(b.alive, false);
  assert.ok(b.respawnTimer > 0 && b.respawnTimer <= PLAYER.respawnSeconds);
  for (let i = 0; i < Math.ceil(PLAYER.respawnSeconds / DT) + 5; i += 1) room.update(DT);
  assert.equal(b.alive, true, 'sem respawn após 3s');
  assert.equal(b.health, PLAYER.maxHealth);
  assert.ok(b.spawnProtect > 0, 'sem proteção de spawn no respawn');
  // Placar reflete no snapshot do próprio jogador.
  (room as unknown as { sendSnapshotTo(p: unknown): void }).sendSnapshotTo(a);
  let snap: Snapshot | null = null;
  for (let i = inboxes.get(a.id)!.length - 1; i >= 0; i -= 1) {
    const m = inboxes.get(a.id)![i];
    if (m && m.t === 'snapshot') { snap = (m as any).snap; break; }
  }
  assert.ok(snap, 'sem snapshot');
  const row = snap.players.find((p) => p.id === a.id);
  assert.equal(row?.kills, 1);
  assert.equal(row?.deaths, 0);
  assert.equal(row?.score, 1);
  assert.equal(snap.you.kills, 1);
});

test('L1 armas: espingarda — 6 cartuchos por tiro, cadência 1.1s, pente 6', () => {
  const { room, ps } = playingRoom('L1-W-SHOT');
  const a = playersOf(room).get(ps[0]!.id);
  a.weapon = 'shotgun'; a.ammo = WEAPONS.shotgun.magSize; a.fireCooldown = 0; a.reloading = 0;
  assert.equal(WEAPONS.shotgun.pellets, 6);
  assert.equal(WEAPONS.shotgun.fireInterval, 1.1);
  assert.equal(WEAPONS.shotgun.magSize, 6);
  let seq = 1;
  room.handleInput(a.id, input(seq++, 0, { shoot: true }));
  room.update(DT);
  assert.equal(priv(room).bullets.length, 6, 'espingarda não soltou 6 cartuchos');
});

test('L1 armas: minigun — cadência 0.12s, pente 50, lenta (150)', () => {
  const { room, ps } = playingRoom('L1-W-MINI');
  const a = playersOf(room).get(ps[0]!.id);
  const b = playersOf(room).get(ps[1]!.id);
  assert.equal(WEAPONS.minigun.fireInterval, 0.12);
  assert.equal(WEAPONS.minigun.magSize, 50);
  assert.equal(WEAPONS.minigun.speed, 150);
  // Faixa sul aberta p/ o leste; B no canto oposto (fora da linha de tiro).
  a.physics.x = 300; a.physics.y = 1400; a.physics.vx = 0; a.physics.vy = 0;
  b.physics.x = 200; b.physics.y = 200; b.physics.vx = 0; b.physics.vy = 0;
  a.spawnProtect = 0; b.spawnProtect = 0;
  a.weapon = 'minigun'; a.ammo = 50; a.fireCooldown = 0; a.reloading = 0;
  let seq = 1;
  for (let i = 0; i < 30; i += 1) {
    room.handleInput(a.id, input(seq++, 0, { shoot: true }));
    room.update(DT);
  }
  // Cadência 0.12s ≈ 1 tiro/7.2 ticks: ~4 balas em 30 ticks.
  assert.ok(priv(room).bullets.length >= 3, `minigun lenta demais: ${priv(room).bullets.length} balas em 30 ticks`);
});

test('L1 armas: lança-chamas — 40 dps, alcance 360, consome 15/s', () => {
  const { room, ps } = playingRoom('L1-W-FLAME');
  const a = playersOf(room).get(ps[0]!.id);
  const b = playersOf(room).get(ps[1]!.id);
  assert.equal(WEAPONS.flamethrower.flameDamagePerSecond, 40);
  assert.equal(WEAPONS.flamethrower.flameRange, 360);
  assert.equal(WEAPONS.flamethrower.flameAmmoPerSecond, 15);
  a.physics.x = 1000; a.physics.y = 1000; a.physics.vx = 0; a.physics.vy = 0;
  b.physics.x = 1100; b.physics.y = 1000; b.physics.vx = 0; b.physics.vy = 0;
  a.spawnProtect = 0; b.spawnProtect = 0;
  a.weapon = 'flamethrower'; a.ammo = 60; a.reloading = 0; a.flameTick = 0;
  const hpBefore = b.health;
  const ammoBefore = a.ammo;
  shootAt(room, a, b.physics.x, b.physics.y, 60);
  assert.ok(b.health < hpBefore, 'chama não queimou no alcance');
  assert.ok(a.ammo < ammoBefore, 'chama não consumiu munição');
});

// ---------------- GRANADAS ----------------

test('L1 granada: voo 520 por ~620 (lifetime), explode em parede/parede da arena', () => {
  assert.equal(GRENADE.speed, 520);
  assert.equal(GRENADE.range, 620);
  assert.ok(Math.abs(GRENADE.lifetime - GRENADE.range / GRENADE.speed) < 1e-9);
  const { room, ps, inboxes } = playingRoom('L1-G-FLY');
  const a = playersOf(room).get(ps[0]!.id);
  a.physics.x = 1200; a.physics.y = 300; a.physics.vx = 0; a.physics.vy = 0;
  a.spawnProtect = 0; a.grenadeCooldown = 0;
  room.handleInput(a.id, input(1, Math.PI / 2, { grenade: true }));
  room.update(DT);
  assert.equal(priv(room).grenades.length, 1, 'granada não lançada');
  assert.ok(a.grenadeCooldown > 0, 'sem cooldown de 15s após lançar');
  for (let i = 0; i < Math.ceil(GRENADE.lifetime / DT) + 10; i += 1) room.update(DT);
  assert.equal(priv(room).grenades.length, 0, 'granada não explodiu no fim da vida');
  assert.ok(allEvents(inboxes, 'explosion').length >= 1, 'sem evento explosion');
});

test('L1 granada: parede da casa blinda a explosão (fora -> dentro)', () => {
  const { room, ps } = playingRoom('L1-G-WALL');
  const a = playersOf(room).get(ps[0]!.id);
  const b = playersOf(room).get(ps[1]!.id);
  // Mesma geometria do teste da chama: fora (1050,470), alvo dentro (1050,750).
  // A granada morre na parede N e a explosão não atravessa kind 'wall'.
  a.physics.x = 1050; a.physics.y = 470; a.physics.vx = 0; a.physics.vy = 0;
  b.physics.x = 1050; b.physics.y = 750; b.physics.vx = 0; b.physics.vy = 0;
  a.spawnProtect = 0; b.spawnProtect = 0;
  a.grenadeCooldown = 0;
  room.handleInput(a.id, input(1, Math.PI / 2, { grenade: true }));
  for (let i = 0; i < 200; i += 1) room.update(DT);
  assert.equal(b.health, 100, `parede não blindou a granada: alvo com ${b.health}`);
});

test('L1 duelo: iniciador pendente não abre 2º duelo (sem sequestro de origem)', () => {
  const { room, ps } = playingRoom('L1-DUEL-DBL', ['A', 'B', 'C']);
  triggerDuel(room, ps[0]!);
  assert.equal(priv(room).pendingDuels.length, 1);
  // Segundo powerup de duelo no iniciador ainda no countdown: deve ser nulo.
  const r = priv(room);
  const a = playersOf(room).get(ps[0]!.id);
  for (const spawn of r.powerupSpawns) {
    spawn.active = false;
    spawn.respawnTimer = 9999;
  }
  r.powerupSpawns[0].active = true;
  r.powerupSpawns[0].type = 'duel';
  r.powerupSpawns[0].x = a.physics.x;
  r.powerupSpawns[0].y = a.physics.y;
  a.spawnProtect = 0;
  room.update(DT);
  assert.equal(r.pendingDuels.length, 1, 'iniciador pendente abriu 2º duelo (origem sobrescrita)');
  runCountdown(room);
  assert.ok(a.inDuel, 'duelo legítimo não começou após o bloqueio do 2º');
});

test('L1 granada: colisão com jogador explode; explosão 185 com 75 de dano', () => {
  assert.equal(GRENADE.explosionRadius, 185);
  assert.equal(GRENADE.damage, 75);
  const { room, ps } = playingRoom('L1-G-HIT');
  const a = playersOf(room).get(ps[0]!.id);
  const b = playersOf(room).get(ps[1]!.id);
  // Alvo parado a 120px ao sul; granada voa e explode no contato.
  a.physics.x = 1200; a.physics.y = 300; a.physics.vx = 0; a.physics.vy = 0;
  b.physics.x = 1200; b.physics.y = 420; b.physics.vx = 0; b.physics.vy = 0;
  a.spawnProtect = 0; b.spawnProtect = 0;
  a.grenadeCooldown = 0;
  const hpBefore = b.health;
  room.handleInput(a.id, input(1, Math.PI / 2, { grenade: true }));
  for (let i = 0; i < 120; i += 1) room.update(DT);
  assert.ok(b.health < hpBefore, 'granada não machucou no contato/explosão');
});

// ---------------- TELEGUIDADAS ----------------

test('L1 teleguiada: bala curva em direção ao inimigo próximo (<=400px)', () => {
  const { room, ps } = playingRoom('L1-HOMING');
  const a = playersOf(room).get(ps[0]!.id);
  const b = playersOf(room).get(ps[1]!.id);
  a.cards = ['homing'];
  // Faixa sul aberta (longe da árvore 760,950 e da casa): sem obstáculo no voo.
  a.physics.x = 300; a.physics.y = 1400; a.physics.vx = 0; a.physics.vy = 0;
  b.physics.x = 600; b.physics.y = 1400; b.physics.vx = 0; b.physics.vy = 0;
  a.spawnProtect = 0; b.spawnProtect = 0;
  a.weapon = 'pistol'; a.ammo = 10; a.fireCooldown = 0; a.reloading = 0;
  // Mira errada de propósito (0.3 rad acima do alvo): sem curva, passa longe.
  const aimOff = Math.atan2(b.physics.y - a.physics.y, b.physics.x - a.physics.x) + 0.3;
  room.handleInput(a.id, input(1, aimOff, { shoot: true }));
  room.update(DT);
  assert.equal(priv(room).bullets.length, 1);
  const angleBefore = Math.atan2(priv(room).bullets[0].vy, priv(room).bullets[0].vx);
  for (let i = 0; i < 15; i += 1) room.update(DT);
  assert.equal(priv(room).bullets.length, 1, 'bala teleguiada sumiu antes da curva');
  const after = priv(room).bullets[0];
  const angleAfter = Math.atan2(after.vy, after.vx);
  const desired = Math.atan2(b.physics.y - after.y, b.physics.x - after.x);
  const diff = (v: number): number => Math.atan2(Math.sin(v), Math.cos(v));
  assert.ok(
    Math.abs(diff(desired - angleAfter)) < Math.abs(diff(desired - angleBefore)),
    `bala não curvou ao alvo (antes ${angleBefore.toFixed(2)}, depois ${angleAfter.toFixed(2)})`,
  );
});

test('L1 teleguiada: snapshot leva a bala a todos (visível p/ atirador E outros)', () => {
  const { room, ps, inboxes } = playingRoom('L1-HOMING-VIS');
  const a = playersOf(room).get(ps[0]!.id);
  a.cards = ['homing'];
  a.physics.x = 400; a.physics.y = 800; a.physics.vx = 0; a.physics.vy = 0;
  a.spawnProtect = 0;
  a.weapon = 'pistol'; a.ammo = 10; a.fireCooldown = 0; a.reloading = 0;
  room.handleInput(a.id, input(1, 0, { shoot: true }));
  room.update(DT);
  assert.equal(priv(room).bullets.length, 1);
  (room as unknown as { sendSnapshotTo(p: unknown): void }).sendSnapshotTo(a);
  (room as unknown as { sendSnapshotTo(p: unknown): void }).sendSnapshotTo(playersOf(room).get(ps[1]!.id));
  for (const [, inbox] of inboxes) {
    let snap: Snapshot | null = null;
    for (let i = inbox.length - 1; i >= 0; i -= 1) {
      const m = inbox[i];
      if (m && m.t === 'snapshot') { snap = (m as any).snap; break; }
    }
    assert.ok(snap, 'sem snapshot');
    assert.equal(snap.bullets.length, 1, 'bala teleguiada invisível num dos clientes');
    assert.equal(snap.bullets[0]!.owner, a.id);
  }
});

// ---------------- CARTAS ----------------

test('L1 cartas: equipadas no fim da escolha, máximo 3 (a 4ª descarta a mais antiga)', () => {
  const { room, ps } = playingRoom('L1-CARD-EQ');
  const a = playersOf(room).get(ps[0]!.id);
  (room as unknown as { applyCard(p: unknown, c: string): void }).applyCard(a, 'homing');
  (room as unknown as { applyCard(p: unknown, c: string): void }).applyCard(a, 'ricochet');
  (room as unknown as { applyCard(p: unknown, c: string): void }).applyCard(a, 'chargedShot');
  assert.deepEqual([...a.cards], ['homing', 'ricochet', 'chargedShot']);
  (room as unknown as { applyCard(p: unknown, c: string): void }).applyCard(a, 'dashInvis');
  assert.deepEqual([...a.cards], ['ricochet', 'chargedShot', 'dashInvis']);
  // HUD tem 3 espaços (contrato cliente): o servidor nunca entrega mais de 3.
  assert.ok(a.cards.length <= 3);
  (room as unknown as { sendSnapshotTo(p: unknown): void }).sendSnapshotTo(a);
  void room;
  void ps;
});

test('L1 cartas: dashShot — dash dispara espingarda na direção do dash', () => {
  const { room, ps } = playingRoom('L1-CARD-DASHSHOT');
  const a = playersOf(room).get(ps[0]!.id);
  a.cards = ['dashShot'];
  a.physics.x = 1200; a.physics.y = 1200; a.physics.vx = 0; a.physics.vy = 0;
  a.physics.dashCooldown = 0; a.physics.dashTime = 0;
  a.spawnProtect = 0;
  const before = priv(room).bullets.length;
  let seq = 1;
  // Dash para o leste: move=8, canais livres no campo aberto ao sul.
  room.handleInput(a.id, input(seq++, 0, { move: 8, dash: true }));
  for (let i = 0; i < 10; i += 1) room.update(DT);
  assert.ok(priv(room).bullets.length > before, 'dashShot: dash não disparou nada (carta sem efeito)');
  assert.equal(priv(room).bullets.length - before, WEAPONS.shotgun.pellets, 'dashShot não soltou os 6 cartuchos');
  // +1s no cooldown do dash (base 1.6): logo após o dash, > 1.6 restante.
  assert.ok(a.physics.dashCooldown > 1.6, `dashShot sem +1s de cooldown (${a.physics.dashCooldown.toFixed(2)}s)`);
});

test('L1 cartas: deathGrenade — granada póstuma explode com raio +30%', () => {
  const { room, ps } = playingRoom('L1-CARD-DEATH', ['A', 'B', 'C']);
  const a = playersOf(room).get(ps[0]!.id);
  const b = playersOf(room).get(ps[1]!.id);
  const c = playersOf(room).get(ps[2]!.id);
  a.cards = ['deathGrenade'];
  // Vítima em (500,800); testemunha C a 210px (>185 do raio base,
  // <240 do raio +30%): só leva dano se o bônus existir.
  a.physics.x = 400; a.physics.y = 800; a.physics.vx = 0; a.physics.vy = 0;
  b.physics.x = 500; b.physics.y = 800; b.physics.vx = 0; b.physics.vy = 0;
  c.physics.x = 710; c.physics.y = 800; c.physics.vx = 0; c.physics.vy = 0;
  a.spawnProtect = 0; b.spawnProtect = 0; c.spawnProtect = 0;
  (room as unknown as { killPlayer(v: unknown, k: unknown): void }).killPlayer(b, a);
  assert.equal(priv(room).grenades.length, 1, 'deathGrenade: sem granada póstuma');
  const hpBefore = c.health;
  for (let i = 0; i < Math.ceil((GRENADE.lifetime * 1.3) / DT) + 10; i += 1) room.update(DT);
  assert.ok(c.health < hpBefore, 'deathGrenade: raio +30% sem efeito (alvo a 210px intacto)');
});

test('L1 cartas: fumaça das demais — homing/ricochet/wallBounce/slow/charged/dashInvis/powerupDuration/weaponCycle têm efeito', () => {
  const { room, ps } = playingRoom('L1-CARD-FX');
  const a = playersOf(room).get(ps[0]!.id);
  a.physics.x = 400; a.physics.y = 800; a.physics.vx = 0; a.physics.vy = 0;
  a.spawnProtect = 0;
  let seq = 1;
  const fireOnce = (): any => {
    a.weapon = 'pistol'; a.ammo = 10; a.fireCooldown = 0; a.reloading = 0;
    room.handleInput(a.id, input(seq++, 0, { shoot: true }));
    room.update(DT);
    return priv(room).bullets[priv(room).bullets.length - 1];
  };
  // ricochet: 3 ricochetes ao criar a bala.
  a.cards = ['ricochet'];
  assert.equal(fireOnce().ricochets, 3, 'ricochet sem efeito');
  // wallBounce: 1 quicada + 50% de dano.
  a.cards = ['wallBounce'];
  const wb = fireOnce();
  assert.equal(wb.wallBounce, true, 'wallBounce sem flag');
  assert.ok(wb.ricochets >= 1 && wb.damageMult === 1.5, 'wallBounce sem quicada/dano');
  // slowKnockback: bala a 70% da velocidade.
  a.cards = ['slowKnockback'];
  const slow = fireOnce();
  const spd = Math.hypot(slow.vx, slow.vy);
  assert.ok(Math.abs(spd - PISTOL.bulletSpeed * 0.7) < 1, `slowKnockback sem lentidão (${spd.toFixed(0)} px/s)`);
  // chargedShot: 2s sem atirar → +20% dano, +30% velocidade.
  a.cards = ['chargedShot'];
  a.timeSinceLastShot = 3;
  const ch = fireOnce();
  assert.equal(ch.damageMult, 1.2, 'chargedShot sem +20% de dano');
  // dashInvis: dash deixa invisível por 1.5s.
  a.cards = ['dashInvis'];
  a.physics.dashCooldown = 0; a.physics.dashTime = 0;
  room.handleInput(a.id, input(seq++, 0, { move: 8, dash: true }));
  room.update(DT);
  assert.ok(a.invisible > 0, 'dashInvis sem invisibilidade após o dash');
  // powerupDuration: buffs duram 70% a mais (velocidade 5s → 8.5s).
  a.cards = ['powerupDuration'];
  {
    const r = priv(room);
    for (const spawn of r.powerupSpawns) {
      spawn.active = false;
      spawn.respawnTimer = 9999;
    }
    r.powerupSpawns[0].active = true;
    r.powerupSpawns[0].type = 'speed';
    r.powerupSpawns[0].x = a.physics.x;
    r.powerupSpawns[0].y = a.physics.y;
    a.spawnProtect = 0;
    room.update(DT);
    assert.ok(Math.abs(a.speedBoost - 8.5) < 0.1, `powerupDuration sem 1.7x (${a.speedBoost.toFixed(2)}s)`);
  }
  // weaponCycle: a cada 10s ganha arma de drop por 7s.
  a.cards = ['weaponCycle'];
  a.card3Timer = 0.05;
  a.weapon = 'pistol';
  for (let i = 0; i < 30; i += 1) room.update(DT);
  assert.ok(['flamethrower', 'shotgun', 'minigun'].includes(a.weapon), `weaponCycle não deu arma (${a.weapon})`);
  void room;
  void ps;
});
