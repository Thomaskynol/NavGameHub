import { INTERP_DELAY_MS, clamp } from '@vava/shared';
import type { Snapshot } from '@vava/shared';

interface BufferedSnapshot {
  recvAt: number;
  snap: Snapshot;
}

export interface SnapshotPair {
  before: Snapshot;
  after: Snapshot;
  t: number;
}

export class SnapshotInterpolator {
  private items: BufferedSnapshot[] = [];
  private renderTime = 0;
  private primed = false;

  push(snapshot: Snapshot, recvAt: number): void {
    const last = this.items[this.items.length - 1];
    if (last && snapshot.tick <= last.snap.tick) return;
    this.items.push({ recvAt, snap: snapshot });
    if (this.items.length > 64) this.items.shift();
    if (!this.primed) {
      this.renderTime = recvAt - INTERP_DELAY_MS;
      this.primed = true;
    }
  }

  advance(dtMs: number): void {
    if (!this.primed || this.items.length === 0) return;
    const latest = this.items[this.items.length - 1];
    if (!latest) return;

    this.renderTime += dtMs;
    const target = latest.recvAt - INTERP_DELAY_MS;
    const diff = target - this.renderTime;
    if (Math.abs(diff) > 250) {
      this.renderTime = target;
    } else {
      this.renderTime += diff * Math.min(1, dtMs / 120);
    }
  }

  sample(): SnapshotPair | null {
    if (this.items.length === 0) return null;
    for (let i = 1; i < this.items.length; i += 1) {
      const before = this.items[i - 1];
      const after = this.items[i];
      if (!before || !after) continue;
      if (after.recvAt >= this.renderTime) {
        const span = after.recvAt - before.recvAt;
        const t = span > 0 ? clamp((this.renderTime - before.recvAt) / span, 0, 1) : 0;
        return { before: before.snap, after: after.snap, t };
      }
    }

    const last = this.items[this.items.length - 1];
    if (!last) return null;
    return { before: last.snap, after: last.snap, t: 0 };
  }

  reset(): void {
    this.items = [];
    this.renderTime = 0;
    this.primed = false;
  }
}
