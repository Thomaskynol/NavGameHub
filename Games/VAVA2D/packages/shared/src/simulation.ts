import { ARENA, DUEL_ARENA, MOVE, PLAYER, TICK_DT } from './constants.js';
import { OBSTACLES } from './map.js';
import { clamp, normalizeAngle } from './math.js';
import type { Obstacle, PlayerInput, PlayerPhysics } from './types.js';

export function createPlayerPhysics(x: number, y: number, aim = 0): PlayerPhysics {
  return { x, y, vx: 0, vy: 0, aim, dashTime: 0, dashCooldown: 0 };
}

export function inputMovement(input: PlayerInput): { x: number; y: number; active: boolean } {
  let x = 0;
  let y = 0;
  if (input.move & MOVE.right) x += 1;
  if (input.move & MOVE.left) x -= 1;
  if (input.move & MOVE.down) y += 1;
  if (input.move & MOVE.up) y -= 1;
  const length = Math.hypot(x, y);
  if (length > 0) {
    x /= length;
    y /= length;
  }
  return { x, y, active: length > 0 };
}

function resolveObstacles(physics: PlayerPhysics, obstacles: readonly Obstacle[]): void {
  for (let pass = 0; pass < 2; pass += 1) {
    for (const obstacle of obstacles) {
      const dx = physics.x - obstacle.x;
      const dy = physics.y - obstacle.y;
      const minimum = obstacle.radius + PLAYER.radius;
      const distSq = dx * dx + dy * dy;
      if (distSq >= minimum * minimum) continue;

      const dist = Math.sqrt(distSq);
      const nx = dist > 0.0001 ? dx / dist : 1;
      const ny = dist > 0.0001 ? dy / dist : 0;
      physics.x = obstacle.x + nx * minimum;
      physics.y = obstacle.y + ny * minimum;

      const inward = physics.vx * nx + physics.vy * ny;
      if (inward < 0) {
        physics.vx -= inward * nx;
        physics.vy -= inward * ny;
      }
    }
  }
}

function inDuelRegion(x: number, y: number): boolean {
  // Duelistas vivem off-map (além de 2400x1600); qualquer posição fora do mapa
  // normal ou dentro do ringue usa o clamp do duelo.
  if (x > ARENA.width || y > ARENA.height) return true;
  return (
    x >= DUEL_ARENA.minX - 100 &&
    x <= DUEL_ARENA.maxX + 100 &&
    y >= DUEL_ARENA.minY - 100 &&
    y <= DUEL_ARENA.maxY + 100
  );
}

function resolveBounds(physics: PlayerPhysics): void {
  if (inDuelRegion(physics.x, physics.y)) {
    if (physics.x < DUEL_ARENA.minX) {
      physics.x = DUEL_ARENA.minX;
      if (physics.vx < 0) physics.vx = 0;
    } else if (physics.x > DUEL_ARENA.maxX) {
      physics.x = DUEL_ARENA.maxX;
      if (physics.vx > 0) physics.vx = 0;
    }
    if (physics.y < DUEL_ARENA.minY) {
      physics.y = DUEL_ARENA.minY;
      if (physics.vy < 0) physics.vy = 0;
    } else if (physics.y > DUEL_ARENA.maxY) {
      physics.y = DUEL_ARENA.maxY;
      if (physics.vy > 0) physics.vy = 0;
    }
    return;
  }

  const minX = ARENA.inset + PLAYER.radius;
  const maxX = ARENA.width - ARENA.inset - PLAYER.radius;
  const minY = ARENA.inset + PLAYER.radius;
  const maxY = ARENA.height - ARENA.inset - PLAYER.radius;

  if (physics.x < minX) {
    physics.x = minX;
    if (physics.vx < 0) physics.vx = 0;
  } else if (physics.x > maxX) {
    physics.x = maxX;
    if (physics.vx > 0) physics.vx = 0;
  }

  if (physics.y < minY) {
    physics.y = minY;
    if (physics.vy < 0) physics.vy = 0;
  } else if (physics.y > maxY) {
    physics.y = maxY;
    if (physics.vy > 0) physics.vy = 0;
  }
}

/**
 * Simulação de movimento idêntica no cliente (predição) e no servidor (autoridade).
 */
export function stepPlayerPhysics(
  physics: PlayerPhysics,
  input: PlayerInput,
  dt: number = TICK_DT,
  obstacles: readonly Obstacle[] = OBSTACLES,
  speed: number = PLAYER.speed,
): void {
  physics.aim = normalizeAngle(input.aim);

  const movement = inputMovement(input);
  physics.dashCooldown = Math.max(0, physics.dashCooldown - dt);
  if (physics.dashTime > 0) {
    physics.dashTime = Math.max(0, physics.dashTime - dt);
  }

  if (input.dash && physics.dashCooldown <= 0 && physics.dashTime <= 0) {
    const dirX = movement.active ? movement.x : Math.cos(physics.aim);
    const dirY = movement.active ? movement.y : Math.sin(physics.aim);
    physics.dashTime = PLAYER.dashDuration;
    physics.dashCooldown = PLAYER.dashCooldown;
    physics.vx = dirX * PLAYER.dashSpeed;
    physics.vy = dirY * PLAYER.dashSpeed;
  } else if (physics.dashTime <= 0) {
    const targetVx = movement.x * speed;
    const targetVy = movement.y * speed;
    const rate = movement.active ? PLAYER.accel : PLAYER.decel;
    const maxDelta = rate * dt;
    const deltaVx = targetVx - physics.vx;
    const deltaVy = targetVy - physics.vy;
    const deltaLength = Math.hypot(deltaVx, deltaVy);
    if (deltaLength <= maxDelta) {
      physics.vx = targetVx;
      physics.vy = targetVy;
    } else if (deltaLength > 0) {
      physics.vx += (deltaVx / deltaLength) * maxDelta;
      physics.vy += (deltaVy / deltaLength) * maxDelta;
    }
  }

  physics.x += physics.vx * dt;
  physics.y += physics.vy * dt;

  resolveObstacles(physics, obstacles);
  resolveBounds(physics);

  // Evita deriva de ponto flutuante quando parado.
  physics.vx = clamp(physics.vx, -PLAYER.dashSpeed, PLAYER.dashSpeed);
  physics.vy = clamp(physics.vy, -PLAYER.dashSpeed, PLAYER.dashSpeed);
}

/**
 * Retorna o menor t em [0, 1] em que o segmento A→B toca o círculo, ou null.
 */
export function segmentCircleHit(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  radius: number,
): number | null {
  const dx = bx - ax;
  const dy = by - ay;
  const fx = ax - cx;
  const fy = ay - cy;
  const a = dx * dx + dy * dy;

  if (a < 1e-9) {
    return fx * fx + fy * fy <= radius * radius ? 0 : null;
  }

  const c = fx * fx + fy * fy - radius * radius;
  if (c <= 0) return 0;

  const b = 2 * (fx * dx + fy * dy);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

export function pointBlockedByObstacle(
  x: number,
  y: number,
  radius = 0,
  obstacles: readonly Obstacle[] = OBSTACLES,
): boolean {
  for (const obstacle of obstacles) {
    const reach = obstacle.radius + radius;
    const dx = x - obstacle.x;
    const dy = y - obstacle.y;
    if (dx * dx + dy * dy < reach * reach) return true;
  }
  return false;
}
