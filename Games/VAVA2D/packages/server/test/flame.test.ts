// VAVA — lança-chamas respeita a parede da casa (kind 'wall'), como a granada:
// parede blinda, porta aberta deixa passar, mato/pedra não blindam.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../src/room.js';
import type { PlayerInput } from '@vava/shared';

const noop = { send(): void {} };
const SOUTH = Math.PI / 2;

function shootInput(seq: number, aim: number): PlayerInput {
  return { seq, move: 0, aim, shoot: true, reload: false, dash: false, grenade: false };
}

function setup(sx: number, sy: number, tx: number, ty: number) {
  const room = new Room('FLAM');
  const shooter = room.addPlayer(noop, 'Fogo');
  const target = room.addPlayer(noop, 'Alvo');
  assert.ok(shooter && target);
  room.update(); // waiting -> beginMatch -> playing
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

function burn(room: Room, shooterId: string, ticks = 35): void {
  let seq = 1;
  for (let i = 0; i < ticks; i += 1) {
    const shooter = (room as unknown as { players: Map<string, { lastReceivedSeq: number }> }).players.get(shooterId);
    seq = Math.max(seq, (shooter?.lastReceivedSeq ?? 0) + 1);
    room.handleInput(shooterId, shootInput(seq, SOUTH));
    seq += 1;
    room.update();
  }
}

test('parede da casa blinda a chama (fora -> dentro)', () => {
  const { room, shooter, target } = setup(1050, 470, 1050, 750);
  burn(room, shooter.id);
  assert.equal(target.health, 100, `alvo atrás da parede N queimou: ${target.health}`);
});

test('porta aberta deixa a chama passar (vestíbulo N)', () => {
  const { room, shooter, target } = setup(1200, 450, 1200, 620);
  burn(room, shooter.id);
  assert.ok(target.health < 100, `alvo no vão da porta intacto: ${target.health}`);
});

test('pedra não blinda a chama', () => {
  const { room, shooter, target } = setup(620, 200, 620, 520);
  burn(room, shooter.id);
  assert.ok(target.health < 100, `pedra blindou a chama: ${target.health}`);
});
