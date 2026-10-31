import { ARENA, clamp } from '@vava/shared';

export class Camera {
  x = ARENA.width / 2;
  y = ARENA.height / 2;
  scale = 1;
  private initialized = false;

  updateScale(viewWidth: number, viewHeight: number): void {
    this.scale = clamp(Math.min(viewWidth / 1366, viewHeight / 768), 1, 1.6);
  }

  snapTo(x: number, y: number, aim: number, viewWidth: number, viewHeight: number): void {
    this.updateScale(viewWidth, viewHeight);
    const target = this.target(x, y, aim, viewWidth, viewHeight);
    this.x = target.x;
    this.y = target.y;
    this.initialized = true;
  }

  follow(
    dt: number,
    x: number,
    y: number,
    aim: number,
    viewWidth: number,
    viewHeight: number,
  ): void {
    this.updateScale(viewWidth, viewHeight);
    const target = this.target(x, y, aim, viewWidth, viewHeight);

    if (!this.initialized) {
      this.x = target.x;
      this.y = target.y;
      this.initialized = true;
      return;
    }

    const smoothing = 1 - Math.exp(-9 * dt);
    this.x += (target.x - this.x) * smoothing;
    this.y += (target.y - this.y) * smoothing;
  }

  idle(now: number, viewWidth: number, viewHeight: number): void {
    this.updateScale(viewWidth, viewHeight);
    this.x = ARENA.width / 2 + Math.sin(now * 0.00007) * 90;
    this.y = ARENA.height / 2 + Math.cos(now * 0.00009) * 45;
    this.initialized = false;
  }

  private target(
    x: number,
    y: number,
    aim: number,
    viewWidth: number,
    viewHeight: number,
  ): { x: number; y: number } {
    const lookAhead = 58;
    const desiredX = x + Math.cos(aim) * lookAhead;
    const desiredY = y + Math.sin(aim) * lookAhead;

    const halfWidth = viewWidth / (2 * this.scale);
    const halfHeight = viewHeight / (2 * this.scale);

    const minX = halfWidth;
    const maxX = ARENA.width - halfWidth;
    const minY = halfHeight;
    const maxY = ARENA.height - halfHeight;

    return {
      x: minX > maxX ? ARENA.width / 2 : clamp(desiredX, minX, maxX),
      y: minY > maxY ? ARENA.height / 2 : clamp(desiredY, minY, maxY),
    };
  }
}
