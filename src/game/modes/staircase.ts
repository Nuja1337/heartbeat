// The adaptive level controller (PLAN section 8).

import { LEVEL_LIMITS, SUCCESS_BAND } from '../../shared/catalog';

const round05 = (x: number) => Math.round(x * 20) / 20;

export interface StaircaseStep {
  played: number;
  next: number;
  direction: 'up' | 'down' | 'hold';
}

export class Staircase {
  level: number;
  step = 0.5;
  private lastDir = 0;
  /** The level of each set, as played. */
  readonly history: number[] = [];

  constructor(
    start: number,
    /** The level past which the module's map no longer changes. */
    readonly max: number = LEVEL_LIMITS.max,
  ) {
    this.level = this.clamp(round05(start));
  }

  private clamp(x: number): number {
    return Math.min(this.max, Math.max(LEVEL_LIMITS.min, x));
  }

  /** Start level for a player whose saved level is `saved`. */
  static startFor(saved: number | undefined, fallback: number, max: number = LEVEL_LIMITS.max): Staircase {
    return new Staircase(Math.max(LEVEL_LIMITS.min, (saved ?? fallback) - 0.5), max);
  }

  /** Record a set with success share p and move the level. */
  update(p: number): StaircaseStep {
    const played = this.level;
    this.history.push(played);
    let dir = 0;
    let size = 1;
    if (p >= SUCCESS_BAND.high) dir = 1;
    else if (p >= SUCCESS_BAND.low) dir = 0;
    else if (p >= 0.45) dir = -1;
    else {
      dir = -1;
      size = 2;
    }
    if (dir !== 0) {
      if (this.lastDir !== 0 && dir !== this.lastDir) this.step = Math.max(0.25, this.step / 2);
      this.lastDir = dir;
    }
    this.level = this.clamp(round05(this.level + dir * size * this.step));
    return { played, next: this.level, direction: this.level > played ? 'up' : this.level < played ? 'down' : 'hold' };
  }

  /** Mean level over the second half of the sets, or the last level with fewer than 4 sets. */
  finalLevel(): number {
    const h = this.history;
    if (h.length === 0) return this.level;
    if (h.length < 4) return h[h.length - 1] as number;
    const half = h.slice(Math.floor(h.length / 2));
    return half.reduce((a, b) => a + b, 0) / half.length;
  }
}
