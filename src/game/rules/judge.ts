// Press resolution and circle judgment (PLAN section 5).

import type { HitWindows, InputSlot, Judgment, Ms } from '../../shared/types';

/** Smallest data the judge needs about a tap target. */
export interface Target {
  time: Ms;
  x: number;
  y: number;
  radius: number;
  windows: HitWindows;
  /** True once the circle, or a slider head, has its judgment. */
  judged: boolean;
}

export type TimingClass = Judgment | 'early' | null;

/** Judgment for a press error (press time minus object time). null means the press is too early to count. */
export function classifyError(error: Ms, w: HitWindows): TimingClass {
  const a = error < 0 ? -error : error;
  if (a <= w.crisp) return 'crisp';
  if (a <= w.solid) return 'solid';
  if (a <= w.rough) return 'rough';
  if (error < 0 && error >= -w.early) return 'early';
  return null;
}

export function insideTarget(px: number, py: number, t: Target): boolean {
  const dx = px - t.x;
  const dy = py - t.y;
  return dx * dx + dy * dy <= t.radius * t.radius;
}

/** How far outside its rough window a missed target stays open before it expires. */
export const EXPIRE_GRACE_MS = 15;
/** A stray press counts toward an aim miss when it falls within this many radii of the target. */
export const AIM_MISS_RADII = 3;

export function expiryTime(t: Target): Ms {
  return t.time + t.windows.rough + EXPIRE_GRACE_MS;
}

export interface PressResolution {
  kind: 'hit' | 'early' | 'absorbed' | 'stray';
  /** The target that was hit, or hit too early. -1 otherwise. */
  index: number;
  /** Press time minus the target's time. */
  error: Ms;
  /** Earlier targets passed over by this press. They become misses. */
  skipped: number[];
  /** Stray presses only. Targets whose window was open and within three radii of the press. */
  near: number[];
}

const NONE: number[] = [];

/**
 * Decide what a press does. `from` is the index of the first target that may still be open.
 * Targets must be sorted by time.
 */
export function resolvePress(targets: readonly Target[], from: number, pressT: Ms, px: number, py: number): PressResolution {
  let chosen = -1;
  let ahead = false;
  const open: number[] = [];
  for (let i = from; i < targets.length; i++) {
    const t = targets[i] as Target;
    if (t.time - 400 > pressT) break;
    if (t.judged) continue;
    const err = pressT - t.time;
    if (err > t.windows.rough || err < -t.windows.early) continue;
    if (insideTarget(px, py, t)) {
      chosen = i;
      break;
    }
    open.push(i);
    if (t.time > pressT) ahead = true;
  }
  if (chosen >= 0) {
    const target = targets[chosen] as Target;
    if (ahead) return { kind: 'absorbed', index: -1, error: pressT - target.time, skipped: NONE, near: NONE };
    const error = pressT - target.time;
    const skipped = open;
    return { kind: error < -target.windows.rough ? 'early' : 'hit', index: chosen, error, skipped, near: NONE };
  }
  const near: number[] = [];
  const lim = AIM_MISS_RADII;
  for (const i of open) {
    const t = targets[i] as Target;
    const err = pressT - t.time;
    if (err < -t.windows.rough) continue;
    const dx = px - t.x;
    const dy = py - t.y;
    if (dx * dx + dy * dy <= lim * lim * t.radius * t.radius) near.push(i);
  }
  return { kind: 'stray', index: -1, error: 0, skipped: NONE, near };
}

/** A press that came close to a target without touching it. The nearest one is kept for the record. */
export interface AimPress {
  t: Ms;
  x: number;
  y: number;
  dist: number;
  slot: InputSlot;
}

export function nearestAimPress(current: AimPress | null, next: AimPress): AimPress {
  return current === null || next.dist < current.dist ? next : current;
}
