import assert from 'node:assert/strict';
import test from 'node:test';
import { ARENA, GRENADE, PLAYER, POWERUP } from './constants.js';
import { HOUSE, HOUSE_DOORS, OBSTACLES, SPAWN_POINTS } from './map.js';
import {
  createPlayerPhysics,
  explosionBlockedByWall,
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
  const player = createPlayerPhysics(1100, 490, Math.PI / 2);
  for (let i = 0; i < 120; i += 1) {
    stepPlayerPhysics(player, input({ move: 2, aim: Math.PI / 2 }));
  }
  // Parede norte em y=590 (círculos r22): para em ~553 sem atravessar.
  assert.ok(player.y < 580 && player.y > 520, `y ${player.y}`);
});

test('porta da casa deixa o jogador entrar (para no vestíbulo)', () => {
  const player = createPlayerPhysics(1200, 490, Math.PI / 2);
  for (let i = 0; i < 45; i += 1) {
    stepPlayerPhysics(player, input({ move: 2, aim: Math.PI / 2 }));
  }
  // Entra pela porta N (y=590) e para na parede cheia do fundo do vestíbulo.
  assert.ok(player.y > HOUSE.y0 + 10 && player.y < 690, `y ${player.y}`);
});

test('paredes externas não têm fresta e os vãos das portas abrem', () => {
  const gapsOf = (side: string): Array<{ from: number; to: number }> =>
    HOUSE_DOORS.filter((door) => door.side === side).map((door) => ({
      from: door.from,
      to: door.to,
    }));
  const sweep = (
    fixed: number,
    from: number,
    to: number,
    horizontal: boolean,
    gaps: Array<{ from: number; to: number }>,
  ): void => {
    for (let p = from; p <= to; p += 10) {
      const x = horizontal ? p : fixed;
      const y = horizontal ? fixed : p;
      const inGap = gaps.some((gap) => p > gap.from && p < gap.to);
      if (inGap) {
        const core = gaps.some((gap) => p > gap.from + 30 && p < gap.to - 30);
        if (core) assert.ok(!pointBlockedByObstacle(x, y, 0), `vão fechado em ${x},${y}`);
      } else {
        assert.ok(pointBlockedByObstacle(x, y, 0), `furo na parede em ${x},${y}`);
      }
    }
  };
  sweep(HOUSE.y0, HOUSE.x0, HOUSE.x1, true, gapsOf('N'));
  sweep(HOUSE.y1, HOUSE.x0, HOUSE.x1, true, gapsOf('S'));
  sweep(HOUSE.x0, HOUSE.y0, HOUSE.y1, false, gapsOf('W'));
  sweep(HOUSE.x1, HOUSE.y0, HOUSE.y1, false, gapsOf('E'));
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

test('vestíbulo N contém explosão: interior fora do raio e atrás de parede', () => {
  // Granada jogada de fora morre no fundo do vestíbulo (~640); o interior
  // principal (900) fica além do raio e com a parede cheia no caminho.
  const dist = Math.hypot(1200 - 1200, 900 - 640);
  assert.ok(dist > GRENADE.explosionRadius, `dist ${dist}`);
  assert.ok(explosionBlockedByWall(1200, 640, 1200, 900));
});

test('vestíbulo S contém explosão: interior fora do raio e atrás de parede', () => {
  const dist = Math.hypot(1200 - 1200, 700 - 960);
  assert.ok(dist > GRENADE.explosionRadius, `dist ${dist}`);
  assert.ok(explosionBlockedByWall(1200, 960, 1200, 700));
});

test('porta aberta não blinda granada lançada de fora para o vestíbulo', () => {
  assert.ok(!explosionBlockedByWall(1200, 500, 1200, 640));
  assert.ok(!explosionBlockedByWall(1200, 1100, 1200, 960));
});

test('saídas laterais dos vestíbulos são passáveis', () => {
  assert.ok(!pointBlockedByObstacle(1110, 650, PLAYER.radius), 'saída N');
  assert.ok(!pointBlockedByObstacle(1290, 950, PLAYER.radius), 'saída S');
});

test('pedra e árvore não blindam explosão (só parede da casa)', () => {
  const rock = OBSTACLES.find((obstacle) => obstacle.id === 0);
  assert.ok(rock && rock.kind === 'rock');
  // Segmento atravessa a pedra de um lado ao outro: sem parede, sem blindagem.
  assert.ok(!explosionBlockedByWall(rock.x, rock.y - rock.radius - 30, rock.x, rock.y + rock.radius + 30));
});
