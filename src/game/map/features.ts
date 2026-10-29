// Per-object features computed from the final map (the ObjectFeatures contract).

import type { HitObject, Ms, ObjectFeatures, SliderObject, Vec2 } from '../../shared/types';
import { flattenPath, sliderEndPoint } from './path';
import { angleDiff, dirDeg } from './placement';

const tails = new WeakMap<SliderObject, Vec2>();

/** Where the object leaves the cursor: the center, or the slider's tail. */
export function endPosition(o: HitObject): Vec2 {
  if (o.kind !== 'slider') return o.pos;
  let t = tails.get(o);
  if (!t) {
    t = sliderEndPoint(flattenPath(o.pos, o.path), o.repeats, { x: 0, y: 0 });
    tails.set(o, t);
  }
  return t;
}

export function endTimeOf(o: HitObject): Ms {
  return o.kind === 'circle' ? o.time : o.endTime;
}

function emptyFeatures(): ObjectFeatures {
  return {
    distance: null,
    gapMs: null,
    velocity: null,
    spacing: null,
    turnAngle: null,
    direction: null,
    runIndex: 0,
    runLength: 0,
    visibleCount: 1,
    progress: 0,
  };
}

const RUN_GAP_MS = 160;
const gapTolerance = (g: number) => Math.max(2, 0.06 * g);

/**
 * Fill features for objects[from..]. `out` already holds entries for 0..from-1.
 * `progressMs` is the length that progress is measured against.
 */
export function extendFeatures(objects: readonly HitObject[], out: ObjectFeatures[], from: number, progressMs: number): void {
  const n = objects.length;
  for (let i = from; i < n; i++) {
    const o = objects[i] as HitObject;
    const f = emptyFeatures();
    f.progress = progressMs > 0 ? Math.min(1, Math.max(0, o.time / progressMs)) : 0;
    const prev = i > 0 ? (objects[i - 1] as HitObject) : null;
    if (prev) {
      f.gapMs = o.time - endTimeOf(prev);
      if (prev.kind !== 'spinner') {
        const e = endPosition(prev);
        const d = Math.hypot(o.pos.x - e.x, o.pos.y - e.y);
        f.distance = d;
        f.velocity = f.gapMs > 0 ? d / f.gapMs : null;
        f.spacing = d / (2 * o.radius);
        if (d >= 0.5 * o.radius) {
          f.direction = dirDeg(o.pos.x - e.x, o.pos.y - e.y);
          const pf = out[i - 1];
          if (pf && pf.direction !== null) f.turnAngle = Math.abs(angleDiff(pf.direction, f.direction));
        }
      }
    }
    out[i] = f;
  }

  // Runs of three or more objects with equal short gaps.
  const link = (k: number): boolean => {
    const a = objects[k - 1] as HitObject;
    const b = objects[k] as HitObject;
    const g = (out[k] as ObjectFeatures).gapMs;
    return a.kind !== 'spinner' && b.kind !== 'spinner' && g !== null && g < RUN_GAP_MS;
  };
  const gap = (k: number) => (out[k] as ObjectFeatures).gapMs as number;
  let k = Math.max(1, from);
  while (k < n) {
    if (!link(k)) {
      k++;
      continue;
    }
    const start = k - 1;
    let end = k;
    let m = k + 1;
    while (m < n && link(m) && Math.abs(gap(m) - gap(m - 1)) <= gapTolerance(gap(m - 1))) {
      end = m;
      m++;
    }
    if (end - start + 1 >= 3) {
      for (let j = start; j <= end; j++) {
        const f = out[j] as ObjectFeatures;
        if (f.runLength === 0) {
          f.runIndex = j - start + 1;
          f.runLength = end - start + 1;
        }
      }
    }
    k = end + 1;
  }

  // How many objects are on screen at each object's time.
  let maxSpan = 0;
  let maxApproach = 0;
  for (const o of objects) {
    maxSpan = Math.max(maxSpan, endTimeOf(o) - o.time);
    maxApproach = Math.max(maxApproach, o.approachMs);
  }
  for (let i = from; i < n; i++) {
    const t = (objects[i] as HitObject).time;
    let count = 0;
    for (let j = i; j >= 0; j--) {
      const q = objects[j] as HitObject;
      if (q.time + maxSpan < t) break;
      if (endTimeOf(q) >= t && q.time - q.approachMs <= t) count++;
    }
    for (let j = i + 1; j < n; j++) {
      const q = objects[j] as HitObject;
      if (q.time - maxApproach > t) break;
      if (q.time - q.approachMs <= t) count++;
    }
    (out[i] as ObjectFeatures).visibleCount = Math.max(1, count);
  }
}

export function computeFeatures(map: { objects: readonly HitObject[]; durationMs: Ms }): ObjectFeatures[] {
  const out: ObjectFeatures[] = [];
  extendFeatures(map.objects, out, 0, map.durationMs);
  return out;
}
