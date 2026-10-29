// Slider ball, ticks, tracking and final judgment (PLAN section 5).

import type { Judgment, MissReason, Ms, SliderObject, SliderStats, Vec2 } from '../../shared/types';
import { flattenPath, pointAt, tangentAt } from '../map/path';
import type { FlatPath } from '../map/path';

/** Tracking starts when the cursor is within this many radii of the ball. */
export const ACQUIRE_RADII = 1.0;
/** Step of the tracking evaluation, ms. */
export const TRACK_STEP_MS = 4;

export type CheckKind = 1 | 2 | 3; // tick, repeat, end

export interface SliderGeometry {
  obj: SliderObject;
  flat: FlatPath;
  /** Flat path length over the nominal slider length. */
  scale: number;
  checkT: Float64Array;
  checkKind: Uint8Array;
  /** Where each check sits on the field. */
  checkX: Float32Array;
  checkY: Float32Array;
  /** Ticks and repeats, excluding the end. */
  partsBeforeEnd: number;
}

export function endCheckTime(obj: SliderObject): Ms {
  if (obj.spanMs < 160) {
    const lastStart = obj.time + obj.spanMs * obj.repeats;
    return lastStart + obj.spanMs / 2;
  }
  return obj.endTime - 40;
}

/** Positions along one pass where ticks sit, as distances from the path start. */
export function tickOffsets(obj: SliderObject): number[] {
  const out: number[] = [];
  if (obj.tickDistance <= 0) return out;
  const skip = 0.1 * obj.tickDistance;
  for (let k = 1; k * obj.tickDistance < obj.length - skip; k++) out.push(k * obj.tickDistance);
  return out;
}

export function buildSliderGeometry(obj: SliderObject): SliderGeometry {
  const flat = flattenPath(obj.pos, obj.path);
  const times: { t: number; k: CheckKind; x: number; y: number }[] = [];
  const at = { x: 0, y: 0 };
  const scale0 = obj.length > 0 ? flat.length / obj.length : 1;
  const offs = tickOffsets(obj);
  const passes = obj.repeats + 1;
  for (let p = 0; p < passes; p++) {
    const base = obj.time + p * obj.spanMs;
    const forward = p % 2 === 0;
    for (const s of offs) {
      const frac = s / obj.length;
      pointAt(flat, s * scale0, at);
      times.push({ t: base + (forward ? frac : 1 - frac) * obj.spanMs, k: 1, x: at.x, y: at.y });
    }
    if (p > 0) {
      pointAt(flat, p % 2 === 1 ? flat.length : 0, at);
      times.push({ t: base, k: 2, x: at.x, y: at.y });
    }
  }
  times.sort((a, b) => a.t - b.t);
  const partsBeforeEnd = times.length;
  pointAt(flat, obj.repeats % 2 === 0 ? flat.length : 0, at);
  times.push({ t: endCheckTime(obj), k: 3, x: at.x, y: at.y });
  times.sort((a, b) => a.t - b.t);
  const checkT = new Float64Array(times.length);
  const checkKind = new Uint8Array(times.length);
  const checkX = new Float32Array(times.length);
  const checkY = new Float32Array(times.length);
  times.forEach((c, i) => {
    checkT[i] = c.t;
    checkKind[i] = c.k;
    checkX[i] = c.x;
    checkY[i] = c.y;
  });
  return { obj, flat, scale: obj.length > 0 ? flat.length / obj.length : 1, checkT, checkKind, checkX, checkY, partsBeforeEnd };
}

/** Distance along the flat path where the ball is at time t. */
export function ballDistance(g: SliderGeometry, t: Ms): number {
  const o = g.obj;
  let u = (t - o.time) / o.spanMs;
  const last = o.repeats + 1;
  if (u < 0) u = 0;
  if (u > last) u = last;
  let i = Math.floor(u);
  if (i >= last) i = last - 1;
  const p = u - i;
  return (i % 2 === 0 ? p : 1 - p) * g.flat.length;
}

export function ballPos(g: SliderGeometry, t: Ms, out: Vec2): Vec2 {
  return pointAt(g.flat, ballDistance(g, t), out);
}

/** Unit direction the ball moves in at time t. */
export function ballDirection(g: SliderGeometry, t: Ms, out: Vec2): Vec2 {
  const o = g.obj;
  const u = (t - o.time) / o.spanMs;
  let i = Math.floor(u < 0 ? 0 : u);
  if (i > o.repeats) i = o.repeats;
  tangentAt(g.flat, ballDistance(g, t), out);
  if (i % 2 === 1) {
    out.x = -out.x;
    out.y = -out.y;
  }
  return out;
}

/** Tracking with hysteresis. Acquire within 1 radius, keep within the follow radius. */
export function trackingNext(was: boolean, held: boolean, dist: number, radius: number, followRadius: number): boolean {
  if (!held) return false;
  return dist <= (was ? followRadius : ACQUIRE_RADII * radius);
}

export function trackingJudgment(f: number): Judgment {
  if (f >= 1) return 'crisp';
  if (f >= 0.75) return 'solid';
  if (f >= 0.4) return 'rough';
  return 'miss';
}

const RANK: Record<Judgment, number> = { crisp: 3, solid: 2, rough: 1, miss: 0 };

export function worseOf(a: Judgment, b: Judgment): Judgment {
  return RANK[a] <= RANK[b] ? a : b;
}

export interface SliderOutcome {
  judgment: Judgment;
  missReason: MissReason | null;
}

/**
 * Final judgment from the head and the share of parts hit.
 * A missed head caps the result at Rough, and a missed head with no parts is a Miss.
 */
export function sliderOutcome(head: Judgment, headReason: MissReason | null, f: number): SliderOutcome {
  const tracking = trackingJudgment(f);
  if (head === 'miss') {
    if (f <= 0) return { judgment: 'miss', missReason: headReason ?? 'none' };
    const j = worseOf(tracking, 'rough');
    return { judgment: j, missReason: j === 'miss' ? (headReason ?? 'none') : headReason };
  }
  const j = worseOf(head, tracking);
  return { judgment: j, missReason: j === 'miss' ? 'tracking' : null };
}

export interface CursorSampler {
  positionAt(t: Ms, out: Vec2): Vec2;
}
export interface HeldSampler {
  heldAt(t: Ms): boolean;
}
export interface SliderSink {
  /** A tick, repeat or the end was checked. */
  onPart(kind: CheckKind, hit: boolean, t: Ms, x: number, y: number): void;
  onTrack(on: boolean, t: Ms): void;
}

/** Runtime state of one slider. Steps through the slider in 4 ms slices. */
export class SliderRun {
  tracking = false;
  started = false;
  evalT: Ms;
  done = false;
  /** Checks done so far. */
  checkIdx = 0;
  /** 0 waiting, 1 hit, 2 missed. */
  readonly checkStatus: Uint8Array;
  partsHit = 0;
  ticksHit = 0;
  ticksTotalSeen = 0;
  endHit = false;
  private trackedMs = 0;
  private sumDist = 0;
  private sumLag = 0;
  private sumLat2 = 0;
  private samples = 0;
  breaks = 0;
  firstLossAt: number | null = null;
  private cur: Vec2 = { x: 0, y: 0 };
  private ball: Vec2 = { x: 0, y: 0 };
  private dir: Vec2 = { x: 1, y: 0 };

  constructor(readonly geom: SliderGeometry) {
    this.evalT = geom.obj.time;
    this.checkStatus = new Uint8Array(geom.checkT.length);
  }

  get partsTotal(): number {
    return this.geom.checkT.length;
  }

  /** Evaluate every slice up to time `upTo` (inclusive). */
  step(upTo: Ms, cursor: CursorSampler, held: HeldSampler, sink: SliderSink): void {
    const g = this.geom;
    const o = g.obj;
    const span = o.endTime - o.time;
    while (!this.done && this.evalT <= upTo) {
      const t = this.evalT;
      cursor.positionAt(t, this.cur);
      ballPos(g, t, this.ball);
      const dist = Math.hypot(this.cur.x - this.ball.x, this.cur.y - this.ball.y);
      const was = this.tracking;
      const now = trackingNext(was, held.heldAt(t), dist, o.radius, o.followRadius);
      if (now !== was) {
        this.tracking = now;
        if (now) this.started = true;
        else {
          this.breaks++;
          if (this.firstLossAt === null) this.firstLossAt = span > 0 ? Math.min(1, (t - o.time) / span) : 0;
        }
        sink.onTrack(now, t);
      }
      while (this.checkIdx < g.checkT.length && (g.checkT[this.checkIdx] as number) <= t) {
        const kind = g.checkKind[this.checkIdx] as CheckKind;
        const hit = this.tracking;
        this.checkStatus[this.checkIdx] = hit ? 1 : 2;
        if (hit) this.partsHit++;
        if (kind === 3) this.endHit = hit;
        else {
          this.ticksTotalSeen++;
          if (hit) this.ticksHit++;
        }
        sink.onPart(kind, hit, g.checkT[this.checkIdx] as number, this.ball.x, this.ball.y);
        this.checkIdx++;
      }
      const w = Math.min(TRACK_STEP_MS, o.endTime - t);
      if (this.tracking) this.trackedMs += w;
      ballDirection(g, t, this.dir);
      const ex = this.cur.x - this.ball.x;
      const ey = this.cur.y - this.ball.y;
      this.sumDist += dist;
      this.sumLag += ex * this.dir.x + ey * this.dir.y;
      const lat = -ex * this.dir.y + ey * this.dir.x;
      this.sumLat2 += lat * lat;
      this.samples++;
      this.evalT += TRACK_STEP_MS;
      if (this.evalT > o.endTime) this.done = true;
    }
  }

  fraction(): number {
    return this.partsTotal > 0 ? this.partsHit / this.partsTotal : 1;
  }

  stats(): SliderStats {
    const o = this.geom.obj;
    const span = o.endTime - o.time;
    const n = Math.max(1, this.samples);
    return {
      ticksHit: this.ticksHit,
      ticksTotal: this.geom.partsBeforeEnd,
      endHit: this.endHit,
      trackedFraction: span > 0 ? Math.min(1, this.trackedMs / span) : 0,
      meanDistance: this.sumDist / n,
      meanLag: this.sumLag / n,
      lateralRms: Math.sqrt(this.sumLat2 / n),
      breaks: this.breaks,
      firstLossAt: this.firstLossAt,
      shape: o.shape,
      length: o.length,
      velocity: o.velocity,
      repeats: o.repeats,
      followRadius: o.followRadius,
    };
  }
}
