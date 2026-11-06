import { OBSTACLES, TICK_DT, WEAPONS, obstaclesFor, stepPlayerPhysics } from '@vava/shared';
import type { MapId, Obstacle, PlayerInput, PlayerPhysics, SelfState } from '@vava/shared';

function clampOffset(value: number): number {
  return Math.max(-120, Math.min(120, value));
}

export class Predictor {
  private physicsState: PlayerPhysics | null = null;
  private pending: PlayerInput[] = [];
  private offset = { x: 0, y: 0 };
  alive = false;
  private speed = 225;
  private weapon = 'pistol';
  private speedBoost = 0;
  private giant = 0;
  private obstacles: readonly Obstacle[] = OBSTACLES;

  /** Física local segue o mapa votado (mesmos obstáculos do servidor). */
  setMap(map: MapId): void {
    this.obstacles = obstaclesFor(map);
  }

  get state(): PlayerPhysics | null {
    return this.physicsState;
  }

  /** Mesma regra do servidor (room.ts effectiveMoveSpeed): arma × boost × gigante. */
  private effectiveSpeed(): number {
    const base = (WEAPONS as any)[this.weapon]?.speed ?? 225;
    return base * (this.speedBoost > 0 ? 1.5 : 1) * (this.giant > 0 ? 0.9 : 1);
  }

  applyServerState(self: SelfState): void {
    const wasAlive = this.alive;
    this.alive = self.alive;
    this.weapon = self.weapon;
    this.speedBoost = self.speedBoost;
    this.giant = self.giant;
    this.speed = this.effectiveSpeed();

    if (!this.physicsState) {
      this.physicsState = {
        x: self.x,
        y: self.y,
        vx: self.vx,
        vy: self.vy,
        aim: self.aim,
        dashTime: self.dashTime,
        dashCooldown: self.dashCooldown,
      };
      this.pending = [];
      this.offset = { x: 0, y: 0 };
      return;
    }

    if (!self.alive || !wasAlive) {
      // Morte ou respawn: não tenta suavizar nem reaplicar inputs antigos.
      this.physicsState = {
        x: self.x,
        y: self.y,
        vx: self.vx,
        vy: self.vy,
        aim: self.aim,
        dashTime: self.dashTime,
        dashCooldown: self.dashCooldown,
      };
      this.pending = [];
      this.offset = { x: 0, y: 0 };
      return;
    }

    const oldX = this.physicsState.x;
    const oldY = this.physicsState.y;

    this.physicsState = {
      x: self.x,
      y: self.y,
      vx: self.vx,
      vy: self.vy,
      aim: self.aim,
      dashTime: self.dashTime,
      dashCooldown: self.dashCooldown,
    };

    this.pending = this.pending.filter((input) => input.seq > self.ack);
    for (const input of this.pending) {
      // Replay espelha o servidor (room.ts updatePlayer): o timer decai por
      // tick, então a velocidade pode cair no meio dos pendentes (R4: sem
      // isso a expiração dentro da janela de latência virava skew de ~1 tick).
      this.speedBoost = Math.max(0, this.speedBoost - TICK_DT);
      this.giant = Math.max(0, this.giant - TICK_DT);
      this.speed = this.effectiveSpeed();
      stepPlayerPhysics(this.physicsState, input, TICK_DT, this.obstacles, this.speed);
    }

    const dx = oldX - this.physicsState.x;
    const dy = oldY - this.physicsState.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 200) {
      this.offset = { x: 0, y: 0 };
    } else {
      this.offset.x = clampOffset(this.offset.x + dx);
      this.offset.y = clampOffset(this.offset.y + dy);
    }
  }

  step(input: PlayerInput): void {
    if (!this.physicsState || !this.alive) return;
    // Expiração local como no servidor (que decrementa por tick): sem isso o
    // preditor ficava em 1.5x para sempre após o snapshot (R4).
    this.speedBoost = Math.max(0, this.speedBoost - TICK_DT);
    this.giant = Math.max(0, this.giant - TICK_DT);
    this.speed = this.effectiveSpeed();
    this.pending.push(input);
    if (this.pending.length > 600) this.pending.splice(0, 300);
    stepPlayerPhysics(this.physicsState, input, TICK_DT, this.obstacles, this.speed);
  }

  reset(): void {
    this.physicsState = null;
    this.pending = [];
    this.offset = { x: 0, y: 0 };
    this.alive = false;
    this.speed = 225;
    this.weapon = 'pistol';
    this.speedBoost = 0;
    this.giant = 0;
  }

  update(dt: number): void {
    const decay = Math.exp(-12 * dt);
    this.offset.x *= decay;
    this.offset.y *= decay;
    if (Math.abs(this.offset.x) < 0.01) this.offset.x = 0;
    if (Math.abs(this.offset.y) < 0.01) this.offset.y = 0;
  }

  renderPosition(): { x: number; y: number } | null {
    if (!this.physicsState) return null;
    return {
      x: this.physicsState.x + this.offset.x,
      y: this.physicsState.y + this.offset.y,
    };
  }
}
