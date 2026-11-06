// VAVA — lança-chamas respeita a parede kind 'wall' em playing real (mapa votado),
// como a granada: parede blinda, porta aberta deixa passar, mato/pedra não blindam.
// Campo (casa/vestíbulo N) + Cidade (Torre Norte/cover) com votação real antes do combate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../src/room.js';
import type { MapId, PlayerInput } from '@vava/shared';

const noop = { send(): void {} };
const SOUTH = Math.PI / 2;
const NORTH = -Math.PI / 2;

function shootInput(seq: number, aim: number): PlayerInput {
  return { seq, move: 0, aim, shoot: true, reload: false, dash: false, grenade: false };
}

function setup(sx: number, sy: number, tx: number, ty: number, map: MapId) {
  const room = new Room('FLAM');
  const shooter = room.addPlayer(noop, 'Fogo');
  const target = room.addPlayer(noop, 'Alvo');
  assert.ok(shooter && target);
  room.update(); // waiting -> abre a votação (segue waiting)
  assert.equal(room.phase, 'waiting');
  room.handleVoteMap(shooter.id, map);
  room.handleVoteMap(target.id, map);
  room.update(); // todos votaram -> resolve e começa a partida
  assert.equal(room.phase, 'playing');
  assert.equal(room.mapId, map);
  shooter.physics.x = sx;
  shooter.physics.y = sy;
  shooter.physics.vx = 0;
  shooter.physics.vy = 0;
  shooter.weapon = 'flamethrower';
  shooter.ammo = 60;
  shooter.reloading = 0;
  shooter.flameTick = 0;
  shooter.spawnProtect = 0;
  target.physics.x = tx;
  target.physics.y = ty;
  target.physics.vx = 0;
  target.physics.vy = 0;
  target.spawnProtect = 0;
  return { room, shooter, target };
}

function burn(room: Room, shooterId: string, ticks = 35, aim = SOUTH): void {
  let seq = 1;
  for (let i = 0; i < ticks; i += 1) {
    const shooter = (room as unknown as { players: Map<string, { lastReceivedSeq: number }> }).players.get(shooterId);
    seq = Math.max(seq, (shooter?.lastReceivedSeq ?? 0) + 1);
    room.handleInput(shooterId, shootInput(seq, aim));
    seq += 1;
    room.update();
  }
}

test('campo: parede da casa blinda a chama (fora -> dentro)', () => {
  const { room, shooter, target } = setup(1050, 470, 1050, 750, 'field');
  burn(room, shooter.id);
  assert.equal(room.phase, 'playing');
  assert.equal(room.mapId, 'field');
  assert.equal(target.health, 100, `alvo atrás da parede N queimou: ${target.health}`);
});

test('campo: porta aberta deixa a chama passar (vestíbulo N)', () => {
  const { room, shooter, target } = setup(1200, 450, 1200, 620, 'field');
  burn(room, shooter.id);
  assert.equal(room.phase, 'playing');
  assert.equal(room.mapId, 'field');
  assert.ok(target.health < 100, `alvo no vão da porta intacto: ${target.health}`);
});

test('campo: pedra não blinda a chama', () => {
  const { room, shooter, target } = setup(620, 200, 620, 520, 'field');
  burn(room, shooter.id);
  assert.equal(room.phase, 'playing');
  assert.equal(room.mapId, 'field');
  assert.ok(target.health < 100, `pedra blindou a chama: ${target.health}`);
});

test('cidade: parede do prédio blinda a chama (Torre Norte)', () => {
  const { room, shooter, target } = setup(200, 500, 200, 240, 'city');
  burn(room, shooter.id, 35, NORTH);
  assert.equal(room.phase, 'playing');
  assert.equal(room.mapId, 'city');
  assert.equal(target.health, 100, `alvo atrás da parede N queimou: ${target.health}`);
});

test('cidade: porta aberta deixa a chama passar (Torre Norte S)', () => {
  const { room, shooter, target } = setup(370, 500, 370, 280, 'city');
  burn(room, shooter.id, 35, NORTH);
  assert.equal(room.phase, 'playing');
  assert.equal(room.mapId, 'city');
  assert.ok(target.health < 100, `alvo no vão da porta intacto: ${target.health}`);
});

test('cidade: carro não blinda a chama', () => {
  const { room, shooter, target } = setup(400, 500, 400, 800, 'city');
  burn(room, shooter.id);
  assert.equal(room.phase, 'playing');
  assert.equal(room.mapId, 'city');
  assert.ok(target.health < 100, `carro blindou a chama: ${target.health}`);
});
