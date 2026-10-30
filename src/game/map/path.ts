// Slider paths. One flattening serves the generator and the engine.

import type { PathSegment, Vec2 } from '../../shared/types';

/** Largest distance between the true curve and the flattened line, in playfield units. */
export const FLATTEN_TOLERANCE = 0.5;

export interface FlatPath {
  n: number;
  xs: Float64Array;
  ys: Float64Array;
  /** Distance along the path at each point. */
  cum: Float64Array;
  length: number;
}

export interface ArcInfo {
  cx: number;
  cy: number;
  radius: number;
  startAngle: number;
  /** Signed sweep in radians. Positive turns toward +y (clockwise on screen). */
  sweep: number;
}

/** The circle through a, m and b, traced from a through m to b. null when the points are collinear. */
export function arcThrough(a: Vec2, m: Vec2, b: Vec2): ArcInfo | null {
  const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const m2 = m.x * m.x + m.y * m.y;
  const b2 = b.x * b.x + b.y * b.y;
  const cx = (a2 * (m.y - b.y) + m2 * (b.y - a.y) + b2 * (a.y - m.y)) / d;
  const cy = (a2 * (b.x - m.x) + m2 * (a.x - b.x) + b2 * (m.x - a.x)) / d;
  const radius = Math.hypot(a.x - cx, a.y - cy);
  const ta = Math.atan2(a.y - cy, a.x - cx);
  const tm = Math.atan2(m.y - cy, m.x - cx);
  const tb = Math.atan2(b.y - cy, b.x - cx);
  const tau = Math.PI * 2;
  const wrap = (x: number) => ((x % tau) + tau) % tau;
  const dm = wrap(tm - ta);
  const db = wrap(tb - ta);
  const sweep = dm < db ? db : db - tau;
  return { cx, cy, radius, startAngle: ta, sweep };
}

export function cubicPoint(p0: Vec2, c1: Vec2, c2: Vec2, p3: Vec2, u: number, out: Vec2): Vec2 {
  const v = 1 - u;
  const a = v * v * v;
  const b = 3 * v * v * u;
  const c = 3 * v * u * u;
  const d = u * u * u;
  out.x = a * p0.x + b * c1.x + c * c2.x + d * p3.x;
  out.y = a * p0.y + b * c1.y + c * c2.y + d * p3.y;
  return out;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(px - ax, py - ay);
  let u = ((px - ax) * dx + (py - ay) * dy) / len2;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  return Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
}

function flattenCubic(out: number[], p0: Vec2, c1: Vec2, c2: Vec2, p3: Vec2, depth: number): void {
  const flat =
    Math.max(
      distToSegment(c1.x, c1.y, p0.x, p0.y, p3.x, p3.y),
      distToSegment(c2.x, c2.y, p0.x, p0.y, p3.x, p3.y),
    ) <= FLATTEN_TOLERANCE / 0.75;
  if (flat || depth >= 14) {
    out.push(p3.x, p3.y);
    return;
  }
  const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const p01 = mid(p0, c1);
  const p12 = mid(c1, c2);
  const p23 = mid(c2, p3);
  const p012 = mid(p01, p12);
  const p123 = mid(p12, p23);
  const m = mid(p012, p123);
  flattenCubic(out, p0, p01, p012, m, depth + 1);
  flattenCubic(out, m, p123, p23, p3, depth + 1);
}

/** Flatten a slider path that starts at `start`. */
export function flattenPath(start: Vec2, segments: readonly PathSegment[]): FlatPath {
  const pts: number[] = [start.x, start.y];
  let cur: Vec2 = start;
  for (const seg of segments) {
    if (seg.type === 'line') {
      pts.push(seg.to.x, seg.to.y);
    } else if (seg.type === 'arc') {
      const arc = arcThrough(cur, seg.through, seg.to);
      if (!arc) {
        pts.push(seg.to.x, seg.to.y);
      } else {
        const step = 2 * Math.acos(Math.max(0, 1 - FLATTEN_TOLERANCE / Math.max(arc.radius, FLATTEN_TOLERANCE)));
        const n = Math.max(2, Math.ceil(Math.abs(arc.sweep) / Math.max(step, 1e-3)));
        for (let i = 1; i < n; i++) {
          const a = arc.startAngle + (arc.sweep * i) / n;
          pts.push(arc.cx + arc.radius * Math.cos(a), arc.cy + arc.radius * Math.sin(a));
        }
        pts.push(seg.to.x, seg.to.y);
      }
    } else {
      flattenCubic(pts, cur, seg.c1, seg.c2, seg.to, 0);
    }
    cur = seg.to;
  }
  const n = pts.length / 2;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const cum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = pts[2 * i] as number;
    ys[i] = pts[2 * i + 1] as number;
    if (i > 0) cum[i] = (cum[i - 1] as number) + Math.hypot(xs[i]! - xs[i - 1]!, ys[i]! - ys[i - 1]!);
  }
  return { n, xs, ys, cum, length: cum[n - 1] as number };
}

export function pathLength(start: Vec2, segments: readonly PathSegment[]): number {
  return flattenPath(start, segments).length;
}

/** Index i of the segment that holds distance s, so cum[i] <= s <= cum[i + 1]. */
function segmentAt(fp: FlatPath, s: number): number {
  let lo = 0;
  let hi = fp.n - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((fp.cum[mid] as number) <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The point at distance s along the path, clamped to its ends. Writes into out. */
export function pointAt(fp: FlatPath, s: number, out: Vec2): Vec2 {
  if (fp.n < 2) {
    out.x = fp.xs[0] as number;
    out.y = fp.ys[0] as number;
    return out;
  }
  const c = s < 0 ? 0 : s > fp.length ? fp.length : s;
  const i = segmentAt(fp, c);
  const c0 = fp.cum[i] as number;
  const seg = (fp.cum[i + 1] as number) - c0;
  const u = seg > 1e-12 ? (c - c0) / seg : 0;
  out.x = (fp.xs[i] as number) + ((fp.xs[i + 1] as number) - (fp.xs[i] as number)) * u;
  out.y = (fp.ys[i] as number) + ((fp.ys[i + 1] as number) - (fp.ys[i] as number)) * u;
  return out;
}

/** Unit direction of travel at distance s. */
export function tangentAt(fp: FlatPath, s: number, out: Vec2): Vec2 {
  if (fp.n < 2) {
    out.x = 1;
    out.y = 0;
    return out;
  }
  const c = s < 0 ? 0 : s > fp.length ? fp.length : s;
  const i = segmentAt(fp, c);
  const dx = (fp.xs[i + 1] as number) - (fp.xs[i] as number);
  const dy = (fp.ys[i + 1] as number) - (fp.ys[i] as number);
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) {
    out.x = 1;
    out.y = 0;
  } else {
    out.x = dx / len;
    out.y = dy / len;
  }
  return out;
}

/** Points along the path no more than `step` apart, as x, y pairs. Both ends are included. */
export function samplePath(fp: FlatPath, step: number): Float64Array {
  const count = Math.max(2, Math.ceil(fp.length / step) + 1);
  const out = new Float64Array(count * 2);
  const p = { x: 0, y: 0 };
  for (let i = 0; i < count; i++) {
    pointAt(fp, (fp.length * i) / (count - 1), p);
    out[2 * i] = p.x;
    out[2 * i + 1] = p.y;
  }
  return out;
}

/** The point where the slider ends: the path end for an even number of repeats, otherwise the start. */
export function sliderEndPoint(fp: FlatPath, repeats: number, out: Vec2): Vec2 {
  return pointAt(fp, repeats % 2 === 0 ? fp.length : 0, out);
}

/** True when two segments of the flattened path cross. Neighbouring segments are skipped. */
export function selfIntersects(fp: FlatPath): boolean {
  const n = fp.n;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 2; j < n - 1; j++) {
      if (segmentsCross(fp.xs[i]!, fp.ys[i]!, fp.xs[i + 1]!, fp.ys[i + 1]!, fp.xs[j]!, fp.ys[j]!, fp.xs[j + 1]!, fp.ys[j + 1]!)) {
        return true;
      }
    }
  }
  return false;
}

function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * Smallest radius of curvature along a path, worked out from the segment definitions.
 * Infinity for a straight path. A corner between two segments counts as radius 0.
 */
export function minCurvatureRadius(start: Vec2, segments: readonly PathSegment[]): number {
  let best = Infinity;
  let cur = start;
  let prevDir: Vec2 | null = null;
  const corner = (d: Vec2): void => {
    if (prevDir && prevDir.x * d.x + prevDir.y * d.y < 0.9995) best = 0;
  };
  for (const seg of segments) {
    if (seg.type === 'line') {
      const dx = seg.to.x - cur.x;
      const dy = seg.to.y - cur.y;
      const len = Math.hypot(dx, dy);
      if (len > 1e-9) {
        const d = { x: dx / len, y: dy / len };
        corner(d);
        prevDir = d;
      }
    } else if (seg.type === 'arc') {
      const arc = arcThrough(cur, seg.through, seg.to);
      if (!arc) {
        const len = Math.hypot(seg.to.x - cur.x, seg.to.y - cur.y);
        if (len > 1e-9) {
          const d = { x: (seg.to.x - cur.x) / len, y: (seg.to.y - cur.y) / len };
          corner(d);
          prevDir = d;
        }
      } else {
        best = Math.min(best, arc.radius);
        const sgn = arc.sweep >= 0 ? 1 : -1;
        const a0 = arc.startAngle;
        const a1 = a0 + arc.sweep;
        const d0 = { x: -Math.sin(a0) * sgn, y: Math.cos(a0) * sgn };
        const d1 = { x: -Math.sin(a1) * sgn, y: Math.cos(a1) * sgn };
        corner(d0);
        prevDir = d1;
      }
    } else {
      const d0 = { x: seg.c1.x - cur.x, y: seg.c1.y - cur.y };
      const m0 = Math.hypot(d0.x, d0.y);
      if (m0 > 1e-9) corner({ x: d0.x / m0, y: d0.y / m0 });
      const N = 160;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const v = 1 - u;
        const x1 = 3 * (v * v * (seg.c1.x - cur.x) + 2 * v * u * (seg.c2.x - seg.c1.x) + u * u * (seg.to.x - seg.c2.x));
        const y1 = 3 * (v * v * (seg.c1.y - cur.y) + 2 * v * u * (seg.c2.y - seg.c1.y) + u * u * (seg.to.y - seg.c2.y));
        const x2 = 6 * (v * (seg.c2.x - 2 * seg.c1.x + cur.x) + u * (seg.to.x - 2 * seg.c2.x + seg.c1.x));
        const y2 = 6 * (v * (seg.c2.y - 2 * seg.c1.y + cur.y) + u * (seg.to.y - 2 * seg.c2.y + seg.c1.y));
        const sp = Math.hypot(x1, y1);
        if (sp < 1e-9) {
          best = 0;
          continue;
        }
        const k = Math.abs(x1 * y2 - y1 * x2) / (sp * sp * sp);
        if (k > 1e-12) best = Math.min(best, 1 / k);
      }
      const d1 = { x: seg.to.x - seg.c2.x, y: seg.to.y - seg.c2.y };
      const m1 = Math.hypot(d1.x, d1.y);
      if (m1 > 1e-9) prevDir = { x: d1.x / m1, y: d1.y / m1 };
    }
    cur = seg.to;
  }
  return best;
}

/** Largest angle, in degrees, between the direction of travel and the straight line from the head to the tail. */
export function maxTangentDeviation(fp: FlatPath): number {
  if (fp.n < 2) return 0;
  const cx = (fp.xs[fp.n - 1] as number) - (fp.xs[0] as number);
  const cy = (fp.ys[fp.n - 1] as number) - (fp.ys[0] as number);
  const cl = Math.hypot(cx, cy);
  if (cl < 1e-9) return 180;
  let worst = 0;
  for (let i = 0; i < fp.n - 1; i++) {
    const dx = (fp.xs[i + 1] as number) - (fp.xs[i] as number);
    const dy = (fp.ys[i + 1] as number) - (fp.ys[i] as number);
    const l = Math.hypot(dx, dy);
    if (l < 1e-9) continue;
    const dot = Math.max(-1, Math.min(1, (dx * cx + dy * cy) / (l * cl)));
    worst = Math.max(worst, (Math.acos(dot) * 180) / Math.PI);
  }
  return worst;
}
