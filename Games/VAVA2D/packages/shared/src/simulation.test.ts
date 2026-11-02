import assert from 'node:assert/strict';
import test from 'node:test';
import { ARENA, PLAYER, POWERUP } from './constants.js';
import { HOUSE, OBSTACLES, SPAWN_POINTS } from './map.js';
import {
  createPlayerPhysics,
  pointBlockedByObstacle,
  segmentCircleHit,
  stepPlayerPhysics,
} from './simulation.js';
import type { PlayerInput } from './types.js';

let nextSeq = 1;

function input(partial: Partial<PlayerInput> = {}): PlayerInput {
  const { grenade, ...rest } = partial;
  return {
    seq: nextSeq++,
    move: 0,
    aim: 0,
    shoot: false,
    reload: false,
    dash: false,
    grenade: grenade ?? false,
    ...rest,
  };
}

test('acelera até a velocidade máxima e para com atrito', () => {
  const player = createPlayerPhysics(1000, 200, 0);
  for (let i = 0; i < 60; i += 1) {
    stepPlayerPhysics(player, input({ move: 8 }));
  }
  assert.ok(player.vx > 224 && player.vx <= PLAYER.speed + 0.001);
  assert.ok(player.x > 1000);

  for (let i = 0; i < 90; i += 1) {
    stepPlayerPhysics(player, input());
  }
  assert.equal(player.vx, 0);
  assert.equal(player.vy, 0);
});

test('movimento diagonal é normalizado', () => {
  const player = createPlayerPhysics(200, 200, 0);
  for (let i = 0; i < 30; i += 1) {
    stepPlayerPhysics(player, input({ move: 1 | 8 }));
  }
  assert.ok(Math.abs(player.vx - PLAYER.speed / Math.SQRT2) < 0.5);
  assert.ok(Math.abs(player.vy + PLAYER.speed / Math.SQRT2) < 0.5);
});

test('colisão com pedra impede penetração e permite deslizar', () => {
  const rock = OBSTACLES.find((obstacle) => obstacle.id === 0);
  assert.ok(rock);
  const player = createPlayerPhysics(rock.x, rock.y + rock.radius + PLAYER.radius + 60, -Math.PI / 2);

  for (let i = 0; i < 120; i += 1) {
    stepPlayerPhysics(player, input({ move: 1, aim: -Math.PI / 2 }));
  }

  const gap = Math.hypot(player.x - rock.x, player.y - rock.y);
  assert.ok(gap >= rock.radius + PLAYER.radius - 0.01, `gap ${gap}`);
});

test('dash percorre distância e entra em cooldown', () => {
  const player = createPlayerPhysics(900, 1100, 0);
  stepPlayerPhysics(player, input({ dash: true }));
  assert.ok(player.dashTime > 0);
  assert.ok(player.dashCooldown > 0);

  const startX = player.x;
  for (let i = 0; i < 90; i += 1) {
    stepPlayerPhysics(player, input());
  }
  assert.ok(player.x - startX > 200, `distância ${player.x - startX}`);

  const before = player.dashTime;
  stepPlayerPhysics(player, input({ dash: true }));
  assert.ok(player.dashCooldown > 0);
  assert.equal(player.dashTime, before, 'dash em cooldown não reinicia');
});

test('bordas do mapa e velocidade de parede são respeitadas', () => {
  const player = createPlayerPhysics(1200, 900, 0);
  player.x = -100;
  player.vx = -200;
  stepPlayerPhysics(player, input());
  const minX = ARENA.inset + PLAYER.radius;
  assert.equal(player.x, minX);
  assert.equal(player.vx, 0);
});

test('segmento detecta entrada em círculo', () => {
  assert.equal(segmentCircleHit(0, 0, 10, 0, 5, 0, 2), 0.3);
  assert.equal(segmentCircleHit(0, 0, 10, 0, 0, 0, 1), 0);
  assert.equal(segmentCircleHit(0, 0, 10, 0, 5, 5, 1), null);
});

test('parede da casa bloqueia jogador fora da porta', () => {
  const player = createPlayerPhysics(1100, 550, Math.PI / 2);
  for (let i = 0; i < 120; i += 1) {
    stepPlayerPhysics(player, input({ move: 2, aim: Math.PI / 2 }));
  }
  // Parede norte em y=650 (círculos r22): para em ~613 sem atravessar.
  assert.ok(player.y < 640 && player.y > 590, `y ${player.y}`);
});

test('porta da casa deixa o jogador entrar', () => {
  const player = createPlayerPhysics(1275, 550, Math.PI / 2);
  for (let i = 0; i < 45; i += 1) {
    stepPlayerPhysics(player, input({ move: 2, aim: Math.PI / 2 }));
  }
  assert.ok(player.y > HOUSE.y0 + 10 && player.y < 900, `y ${player.y}`);
});

test('bala é barrada pela parede da casa', () => {
  const wall = OBSTACLES.find(
    (obstacle) =>
      obstacle.kind === 'wall' && obstacle.y === HOUSE.y0 && Math.abs(obstacle.x - 1100) < 20,
  );
  assert.ok(wall);
  const t = segmentCircleHit(
    wall.x,
    wall.y - 60,
    wall.x,
    wall.y + 60,
    wall.x,
    wall.y,
    wall.radius + 3.5,
  );
  assert.ok(t !== null && t > 0 && t < 1);
});

test('spawns de power-up e de jogador ficam fora das paredes', () => {
  for (const point of POWERUP.spawnPoints) {
    assert.ok(!pointBlockedByObstacle(point.x, point.y, 20), `powerup (${point.x},${point.y})`);
  }
  for (const point of SPAWN_POINTS) {
    assert.ok(
      !pointBlockedByObstacle(point.x, point.y, PLAYER.radius),
      `spawn (${point.x},${point.y})`,
    );
  }
});
