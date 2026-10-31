import { MOVE } from '@vava/shared';
import type { PlayerInput } from '@vava/shared';

const MOVE_KEYS: Record<string, number> = {
  KeyW: MOVE.up,
  ArrowUp: MOVE.up,
  KeyS: MOVE.down,
  ArrowDown: MOVE.down,
  KeyA: MOVE.left,
  ArrowLeft: MOVE.left,
  KeyD: MOVE.right,
  ArrowRight: MOVE.right,
};

export class InputManager {
  private enabled = false;
  private readonly keys = new Set<string>();
  private mouseX = 0;
  private mouseY = 0;
  private shooting = false;
  private dashQueued = false;
  private reloadQueued = false;
  private grenadeQueued = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.mouseX = window.innerWidth / 2;
    this.mouseY = window.innerHeight / 2;

    window.addEventListener('keydown', (event) => this.onKeyDown(event));
    window.addEventListener('keyup', (event) => this.onKeyUp(event));
    window.addEventListener('pointermove', (event) => {
      this.mouseX = event.clientX;
      this.mouseY = event.clientY;
    });
    window.addEventListener('pointerup', (event) => {
      if (event.button === 0) this.shooting = false;
    });
    window.addEventListener('pointercancel', () => {
      this.shooting = false;
    });
    window.addEventListener('blur', () => this.releaseAll());

    this.canvas.addEventListener('pointerdown', (event) => {
      if (!this.enabled) return;
      if (event.button !== 0) return;
      event.preventDefault();
      this.shooting = true;
    });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.releaseAll();
  }

  getMouse(): { x: number; y: number } {
    return { x: this.mouseX, y: this.mouseY };
  }

  sample(seq: number, aim: number): PlayerInput {
    const input: PlayerInput = {
      seq,
      move: this.moveMask(),
      aim,
      shoot: this.shooting,
      reload: this.reloadQueued,
      dash: this.dashQueued,
      grenade: this.grenadeQueued,
    };
    this.reloadQueued = false;
    this.dashQueued = false;
    this.grenadeQueued = false;
    return input;
  }

  private onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (!this.enabled) return;

    if (MOVE_KEYS[event.code] !== undefined) {
      this.keys.add(event.code);
      event.preventDefault();
      return;
    }

    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight' || event.code === 'Space') {
      if (!event.repeat) this.dashQueued = true;
      event.preventDefault();
      return;
    }

    if (event.code === 'KeyR') {
      if (!event.repeat) this.reloadQueued = true;
      event.preventDefault();
    }

    if (event.code === 'KeyG') {
      if (!event.repeat) this.grenadeQueued = true;
      event.preventDefault();
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (MOVE_KEYS[event.code] !== undefined) {
      this.keys.delete(event.code);
    }
  }

  private moveMask(): number {
    let mask = 0;
    for (const code of this.keys) {
      mask |= MOVE_KEYS[code] ?? 0;
    }
    return mask;
  }

  private releaseAll(): void {
    this.keys.clear();
    this.shooting = false;
    this.reloadQueued = false;
    this.dashQueued = false;
    this.grenadeQueued = false;
  }
}
