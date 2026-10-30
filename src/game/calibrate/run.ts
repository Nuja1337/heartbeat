// The timing of one calibration run, with no DOM and no audio (PLAN-2 5.6). Times are on the performance.now() clock,
// the same one the event timestamps of key and pointer presses use.

import type { CalibrationResult } from '../../shared/types';

/** Time between beats, ms. */
export const BEAT_MS = 600;
/** Beats at the start that do not count. */
export const LEAD_IN_BEATS = 4;
/** Taps to collect. */
export const TAPS_NEEDED = 24;
/** A tap further than this from the nearest beat is dropped, ms. */
export const DROP_MS = 200;
/** The result uses this many of the last taps. */
export const KEEP_LAST = 20;
/** From the first press to beat 0, ms. It gives the audio output time to start. */
export const FIRST_BEAT_MS = 1200;

export interface TapStats {
  /** Median of press time minus beat time, ms. Positive = late. */
  medianMs: number;
  /** Sample standard deviation, ms. */
  sdMs: number;
  /** Taps the two numbers come from. */
  used: number;
}

/** The nearest beat to a press, as an index from beat 0 and the signed distance in ms. */
export function nearestBeat(pressT: number, firstBeat: number, beatMs: number = BEAT_MS): { index: number; error: number } {
  const index = Math.round((pressT - firstBeat) / beatMs);
  return { index, error: pressT - (firstBeat + index * beatMs) };
}

/**
 * The median and the standard deviation of the last 20 errors, after the ones further than 200 ms from a beat are
 * dropped. Errors are press time minus beat time. An empty list gives zeros.
 */
export function calibrationResult(errors: readonly number[]): TapStats {
  const kept = errors.filter((e) => Number.isFinite(e) && Math.abs(e) <= DROP_MS).slice(-KEEP_LAST);
  const n = kept.length;
  if (n === 0) return { medianMs: 0, sdMs: 0, used: 0 };
  const sorted = kept.slice().sort((a, b) => a - b);
  const mid = n >> 1;
  const medianMs = n % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  if (n === 1) return { medianMs, sdMs: 0, used: 1 };
  const mean = kept.reduce((a, b) => a + b, 0) / n;
  const variance = kept.reduce((a, e) => a + (e - mean) * (e - mean), 0) / (n - 1);
  return { medianMs, sdMs: Math.sqrt(variance), used: n };
}

export type RunState = 'ready' | 'running' | 'done';

/** What a press did. */
export type PressOutcome = 'started' | 'lead-in' | 'tap' | 'dropped' | 'finished' | 'ignored';

export class CalibrationRun {
  state: RunState = 'ready';
  /** Time of the first press, which starts the run. */
  startedAt = 0;
  /** Taps kept so far. */
  taps = 0;
  /** Error of the latest press, ms, or null before the first one. */
  lastError: number | null = null;
  /** Press time of the latest press that counted or was dropped, for a flash. */
  lastPressAt = Number.NEGATIVE_INFINITY;
  lastKept = false;
  private errors: number[] = [];

  constructor(
    readonly kind: CalibrationResult['kind'],
    readonly beatMs: number = BEAT_MS,
    readonly needed: number = TAPS_NEEDED,
  ) {}

  /** Time of beat 0 on the performance clock. */
  get firstBeat(): number {
    return this.startedAt + FIRST_BEAT_MS;
  }

  /** Back to the start screen. */
  reset(): void {
    this.state = 'ready';
    this.startedAt = 0;
    this.taps = 0;
    this.lastError = null;
    this.lastPressAt = Number.NEGATIVE_INFINITY;
    this.lastKept = false;
    this.errors.length = 0;
  }

  /** A press of a hit key or a mouse button, at its event timestamp. */
  press(ts: number): PressOutcome {
    if (this.state === 'ready') {
      this.state = 'running';
      this.startedAt = ts;
      return 'started';
    }
    if (this.state !== 'running') return 'ignored';
    const { index, error } = nearestBeat(ts, this.firstBeat, this.beatMs);
    if (index < LEAD_IN_BEATS) return 'lead-in';
    this.lastError = error;
    this.lastPressAt = ts;
    if (Math.abs(error) > DROP_MS) {
      this.lastKept = false;
      return 'dropped';
    }
    this.lastKept = true;
    this.errors.push(error);
    this.taps++;
    if (this.taps >= this.needed) {
      this.state = 'done';
      return 'finished';
    }
    return 'tap';
  }

  /** The result of the taps so far. */
  result(): CalibrationResult {
    const s = calibrationResult(this.errors);
    return { kind: this.kind, offsetMs: s.medianMs, sdMs: s.sdMs, taps: s.used };
  }

  /** Play time of the run at `now`, ms since the first press. */
  elapsed(now: number): number {
    return this.state === 'ready' ? 0 : now - this.startedAt;
  }

  /**
   * How far the approach ring has closed at `now`: 0 right after a beat and 1 on the next one. null before the first
   * ring starts, one beat ahead of beat 0.
   */
  ringProgress(now: number): number | null {
    if (this.state === 'ready') return null;
    const t = now - this.firstBeat;
    if (t < -this.beatMs) return null;
    const u = (t % this.beatMs) / this.beatMs;
    return u < 0 ? u + 1 : u;
  }

  /** The lead-in beat that comes next, 1 to LEAD_IN_BEATS, or 0 once the lead-in is over. */
  leadInBeat(now: number): number {
    if (this.state !== 'running') return 0;
    const next = Math.ceil((now - this.firstBeat) / this.beatMs - 1e-9);
    const k = Math.max(0, next);
    return k < LEAD_IN_BEATS ? k + 1 : 0;
  }
}
