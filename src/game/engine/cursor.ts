// Cursor sample history and the held-button log. Pure, so Node tests can use it.

import type { Vec2 } from '../../shared/types';

/** Ring buffer of cursor samples in playfield units. */
export class CursorBuffer {
  private ts: Float64Array;
  private xs: Float64Array;
  private ys: Float64Array;
  private start = 0;
  size = 0;
  lastT = 0;
  lastX = 0;
  lastY = 0;

  constructor(readonly capacity = 4096) {
    this.ts = new Float64Array(capacity);
    this.xs = new Float64Array(capacity);
    this.ys = new Float64Array(capacity);
  }

  clear(): void {
    this.start = 0;
    this.size = 0;
  }

  push(t: number, x: number, y: number): void {
    // Samples must not go back in time. A late timestamp is held at the last one.
    if (this.size > 0 && t < this.lastT) t = this.lastT;
    let at: number;
    if (this.size < this.capacity) {
      at = (this.start + this.size) % this.capacity;
      this.size++;
    } else {
      at = this.start;
      this.start = (this.start + 1) % this.capacity;
    }
    this.ts[at] = t;
    this.xs[at] = x;
    this.ys[at] = y;
    this.lastT = t;
    this.lastX = x;
    this.lastY = y;
  }

  /** Sample i counted from the oldest one kept. */
  tAt(i: number): number {
    return this.ts[(this.start + i) % this.capacity] as number;
  }
  xAt(i: number): number {
    return this.xs[(this.start + i) % this.capacity] as number;
  }
  yAt(i: number): number {
    return this.ys[(this.start + i) % this.capacity] as number;
  }

  /** Index of the first sample with time >= t, or size when every sample is older. */
  lowerBound(t: number): number {
    let lo = 0;
    let hi = this.size;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.tAt(mid) < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Cursor position at time t, interpolated between samples. Outside the kept range it uses the nearest sample. */
  positionAt(t: number, out: Vec2): Vec2 {
    if (this.size === 0) {
      out.x = 0;
      out.y = 0;
      return out;
    }
    const i = this.lowerBound(t);
    if (i === 0) {
      out.x = this.xAt(0);
      out.y = this.yAt(0);
      return out;
    }
    if (i >= this.size) {
      out.x = this.lastX;
      out.y = this.lastY;
      return out;
    }
    const t0 = this.tAt(i - 1);
    const t1 = this.tAt(i);
    const u = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
    const x0 = this.xAt(i - 1);
    const y0 = this.yAt(i - 1);
    out.x = x0 + (this.xAt(i) - x0) * u;
    out.y = y0 + (this.yAt(i) - y0) * u;
    return out;
  }
}

/** Recent changes of the held-input mask, so a slider can ask what was held at a past time. */
export class HoldLog {
  private ts = new Float64Array(128);
  private masks = new Uint8Array(128);
  private n = 0;
  private head = 0;

  /** Record the mask that applies from time t on. */
  set(t: number, mask: number): void {
    if (this.n > 0) {
      const last = (this.head + this.n - 1) % 128;
      if (this.masks[last] === mask) return;
      if (t < (this.ts[last] as number)) t = this.ts[last] as number;
    }
    let at: number;
    if (this.n < 128) {
      at = (this.head + this.n) % 128;
      this.n++;
    } else {
      at = this.head;
      this.head = (this.head + 1) % 128;
    }
    this.ts[at] = t;
    this.masks[at] = mask;
  }

  maskAt(t: number): number {
    for (let k = this.n - 1; k >= 0; k--) {
      const at = (this.head + k) % 128;
      if ((this.ts[at] as number) <= t) return this.masks[at] as number;
    }
    return 0;
  }

  heldAt(t: number): boolean {
    return this.maskAt(t) !== 0;
  }

  reset(): void {
    this.n = 0;
    this.head = 0;
  }
}
