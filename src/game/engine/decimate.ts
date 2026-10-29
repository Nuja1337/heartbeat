// Thins the cursor stream before it reaches the session (PLAN-2 5.1). Pure.
//
// A high-rate mouse sends 8000 samples a second, and the replay would log every one. A move that comes within
// MIN_GAP_MS of the last move that was passed on is held as pending instead, and a newer one replaces it. The
// pending sample goes out before any press, release, advance or pause, so the session always sees the newest
// position before it judges anything. The drawn cursor does not use this path: it follows every sample.

import { TRACE } from '../../shared/catalog';
import type { InputSlot, Vec2 } from '../../shared/types';

/** At most TRACE.maxSampleHz samples a second pass. */
export const MIN_GAP_MS = 1000 / TRACE.maxSampleHz;

/** The part of GameSession that the decimator drives. */
export interface DecimatorTarget {
  move(t: number, pos: Vec2): void;
  press(slot: InputSlot, t: number, pos: Vec2 | null): void;
  release(slot: InputSlot, t: number): void;
  advance(t: number): void;
  notePause(t: number): void;
}

export class Decimator {
  private lastT = -Infinity;
  private pending = false;
  private pendT = 0;
  private pos: Vec2 = { x: 0, y: 0 };
  private out: Vec2 = { x: 0, y: 0 };

  constructor(private target: DecimatorTarget) {}

  /** A cursor sample. It is passed on at once or held as pending. No allocation. */
  move(t: number, x: number, y: number): void {
    if (t - this.lastT >= MIN_GAP_MS) {
      this.pending = false;
      this.send(t, x, y);
    } else {
      this.pending = true;
      this.pendT = t;
      this.pos.x = x;
      this.pos.y = y;
    }
  }

  /** Pass on the pending sample, if there is one. */
  flush(): void {
    if (!this.pending) return;
    this.pending = false;
    this.send(this.pendT, this.pos.x, this.pos.y);
  }

  /** A sample that must reach the session now, such as the position at the start of a play. */
  moveNow(t: number, x: number, y: number): void {
    this.flush();
    this.send(t, x, y);
  }

  press(slot: InputSlot, t: number, x: number | null, y: number | null): void {
    this.flush();
    if (x === null || y === null) {
      this.target.press(slot, t, null);
    } else {
      this.out.x = x;
      this.out.y = y;
      this.target.press(slot, t, this.out);
    }
  }

  release(slot: InputSlot, t: number): void {
    this.flush();
    this.target.release(slot, t);
  }

  advance(t: number): void {
    this.flush();
    this.target.advance(t);
  }

  notePause(t: number): void {
    this.flush();
    this.target.notePause(t);
  }

  private send(t: number, x: number, y: number): void {
    this.lastT = t;
    this.out.x = x;
    this.out.y = y;
    this.target.move(t, this.out);
  }
}
