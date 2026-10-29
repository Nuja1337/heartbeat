// Spinner rotation, rpm and judgment (PLAN section 5).

import type { Judgment, MissReason, Ms, SpinnerObject, SpinnerStats } from '../../shared/types';

export const SPIN_DEAD_ZONE = 12;
/** Fastest rotation that counts, in turns per second. */
export const SPIN_MAX_TURNS_PER_SEC = 10;
const BIN_MS = 10;
const RPM_WINDOW_BINS = 50;
const TAU = Math.PI * 2;

function wrapAngle(d: number): number {
  while (d > Math.PI) d -= TAU;
  while (d <= -Math.PI) d += TAU;
  return d;
}

export function spinnerJudgment(q: number): Judgment {
  if (q >= 1) return 'crisp';
  if (q >= 0.75) return 'solid';
  if (q >= 0.5) return 'rough';
  return 'miss';
}

export class SpinnerRun {
  private sum = 0;
  private refAngle = 0;
  private refT = 0;
  private refValid = false;
  private lastT: Ms;
  private lastHeld = false;
  heldMs = 0;
  peakRpm = 0;
  bonus = 0;
  completed = false;
  private bins: Float32Array;
  private filled = 0;
  private cx: number;
  private cy: number;

  constructor(readonly obj: SpinnerObject) {
    this.lastT = obj.time;
    this.bins = new Float32Array(Math.ceil((obj.endTime - obj.time) / BIN_MS) + 2);
    this.cx = obj.pos.x;
    this.cy = obj.pos.y;
  }

  get rotations(): number {
    return Math.abs(this.sum) / TAU;
  }

  /** Net turn so far in radians. Positive is clockwise on screen. */
  get signedAngle(): number {
    return this.sum;
  }

  /** Feed one cursor sample, or a change of the held state, at time t. */
  update(t: Ms, x: number, y: number, held: boolean): void {
    const o = this.obj;
    if (t < o.time) return;
    if (t > o.endTime) t = o.endTime;
    if (this.lastHeld) this.heldMs += Math.max(0, t - this.lastT);
    this.lastT = t;
    this.lastHeld = held;
    if (!held) {
      this.refValid = false;
    } else {
      const dx = x - this.cx;
      const dy = y - this.cy;
      if (dx * dx + dy * dy < SPIN_DEAD_ZONE * SPIN_DEAD_ZONE) {
        this.refValid = false;
      } else {
        const a = Math.atan2(dy, dx);
        if (this.refValid) {
          const dt = t - this.refT;
          if (dt > 0) {
            let d = wrapAngle(a - this.refAngle);
            const lim = (TAU * SPIN_MAX_TURNS_PER_SEC * dt) / 1000;
            if (d > lim) d = lim;
            else if (d < -lim) d = -lim;
            this.sum += d;
          }
        }
        this.refAngle = a;
        this.refT = t;
        this.refValid = true;
      }
    }
    this.fillBins(t);
    const r = this.rotations;
    const req = o.rotationsRequired;
    if (!this.completed && r >= req) this.completed = true;
    const b = Math.max(0, Math.floor(r - req));
    if (b > this.bonus) this.bonus = b;
  }

  private fillBins(t: Ms): void {
    const k = Math.min(this.bins.length - 1, Math.floor((t - this.obj.time) / BIN_MS));
    for (let j = this.filled; j <= k; j++) this.bins[j] = this.sum;
    if (k + 1 > this.filled) this.filled = k + 1;
    if (k >= RPM_WINDOW_BINS) {
      const d = Math.abs((this.bins[k] as number) - (this.bins[k - RPM_WINDOW_BINS] as number));
      const rpm = (d / TAU) * 120;
      if (rpm > this.peakRpm) this.peakRpm = rpm;
    }
  }

  /** Rolling 500 ms rpm at time t. */
  rpmAt(t: Ms): number {
    const k = Math.min(this.filled - 1, Math.floor((t - this.obj.time) / BIN_MS));
    if (k < 1) return 0;
    const back = Math.min(k, RPM_WINDOW_BINS);
    const d = Math.abs((this.bins[k] as number) - (this.bins[k - back] as number));
    return (d / TAU) * (60000 / (back * BIN_MS));
  }

  judgment(): { judgment: Judgment; missReason: MissReason | null } {
    const q = this.obj.rotationsRequired > 0 ? this.rotations / this.obj.rotationsRequired : 1;
    const j = spinnerJudgment(q);
    return { judgment: j, missReason: j === 'miss' ? 'spin' : null };
  }

  stats(): SpinnerStats {
    const o = this.obj;
    const durationMs = o.endTime - o.time;
    const meanRpm = this.heldMs > 0 ? this.rotations / (this.heldMs / 60000) : 0;
    // Spread of rpm over 100 ms samples in the middle 80% of the spinner.
    const bins = Math.floor(durationMs / BIN_MS);
    const from = Math.floor(bins * 0.1);
    const to = Math.floor(bins * 0.9);
    const vals: number[] = [];
    for (let k = from; k + 10 <= to && k + 10 < this.bins.length; k += 10) {
      const d = Math.abs((this.bins[k + 10] as number) - (this.bins[k] as number));
      vals.push((d / TAU) * 600);
    }
    let sd = 0;
    if (vals.length > 1) {
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) * (b - m), 0) / vals.length);
    }
    return {
      rotations: this.rotations,
      rotationsRequired: o.rotationsRequired,
      meanRpm,
      peakRpm: this.peakRpm,
      rpmSd: sd,
      heldMs: this.heldMs,
      durationMs,
    };
  }
}
