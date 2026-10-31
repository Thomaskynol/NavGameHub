import { TICK_DT, WEAPONS, stepPlayerPhysics } from '@vava/shared';
import type { PlayerInput, PlayerPhysics, SelfState } from '@vava/shared';

function clampOffset(value: number): number {
  return Math.max(-120, Math.min(120, value));
}

export class Predictor {
  private physicsState: PlayerPhysics | null = null;
  private pending: PlayerInput[] = [];
  private offset = { x: 0, y: 0 };
  alive = false;
  private speed = 225;

  get state(): PlayerPhysics | null {
    return this.physicsState;
  }

  applyServerState(self: SelfState): void {
    const wasAlive = this.alive;
    this.alive = self.alive;
    this.speed = (WEAPONS as any)[self.weapon]?.speed ?? 225;

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
      stepPlayerPhysics(this.physicsState, input, TICK_DT, undefined, this.speed);
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
    this.pending.push(input);
    if (this.pending.length > 600) this.pending.splice(0, 300);
    stepPlayerPhysics(this.physicsState, input, TICK_DT, undefined, this.speed);
  }

  reset(): void {
    this.physicsState = null;
    this.pending = [];
    this.offset = { x: 0, y: 0 };
    this.alive = false;
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
