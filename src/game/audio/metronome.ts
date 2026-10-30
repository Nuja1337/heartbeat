// The metronome (PLAN-2 5.5). Clicks are scheduled on the audio clock a little ahead of play time, so they stay
// steady while frames are late. Output only: nothing here feeds the session.

import type { MetronomeMode } from '../../shared/types';
import type { Bus } from './sounds';

/** Beats per bar. A downbeat is every fourth beat. */
export const BEATS_PER_BAR = 4;
/** How far ahead of play time clicks are scheduled, ms. */
export const LOOKAHEAD_MS = 150;
/** A click that would start more than this long ago is skipped, ms. */
export const LATE_SKIP_MS = 5;
/** Click sources that can be live at once. A pause stops them all. */
export const POOL_SIZE = 8;

/** +3 dB as a gain factor. */
const DOWNBEAT_GAIN = 1.4125;

/**
 * Times of the beats in [from, to) for a grid with beat 0 at `offset`, in the grid's own clock. Beats before beat 0
 * are not part of the grid. `bar` keeps only every fourth beat and `off` none. The result goes into `out` (cleared
 * first), so a caller that runs every frame allocates nothing.
 */
export function beatsInWindow(
  beatMs: number,
  offset: number,
  from: number,
  to: number,
  mode: MetronomeMode,
  out: number[] = [],
): number[] {
  out.length = 0;
  if (mode === 'off' || !(beatMs > 0) || !(to > from)) return out;
  const stride = mode === 'bar' ? BEATS_PER_BAR : 1;
  // First index at or after `from`, rounded up to the stride.
  let n = Math.max(0, Math.ceil((from - offset) / beatMs - 1e-9));
  n = Math.ceil(n / stride) * stride;
  for (; ; n += stride) {
    const t = offset + n * beatMs;
    if (t >= to - 1e-9) break;
    out.push(t);
  }
  return out;
}

/** True when the beat at time `t` on the grid is the first of a bar. */
export function isDownbeat(beatMs: number, offset: number, t: number): boolean {
  return Math.round((t - offset) / beatMs) % BEATS_PER_BAR === 0;
}

/** The reading `AudioContext.getOutputTimestamp()` gives. */
export interface OutputStamp {
  contextTime: number;
  performanceTime: number;
}

/**
 * Where on the audio clock a moment given on the `performance.now()` clock falls. With an output timestamp it is
 * `contextTime + (perfT - performanceTime) / 1000`. Without one, which is a browser that lacks the call or has not
 * started its output yet, it is `currentTime + (perfT - perfNow) / 1000`.
 */
export function toContextTime(perfT: number, stamp: OutputStamp | null, currentTime: number, perfNow: number): number {
  if (stamp && stamp.performanceTime > 0) return stamp.contextTime + (perfT - stamp.performanceTime) / 1000;
  return currentTime + (perfT - perfNow) / 1000;
}

/** What the scheduler needs to know about the map. */
export interface Grid {
  beatMs: number;
  /** Play time of beat 0. Absent means the map has no steady beat and the metronome stays silent. */
  beatOffsetMs: number | undefined;
}

interface Slot {
  osc: OscillatorNode | null;
  src: AudioBufferSourceNode | null;
}

export class Metronome {
  private beats: number[] = [];
  private pool: Slot[] = [];
  private next = 0;
  /** Everything before this start time (play time, ms) has been scheduled or passed over. */
  private done = -Infinity;
  private stamp: OutputStamp = { contextTime: 0, performanceTime: 0 };

  constructor() {
    for (let i = 0; i < POOL_SIZE; i++) this.pool.push({ osc: null, src: null });
  }

  /**
   * Schedule the clicks that start in the next 150 ms of play time. `playT` is play time now and `perfNow` is
   * `performance.now()` at the same moment, which is the whole map from play time to the clock: a beat at play time
   * `b` is at `perfNow + (b - playT)`. A click starts `offsetMs` early.
   */
  update(bus: Bus, grid: Grid, mode: MetronomeMode, offsetMs: number, playT: number, perfNow: number): void {
    if (mode === 'off' || grid.beatOffsetMs === undefined) return;
    // Start times in [lo, hi), in play time. The beats behind them are `offsetMs` later.
    const lo = Math.max(this.done, playT - LATE_SKIP_MS);
    const hi = playT + LOOKAHEAD_MS;
    if (hi <= lo) return;
    this.done = hi;
    const beats = beatsInWindow(grid.beatMs, grid.beatOffsetMs, lo + offsetMs, hi + offsetMs, mode, this.beats);
    if (beats.length === 0) return;
    const ctx = bus.ctx;
    const s = this.stamp;
    let got: OutputStamp | null = null;
    if (typeof ctx.getOutputTimestamp === 'function') {
      const o = ctx.getOutputTimestamp();
      s.contextTime = o.contextTime ?? 0;
      s.performanceTime = o.performanceTime ?? 0;
      got = s;
    }
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i] as number;
      const at = toContextTime(perfNow + (b - playT), got, ctx.currentTime, perfNow) - offsetMs / 1000;
      this.click(bus, at, isDownbeat(grid.beatMs, grid.beatOffsetMs, b));
    }
  }

  /** Stop what is scheduled, for a pause. After a resume the scheduler starts again from the new play time. */
  stop(): void {
    this.done = -Infinity;
    for (const slot of this.pool) {
      try {
        slot.osc?.stop();
        slot.src?.stop();
      } catch {
        // Already stopped.
      }
      slot.osc = null;
      slot.src = null;
    }
  }

  /** One click at context time `at`: bandpass noise and a sine, louder and higher on a downbeat. */
  private click(bus: Bus, at: number, downbeat: boolean): void {
    const ctx = bus.ctx;
    const t = Math.max(at, ctx.currentTime);
    const k = downbeat ? DOWNBEAT_GAIN : 1;
    const slot = this.pool[this.next] as Slot;
    this.next = (this.next + 1) % POOL_SIZE;

    const src = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    const ng = ctx.createGain();
    src.buffer = bus.noise;
    f.type = 'bandpass';
    f.frequency.value = 3000;
    f.Q.value = 2;
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.3 * k, t + 0.001);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.01);
    src.connect(f);
    f.connect(ng);
    ng.connect(bus.metronome);
    src.onended = () => {
      src.disconnect();
      f.disconnect();
      ng.disconnect();
    };
    // A fixed stretch of the noise buffer, so every click sounds the same.
    src.start(t, 0.1, 0.012);

    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = downbeat ? 2200 : 1600;
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(0.15 * k, t + 0.001);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.014);
    osc.connect(og);
    og.connect(bus.metronome);
    osc.onended = () => {
      osc.disconnect();
      og.disconnect();
    };
    osc.start(t);
    osc.stop(t + 0.02);

    slot.osc = osc;
    slot.src = src;
  }

  /** One click now, for the settings page. */
  clickNow(bus: Bus, downbeat: boolean, delay = 0): void {
    this.click(bus, bus.ctx.currentTime + delay, downbeat);
  }
}
