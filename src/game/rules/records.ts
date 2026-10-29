// HitRecord assembly: aim decomposition and movement metrics.

import type {
  HitObject,
  HitRecord,
  InputSlot,
  Judgment,
  MissReason,
  MovementMetrics,
  ObjectFeatures,
  SliderStats,
  SpinnerStats,
  Vec2,
} from '../../shared/types';
import type { CursorBuffer } from '../engine/cursor';

export interface PressInfo {
  t: number;
  x: number;
  y: number;
  slot: InputSlot;
}

export interface RecordInput {
  obj: HitObject;
  prev: HitObject | null;
  features: ObjectFeatures;
  judgment: Judgment;
  headJudgment: Judgment | null;
  missReason: MissReason | null;
  press: PressInfo | null;
  comboBefore: number;
  afterPause: boolean;
  /** The movement window starts no earlier than this, for example at the last resume from a pause. */
  movementFrom?: number;
  cursor: CursorBuffer;
  slider: SliderStats | null;
  spinner: SpinnerStats | null;
}

/** Aim error split along and across the incoming movement. Positive along = overshoot, positive lateral = right of it. */
export function decomposeAim(hit: Vec2, center: Vec2, directionDeg: number): { along: number; lateral: number } {
  const a = (directionDeg * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const hx = hit.x - center.x;
  const hy = hit.y - center.y;
  return { along: hx * dx + hy * dy, lateral: -hx * dy + hy * dx };
}

const SPEED_WINDOW_MS = 8;

/** Movement from the previous object's end to the press. */
export function movementMetrics(
  cursor: CursorBuffer,
  from: number,
  to: number,
  target: Vec2,
  radius: number,
  objTime: number,
): MovementMetrics {
  const none: MovementMetrics = { arriveMs: null, efficiency: null, corrections: null, peakSpeed: null };
  if (!(to > from) || cursor.size < 2) return none;
  // A full buffer that no longer reaches back to the start of the window would give wrong values.
  if (cursor.size >= cursor.capacity && cursor.tAt(0) > from + 1) return none;
  const a = cursor.positionAt(from, { x: 0, y: 0 });
  const b = cursor.positionAt(to, { x: 0, y: 0 });
  const i0 = cursor.lowerBound(from);
  const i1 = cursor.lowerBound(to);

  // Path length, first entry into the target, and a speed profile.
  let path = 0;
  let px = a.x;
  let py = a.y;
  let arrive: number | null = Math.hypot(a.x - target.x, a.y - target.y) <= radius ? from - objTime : null;
  const speeds: number[] = [];
  let ax = a.x;
  let ay = a.y;
  let at = from;
  let peak = 0;
  for (let i = i0; i < i1; i++) {
    const t = cursor.tAt(i);
    const x = cursor.xAt(i);
    const y = cursor.yAt(i);
    path += Math.hypot(x - px, y - py);
    px = x;
    py = y;
    if (arrive === null && Math.hypot(x - target.x, y - target.y) <= radius) arrive = t - objTime;
    if (t - at >= SPEED_WINDOW_MS) {
      const v = Math.hypot(x - ax, y - ay) / (t - at);
      speeds.push(v);
      if (v > peak) peak = v;
      ax = x;
      ay = y;
      at = t;
    }
  }
  path += Math.hypot(b.x - px, b.y - py);
  if (to - at >= SPEED_WINDOW_MS) {
    const v = Math.hypot(b.x - ax, b.y - ay) / (to - at);
    speeds.push(v);
    if (v > peak) peak = v;
  }
  const straight = Math.hypot(b.x - a.x, b.y - a.y);
  const efficiency = path > 1e-6 ? Math.min(1, straight / path) : null;

  let corrections: number | null = null;
  if (speeds.length >= 3 && peak > 0) {
    const h = Math.max(0.02, 0.15 * peak);
    let m = 0;
    for (let i = 1; i < speeds.length; i++) if ((speeds[i] as number) > (speeds[m] as number)) m = i;
    // Count bumps after the main peak. A bump needs a dip and a rise of at least h.
    let count = 0;
    let lo = speeds[m] as number;
    let hi = lo;
    let rising = false;
    for (let i = m + 1; i < speeds.length; i++) {
      const v = speeds[i] as number;
      if (!rising) {
        if (v < lo) lo = v;
        else if (v > lo + h) {
          rising = true;
          hi = v;
        }
      } else if (v > hi) hi = v;
      else if (v < hi - h) {
        count++;
        rising = false;
        lo = v;
      }
    }
    if (rising) count++;
    corrections = count;
  }
  return {
    arriveMs: arrive,
    efficiency,
    corrections,
    peakSpeed: speeds.length > 0 ? peak : null,
  };
}

export function buildRecord(inp: RecordInput): HitRecord {
  const { obj, press } = inp;
  const hit = press ? { x: press.x, y: press.y } : null;
  const f = inp.features;
  let aimAlong: number | null = null;
  let aimLateral: number | null = null;
  let aimRadial: number | null = null;
  if (hit) {
    aimRadial = Math.hypot(hit.x - obj.pos.x, hit.y - obj.pos.y);
    if (f.direction !== null) {
      const d = decomposeAim(hit, obj.pos, f.direction);
      aimAlong = d.along;
      aimLateral = d.lateral;
    }
  }
  let movement: MovementMetrics = { arriveMs: null, efficiency: null, corrections: null, peakSpeed: null };
  if (press && inp.prev && f.gapMs !== null && obj.kind !== 'spinner') {
    const from = Math.max(obj.time - f.gapMs, inp.movementFrom ?? -Infinity);
    movement = movementMetrics(inp.cursor, from, press.t, obj.pos, obj.radius, obj.time);
  }
  return {
    index: obj.index,
    kind: obj.kind,
    pattern: obj.pattern,
    set: obj.set,
    time: obj.time,
    endTime: obj.kind === 'circle' ? obj.time : obj.endTime,
    pos: { x: obj.pos.x, y: obj.pos.y },
    radius: obj.radius,
    approachMs: obj.approachMs,
    crispMs: obj.windows.crisp,
    judgment: inp.judgment,
    headJudgment: inp.headJudgment,
    missReason: inp.missReason,
    timingError: press && obj.kind !== 'spinner' ? press.t - obj.time : null,
    hit,
    aimAlong,
    aimLateral,
    aimRadial,
    input: press ? press.slot : null,
    comboBefore: inp.comboBefore,
    afterPause: inp.afterPause,
    features: f,
    movement,
    slider: inp.slider,
    spinner: inp.spinner,
  };
}
