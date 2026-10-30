// The placement engine (PLAN section 7). Every motif goes through MapBuilder, so each rule lives here.

import { PLAYFIELD, PLAYFIELD_CENTER } from '../../shared/catalog';
import type {
  CircleObject,
  HitObject,
  HitWindows,
  PathSegment,
  PatternTag,
  SliderObject,
  SpinnerObject,
  Vec2,
} from '../../shared/types';
import { flattenPath, maxTangentDeviation, minCurvatureRadius, samplePath, selfIntersects, sliderEndPoint, tangentAt } from './path';
import type { FlatPath } from './path';
import type { Rng } from './rng';

/* ----------------------------------------------------------- constants */

export const EDGE_MARGIN = 8.05;
/** Visible-together objects keep this many radii apart. The rule is 2.1, the extra is for rounding. */
export const NEAR_RADII = 2.13;
export const ROUND_POS = 16;

const round1 = (x: number) => Math.round(x * 10) / 10;
const roundPos = (x: number) => Math.round(x * ROUND_POS) / ROUND_POS;
const RAD = Math.PI / 180;

export function dirDeg(dx: number, dy: number): number {
  const a = Math.atan2(dy, dx) / RAD;
  return a < 0 ? a + 360 : a;
}

/** Signed difference b - a wrapped into (-180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/* -------------------------------------------------------------- motifs */

export type CurveFamily = 'cubic' | 's' | 'hook' | 'wave' | 'zigzag';

export interface SliderSpec {
  /** Beats per pass. */
  passes: number;
  repeats: number;
  shape: 'straight' | 'arc' | 'curve';
  bend: 1 | -1;
  /** Heading of the path relative to the movement into the head, degrees. */
  headTurn: number;
  /** Arc sagitta over chord, at most 0.6. Also sets how tight a hook is. */
  k: number;
  /** Cubic control angle, degrees. A hook sweeps 70 to 140 degrees and a zigzag bends 60 to 100, both read from this. */
  alpha: number;
  /** Which curve a `curve` slider draws. */
  family: CurveFamily;
  /** Straight legs of a zigzag. */
  legs: 2 | 3;
}

export interface MotifStep {
  /** Beats after the motif start. */
  off: number;
  /** Distance from the previous object's end. */
  dist: number;
  /** Signed turn from the previous movement, degrees. */
  turn: number;
  slider?: SliderSpec;
  tag?: PatternTag;
  /** Put the note on the spot of the one before it. Only stacks do. */
  stack?: boolean;
}

export interface Motif {
  tag: PatternTag;
  steps: MotifStep[];
  /** Beats until the next motif may start. */
  beats: number;
  stream?: boolean;
  /** Note spacing of a stream, for the fold-back rule. */
  spacing?: number;
  /** Smallest distance between consecutive notes inside the motif. */
  minDist?: number;
}

export interface BuilderConfig {
  radius: number;
  approachMs: number;
  windows: HitWindows;
  /** Milliseconds per beat. Offsets in motifs are in beats, so modules use 1 and offsets in ms. */
  beatMs: number;
  sliderVelocity: number;
  tickDistance: number;
  /** Smallest jump between consecutive objects, radii. */
  jumpMinRadii: number;
  /** Smallest gap between objects, ms. */
  minGapMs: number;
  set: number;
  /** Time of beat 0. When set, jumps obey rule 10 and bar downbeats are known. */
  originMs?: number;
}

export interface GroupInfo {
  motif: Motif;
  group: number;
  positions: Vec2[];
  hasSlider: boolean;
  /** The objects the motif made, in step order. */
  objects: HitObject[];
}

export type MirrorAxis = 'v' | 'h' | 'c';

/** Mirror a point about x = 500 (v), y = 312.5 (h) or the centre point (c). Exact on the 1/16 grid. */
export function mirrorPoint(p: Vec2, axis: MirrorAxis): Vec2 {
  return { x: axis === 'h' ? p.x : PLAYFIELD.width - p.x, y: axis === 'v' ? p.y : PLAYFIELD.height - p.y };
}

function mirrorSegment(s: PathSegment, axis: MirrorAxis): PathSegment {
  const f = (p: Vec2) => mirrorPoint(p, axis);
  if (s.type === 'line') return { type: 'line', to: f(s.to) };
  if (s.type === 'arc') return { type: 'arc', through: f(s.through), to: f(s.to) };
  return { type: 'cubic', c1: f(s.c1), c2: f(s.c2), to: f(s.to) };
}

export interface MotifOptions {
  negate?: boolean;
  scale?: number;
  intensity?: number;
  /** Replay a placed motif with every position mirrored. All or nothing. */
  mirror?: { source: GroupInfo; axis: MirrorAxis };
  /** Multiplies the connecting jump. */
  accent?: number;
  /** Added to the first turn, degrees. */
  turnShift?: number;
  /** Fail, and leave nothing behind, unless every step is placed. */
  requireFull?: boolean;
  /** Never shorten the first jump to make it fit. */
  exact?: boolean;
}

export interface MotifResult {
  ok: boolean;
  count: number;
  info: GroupInfo | null;
}

/* -------------------------------------------------------------- layout */

interface Item {
  x: number;
  y: number;
  time: number;
  end: number;
  group: number;
  seq: number;
  stream: boolean;
  /** Slider samples as x, y pairs, or null for a circle. */
  pts: Float64Array | null;
}

interface PlaceCtx {
  group: number;
  seq: number;
  stream: boolean;
  spacing: number;
  /** Smallest distance to the item just before, when that item is in the same motif. */
  innerMin: number;
  /** Smallest distance to the item just before, when it is not. */
  jumpMin: number;
  constraint: ((x: number, y: number) => boolean) | null;
  /** The note sits on the spot of earlier notes of its own motif. */
  stack?: boolean;
}

export class Layout {
  items: Item[] = [];
  afterSpinner = false;
  private maxSpan = 0;

  constructor(private cfg: BuilderConfig) {}

  mark(): number {
    return this.items.length;
  }

  rollback(n: number): void {
    this.items.length = n;
  }

  add(it: Item): void {
    this.items.push(it);
    this.afterSpinner = false;
    if (it.end - it.time > this.maxSpan) this.maxSpan = it.end - it.time;
  }

  private inBounds(x: number, y: number): boolean {
    const r = this.cfg.radius;
    return x >= r + EDGE_MARGIN && x <= PLAYFIELD.width - r - EDGE_MARGIN && y >= r + EDGE_MARGIN && y <= PLAYFIELD.height - r - EDGE_MARGIN;
  }

  private distTo(it: Item, x: number, y: number): number {
    if (!it.pts) return Math.hypot(x - it.x, y - it.y);
    let best = Infinity;
    const p = it.pts;
    for (let i = 0; i < p.length; i += 2) {
      const d = Math.hypot(x - (p[i] as number), y - (p[i + 1] as number));
      if (d < best) best = d;
    }
    return best;
  }

  /** Can a circle go here at this time? */
  ok(x: number, y: number, time: number, c: PlaceCtx): boolean {
    const r = this.cfg.radius;
    if (!this.inBounds(x, y)) return false;
    if (c.constraint && !c.constraint(x, y)) return false;
    const n = this.items.length;
    const appear = time - this.cfg.approachMs;
    const near = NEAR_RADII * r;
    let skipLast = false;
    if (n > 0 && !this.afterSpinner) {
      const prev = this.items[n - 1] as Item;
      const same = prev.group === c.group;
      const need = prev.pts ? near : same ? c.innerMin : c.jumpMin;
      if (!(c.stack && same && !prev.pts && prev.x === x && prev.y === y) && this.distTo(prev, x, y) < need) return false;
      skipLast = true;
    }
    for (let i = n - 1 - (skipLast ? 1 : 0); i >= 0; i--) {
      const it = this.items[i] as Item;
      if (it.time + this.maxSpan + 100 < appear) break;
      if (appear > it.end + 100) continue;
      const d = this.distTo(it, x, y);
      if (c.stack && it.group === c.group && !it.pts && it.x === x && it.y === y) continue;
      if (c.stream && it.stream && it.group === c.group) {
        const j = c.seq - it.seq;
        const need = j >= 2 ? Math.min(near, 0.8 * j * c.spacing) : 0.6 * r;
        if (d < need) return false;
        continue;
      }
      if (d < near) return false;
    }
    return true;
  }

  /** Can a slider whose body is `pts` start at this time? Checks the whole body against everything visible. */
  okSlider(pts: Float64Array, time: number, flat: FlatPath): boolean {
    const r = this.cfg.radius;
    const near = NEAR_RADII * r;
    const appear = time - this.cfg.approachMs;
    for (let i = 0; i < pts.length; i += 2) {
      if (!this.inBounds(pts[i] as number, pts[i + 1] as number)) return false;
    }
    for (let i = 0; i < flat.n; i++) {
      if (!this.inBounds(flat.xs[i] as number, flat.ys[i] as number)) return false;
    }
    for (let k = this.items.length - 1; k >= 0; k--) {
      const it = this.items[k] as Item;
      // The object just before is always checked, however long ago it ended.
      const consecutive = k === this.items.length - 1 && !this.afterSpinner;
      if (!consecutive && it.time + this.maxSpan + 100 < appear) break;
      if (!consecutive && appear > it.end + 100) continue;
      for (let i = 0; i < pts.length; i += 2) {
        if (this.distTo(it, pts[i] as number, pts[i + 1] as number) < near) return false;
      }
    }
    return true;
  }
}

/* ------------------------------------------------------------ placing */

function turnOffsets(sign: number): number[] {
  const out = [0];
  for (let a = 15; a <= 90; a += 15) out.push(sign * a, -sign * a);
  return out;
}

export function placeNote(
  layout: Layout,
  from: Vec2,
  dirIn: number | null,
  dist: number,
  turn: number,
  time: number,
  ctx: PlaceCtx,
  shrinkMin: number | null,
  pull = true,
  /** Distance from the center where the pull toward it starts. */
  pullFrom = 350,
): Vec2 | null {
  const toCenter = dirDeg(PLAYFIELD_CENTER.x - from.x, PLAYFIELD_CENTER.y - from.y);
  let theta = (dirIn ?? toCenter) + turn;
  const dc = Math.hypot(PLAYFIELD_CENTER.x - from.x, PLAYFIELD_CENTER.y - from.y);
  if (pull && dc > pullFrom) {
    const k = Math.min(0.5, Math.max(0, (dc - pullFrom) / 150));
    theta += k * angleDiff(theta, toCenter);
  }
  const sign = turn >= 0 ? 1 : -1;
  const tries: [number, number][] = [];
  for (const o of turnOffsets(sign)) tries.push([1, o]);
  if (shrinkMin !== null) {
    for (const f of [0.9, 0.8, 0.7]) {
      if (dist * f < shrinkMin) continue;
      tries.push([f, 0], [f, sign * 15], [f, -sign * 15]);
      if (f === 0.7) tries.push([f, sign * 30]);
    }
  }
  for (const [f, o] of tries) {
    const a = (theta + o) * RAD;
    const x = roundPos(from.x + dist * f * Math.cos(a));
    const y = roundPos(from.y + dist * f * Math.sin(a));
    if (layout.ok(x, y, time, ctx)) return { x, y };
  }
  return null;
}

/* ------------------------------------------------------- slider paths */

function arcFactor(k: number): number {
  const theta = 4 * Math.atan(2 * k);
  return theta / (2 * Math.sin(theta / 2));
}

const rp = (v: Vec2): Vec2 => ({ x: roundPos(v.x), y: roundPos(v.y) });

/** Spot reached after turning `tau` degrees (signed) on a circle of radius R, from p0 heading h (degrees). */
function turnPoint(p0: Vec2, h: number, R: number, tau: number): Vec2 {
  const s = tau >= 0 ? 1 : -1;
  return {
    x: p0.x + R * s * (Math.sin((h + tau) * RAD) - Math.sin(h * RAD)),
    y: p0.y + R * s * (Math.cos(h * RAD) - Math.cos((h + tau) * RAD)),
  };
}

type Seg = PathSegment;

const mapSeg = (s: Seg, f: (p: Vec2) => Vec2): Seg => {
  if (s.type === 'line') return { type: 'line', to: f(s.to) };
  if (s.type === 'arc') return { type: 'arc', through: f(s.through), to: f(s.to) };
  return { type: 'cubic', c1: f(s.c1), c2: f(s.c2), to: f(s.to) };
};

/**
 * Curves drawn for a chord of 1 along +x with the bulge to +y. Every point scales with the chord, so the
 * length comes out by scaling. Cubic is a C bend, S has an inflection, wave is two C bends that alternate.
 */
function unitCurve(family: CurveFamily, alpha: number): Seg[] {
  const a = alpha * RAD;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const arm = 0.38;
  if (family === 's') {
    return [{ type: 'cubic', c1: { x: arm * ca, y: arm * sa }, c2: { x: 1 - arm * ca, y: -arm * sa }, to: { x: 1, y: 0 } }];
  }
  if (family === 'wave') {
    const h = arm * 0.5;
    return [
      { type: 'cubic', c1: { x: h * ca, y: h * sa }, c2: { x: 0.5 - h * ca, y: h * sa }, to: { x: 0.5, y: 0 } },
      { type: 'cubic', c1: { x: 0.5 + h * ca, y: -h * sa }, c2: { x: 1 - h * ca, y: -h * sa }, to: { x: 1, y: 0 } },
    ];
  }
  return [{ type: 'cubic', c1: { x: arm * ca, y: arm * sa }, c2: { x: 1 - arm * ca, y: arm * sa }, to: { x: 1, y: 0 } }];
}

/** A line, then an arc that turns away from it. The arc radius never drops under the follow radius. */
function hookLocal(L: number, follow: number, spec: SliderSpec): Seg[] | null {
  const R = follow * (1.08 + 0.9 * Math.min(1, Math.max(0, (spec.k - 0.15) / 0.35)));
  let phi = 70 + ((spec.alpha - 20) / 40) * 70;
  while (phi >= 50 && L - R * phi * RAD < 0.6 * R) phi -= 10;
  const line = L - R * phi * RAD;
  if (phi < 50 || line < 0.6 * R) return null;
  const p0 = { x: line, y: 0 };
  return [
    { type: 'line', to: p0 },
    { type: 'arc', through: turnPoint(p0, 0, R, phi / 2), to: turnPoint(p0, 0, R, phi) },
  ];
}

/** Two or three lines joined by bends of 60 to 100 degrees, each bend rounded with the follow radius. */
function zigzagLocal(L: number, follow: number, spec: SliderSpec): Seg[] | null {
  const R = follow * 1.08;
  const legs = spec.legs;
  const bends = legs - 1;
  // Alpha is held to 20..60 so a gentler fallback never bends under 60 degrees.
  const beta = 60 + Math.min(40, Math.max(0, spec.alpha - 20));
  const per = (L - bends * R * beta * RAD) / legs;
  if (per < 0.5 * R) return null;
  const out: Seg[] = [];
  let pos: Vec2 = { x: 0, y: 0 };
  let h = 0;
  for (let i = 0; i < legs; i++) {
    pos = { x: pos.x + per * Math.cos(h * RAD), y: pos.y + per * Math.sin(h * RAD) };
    out.push({ type: 'line', to: pos });
    if (i < bends) {
      const d = (i % 2 === 0 ? 1 : -1) * beta;
      const through = turnPoint(pos, h, R, d / 2);
      const to = turnPoint(pos, h, R, d);
      out.push({ type: 'arc', through, to });
      pos = to;
      h += d;
    }
  }
  return out;
}

export interface BuiltPath {
  segments: PathSegment[];
  flat: FlatPath;
  shape: 'straight' | 'arc' | 'curve';
  pts?: Float64Array;
}

function shapeOf(segs: readonly PathSegment[]): BuiltPath['shape'] {
  if (segs.length === 1 && segs[0]?.type === 'line') return 'straight';
  if (segs.length === 1 && segs[0]?.type === 'arc') return 'arc';
  return 'curve';
}

/**
 * Build a path from `head` whose flattened length is `length` within 0.3%. `follow` is the follow radius:
 * hooks and zigzags are drawn with it, and `sliderBodyIsClear` rejects anything that bends tighter.
 */
export function buildSliderPath(head: Vec2, heading: number, length: number, spec: SliderSpec, follow = 0): BuiltPath | null {
  let local: Seg[] | null = null;
  let scalable = false;
  if (spec.shape === 'straight') {
    local = [{ type: 'line', to: { x: length, y: 0 } }];
  } else if (spec.shape === 'arc') {
    const chord = length / arcFactor(spec.k);
    local = [{ type: 'arc', through: { x: chord / 2, y: spec.k * chord }, to: { x: chord, y: 0 } }];
  } else if (spec.family === 'hook') {
    local = hookLocal(length, follow, spec);
  } else if (spec.family === 'zigzag') {
    local = zigzagLocal(length, follow, spec);
  } else {
    local = unitCurve(spec.family, spec.alpha);
    scalable = true;
  }
  if (!local) return null;
  let scale = 1;
  if (scalable) scale = length / flattenPath({ x: 0, y: 0 }, local).length;
  const hr = heading * RAD;
  const ch = Math.cos(hr);
  const sh = Math.sin(hr);
  const world = (sc: number): Seg[] =>
    (local as Seg[]).map((s) =>
      mapSeg(s, (p) => {
        const x = p.x * sc;
        const y = p.y * sc * spec.bend;
        return rp({ x: head.x + x * ch - y * sh, y: head.y + x * sh + y * ch });
      }),
    );
  let segs = world(scale);
  let flat = flattenPath(head, segs);
  for (let i = 0; i < 4 && (scalable || spec.shape === 'arc') && Math.abs(flat.length - length) / length > 0.0015; i++) {
    scale *= length / flat.length;
    segs = world(scale);
    flat = flattenPath(head, segs);
  }
  if (Math.abs(flat.length - length) / length > 0.003) return null;
  return { segments: segs, flat, shape: shapeOf(segs) };
}

/** Two parts of a slider body that are far apart along the path keep this many radii between them. */
const FOLD_RADII = 2;
/** Most the direction of travel may differ from the line head to tail, degrees. */
export const MAX_TANGENT_DEVIATION = 100;

/**
 * A slider body has to be readable: it doesn't cross itself, it doesn't bend tighter than the follow radius, and it
 * doesn't double back (the tangent stays within 100 degrees of the line from head to tail, and parts of the body
 * that are far apart along the path keep 2 radii between them).
 */
export function sliderBodyIsClear(segs: readonly PathSegment[], flat: FlatPath, pts: Float64Array, head: Vec2, radius: number, follow: number): boolean {
  if (selfIntersects(flat)) return false;
  if (minCurvatureRadius(head, segs) < follow * 0.995) return false;
  if (maxTangentDeviation(flat) > MAX_TANGENT_DEVIATION) return false;
  const n = pts.length / 2;
  const step = flat.length / Math.max(1, n - 1);
  const gap = Math.max(2, Math.ceil((4 * radius) / step));
  const need = FOLD_RADII * radius;
  for (let i = 0; i < n; i++) {
    for (let j = i + gap; j < n; j++) {
      if (Math.hypot((pts[2 * i] as number) - (pts[2 * j] as number), (pts[2 * i + 1] as number) - (pts[2 * j + 1] as number)) < need) return false;
    }
  }
  return true;
}

/* ---------------------------------------------------------- builder */

interface Move {
  dist: number;
  gapMs: number;
}

export interface BuilderSnapshot {
  objects: number;
  items: number;
  groups: number;
  group: number;
  prevEnd: Vec2 | null;
  dirIn: number | null;
  lastEnd: number;
  lastMove: Move | null;
  afterSpinner: boolean;
  layoutAfter: boolean;
}

/** The longest connecting jump into a mirrored replay, units. */
const MAX_CONNECT = 520;

export class MapBuilder {
  objects: HitObject[] = [];
  groups: GroupInfo[] = [];
  readonly layout: Layout;
  prevEnd: Vec2 | null = null;
  dirIn: number | null = null;
  lastEnd = -Infinity;
  /** Where the first note goes, instead of near the center. */
  firstPos: Vec2 | null = null;
  /** The last move between two objects, for rule 10. */
  lastMove: Move | null = null;
  private group = -1;
  private afterSpinner = false;

  constructor(
    readonly cfg: BuilderConfig,
    readonly rng: Rng,
  ) {
    this.layout = new Layout(cfg);
  }

  get groupCount(): number {
    return this.group + 1;
  }

  /** The state to come back to with `restore`. */
  snapshot(): BuilderSnapshot {
    return {
      objects: this.objects.length,
      items: this.layout.mark(),
      groups: this.groups.length,
      group: this.group,
      prevEnd: this.prevEnd,
      dirIn: this.dirIn,
      lastEnd: this.lastEnd,
      lastMove: this.lastMove,
      afterSpinner: this.afterSpinner,
      layoutAfter: this.layout.afterSpinner,
    };
  }

  restore(s: BuilderSnapshot): void {
    this.objects.length = s.objects;
    this.layout.rollback(s.items);
    this.groups.length = s.groups;
    this.group = s.group;
    this.prevEnd = s.prevEnd;
    this.dirIn = s.dirIn;
    this.lastEnd = s.lastEnd;
    this.lastMove = s.lastMove;
    this.afterSpinner = s.afterSpinner;
    this.layout.afterSpinner = s.layoutAfter;
  }

  /** True when `time` falls on the first beat of a bar. Needs `originMs`. */
  isDownbeat(time: number): boolean {
    if (this.cfg.originMs === undefined) return false;
    const bars = (time - this.cfg.originMs) / (this.cfg.beatMs * 4);
    return Math.abs(bars - Math.round(bars)) * 4 < 0.05;
  }

  /** Rule 10: a jump is at most 1.6 times the one before at the same gap, unless it lands on a bar downbeat. */
  private jumpCap(time: number): number {
    const m = this.lastMove;
    if (this.cfg.originMs === undefined || !m || this.afterSpinner) return Infinity;
    if (m.dist < 2.2 * this.cfg.radius || Math.abs(time - this.lastEnd - m.gapMs) > 1.5 || this.isDownbeat(time)) return Infinity;
    return 1.55 * m.dist;
  }

  private ctxFor(group: number, seq: number, m: Motif, constraint: PlaceCtx['constraint'], scale: number, stack: boolean, jump: boolean): PlaceCtx {
    return {
      group,
      seq,
      stream: !!m.stream && !jump,
      spacing: (m.spacing ?? 0) * scale,
      innerMin: (jump ? undefined : m.minDist) ?? this.cfg.jumpMinRadii * this.cfg.radius,
      jumpMin: this.cfg.jumpMinRadii * this.cfg.radius,
      constraint,
      stack,
    };
  }

  /** Add a motif that starts at `startTime`. On failure nothing from it stays, unless some notes were placed. */
  addMotif(m: Motif, startTime: number, opts: MotifOptions = {}): MotifResult {
    const cfg = this.cfg;
    const sign = opts.negate ? -1 : 1;
    const scale = opts.scale ?? 1;
    const intensity = opts.intensity ?? 0.5;
    const group = this.group + 1;
    const mark = this.layout.mark();
    const objMark = this.objects.length;
    const saved = {
      group: this.group,
      prevEnd: this.prevEnd,
      dirIn: this.dirIn,
      lastEnd: this.lastEnd,
      lastMove: this.lastMove,
      afterSpinner: this.afterSpinner,
      layoutAfter: this.layout.afterSpinner,
    };
    const positions: Vec2[] = [];
    let hasSlider = false;
    const mirror = opts.mirror;
    const need = mirror ? mirror.source.objects.length : 0;
    if (mirror && (need === 0 || need > m.steps.length)) return { ok: false, count: 0, info: null };

    const fail = (): MotifResult => {
      this.layout.rollback(mark);
      this.objects.length = objMark;
      this.group = saved.group;
      this.prevEnd = saved.prevEnd;
      this.dirIn = saved.dirIn;
      this.lastEnd = saved.lastEnd;
      this.lastMove = saved.lastMove;
      this.afterSpinner = saved.afterSpinner;
      this.layout.afterSpinner = saved.layoutAfter;
      return { ok: false, count: 0, info: null };
    };

    const nearCenter = this.afterSpinner ? 250 : 0;
    const steps = mirror ? m.steps.slice(0, need) : m.steps;
    for (let k = 0; k < steps.length; k++) {
      const step = steps[k] as MotifStep;
      const time = round1(startTime + step.off * cfg.beatMs);
      if (time - this.lastEnd < cfg.minGapMs - 1e-6) {
        if (k === 0 || mirror) return fail();
        break;
      }
      const ctx = this.ctxFor(
        group,
        k,
        m,
        nearCenter && k === 0 ? (x, y) => Math.hypot(x - PLAYFIELD_CENTER.x, y - PLAYFIELD_CENTER.y) <= nearCenter : null,
        scale,
        !!step.stack,
        step.tag === 'jump',
      );
      let pos: Vec2 | null = null;
      let mirrored: HitObject | null = null;
      let dist = step.dist * scale * (k === 0 ? (opts.accent ?? 1) : 1);
      if (nearCenter && k === 0) dist = Math.min(dist, 240);
      if (mirror) {
        mirrored = mirror.source.objects[k] as HitObject;
        const mp = mirrorPoint(mirrored.pos, mirror.axis);
        if (!this.layout.ok(mp.x, mp.y, time, ctx)) return fail();
        if (this.prevEnd) {
          const d = Math.hypot(mp.x - this.prevEnd.x, mp.y - this.prevEnd.y);
          if (!step.stack && d < cfg.jumpMinRadii * cfg.radius) return fail();
          if (d > this.jumpCap(time) || (k === 0 && d > MAX_CONNECT)) return fail();
        }
        pos = mp;
      } else if (step.stack && this.prevEnd) {
        const x = this.prevEnd.x;
        const y = this.prevEnd.y;
        if (this.layout.ok(x, y, time, ctx)) pos = { x, y };
      } else if (this.prevEnd === null) {
        if (this.firstPos) {
          const x = roundPos(this.firstPos.x);
          const y = roundPos(this.firstPos.y);
          if (this.layout.ok(x, y, time, ctx)) pos = { x, y };
        } else {
          const ang = this.rng.range(0, 360) * RAD;
          const rad = Math.sqrt(this.rng.next()) * 100;
          const x = roundPos(PLAYFIELD_CENTER.x + rad * Math.cos(ang));
          const y = roundPos(PLAYFIELD_CENTER.y + rad * Math.sin(ang));
          if (this.layout.ok(x, y, time, ctx)) pos = { x, y };
        }
      } else {
        dist = Math.min(dist, Math.max(this.jumpCap(time), cfg.jumpMinRadii * cfg.radius));
        const turn = step.turn * sign + (k === 0 ? (opts.turnShift ?? 0) : 0);
        const shrink = k === 0 && !opts.exact ? cfg.jumpMinRadii * cfg.radius : null;
        // A motif that starts far from the middle leans back toward it, so a run of small shapes does not stay in a corner.
        pos = placeNote(this.layout, this.prevEnd, this.dirIn, dist, turn, time, ctx, shrink, !opts.exact, k === 0 ? 200 : 350);
      }
      if (!pos) {
        if (k === 0 || mirror) return fail();
        break;
      }
      const moved = this.prevEnd ? Math.hypot(pos.x - this.prevEnd.x, pos.y - this.prevEnd.y) : 0;
      const newDir = this.prevEnd && moved > 1e-6 ? dirDeg(pos.x - this.prevEnd.x, pos.y - this.prevEnd.y) : this.dirIn;
      const move: Move | null = this.prevEnd ? { dist: moved, gapMs: time - this.lastEnd } : null;

      if (step.slider) {
        let built: BuiltPath | null = null;
        if (mirror && mirrored && mirrored.kind === 'slider') {
          const segs = mirrored.path.map((s) => mirrorSegment(s, mirror.axis));
          const flat = flattenPath(pos, segs);
          const pts = samplePath(flat, Math.max(4, cfg.radius / 3));
          if (this.layout.okSlider(pts, time, flat)) built = { segments: segs, flat, shape: mirrored.shape, pts };
        } else if (!mirrored) {
          built = this.buildSlider(pos, newDir ?? 0, step.slider, opts.negate ? -1 : 1, time);
        }
        if (!built) {
          if (k === 0 || mirror) return fail();
          break;
        }
        hasSlider = true;
        positions.push(pos);
        this.pushSlider(pos, time, built, step, group, intensity);
        const o = this.objects[this.objects.length - 1] as SliderObject;
        const tail = sliderEndPoint(built.flat, o.repeats, { x: 0, y: 0 });
        const tan = tangentAt(built.flat, o.repeats % 2 === 0 ? built.flat.length : 0, { x: 0, y: 0 });
        const sgn = o.repeats % 2 === 0 ? 1 : -1;
        this.prevEnd = { x: roundPos(tail.x), y: roundPos(tail.y) };
        this.dirIn = dirDeg(tan.x * sgn, tan.y * sgn);
        this.lastEnd = o.endTime;
        this.lastMove = move;
        continue;
      }
      if (mirrored && mirrored.kind !== 'circle') return fail();

      positions.push(pos);
      const c: CircleObject = {
        kind: 'circle',
        index: 0,
        time,
        pos,
        radius: cfg.radius,
        approachMs: cfg.approachMs,
        windows: cfg.windows,
        group,
        number: 0,
        pattern: step.tag ?? m.tag,
        intensity,
        set: cfg.set,
      };
      this.objects.push(c);
      this.layout.add({ x: pos.x, y: pos.y, time, end: time, group, seq: k, stream: ctx.stream, pts: null });
      this.prevEnd = pos;
      this.dirIn = newDir;
      this.lastEnd = time;
      this.lastMove = move;
    }
    this.afterSpinner = false;
    this.group = group;
    const count = this.objects.length - objMark;
    if (count === 0 || ((opts.requireFull || mirror) && count < steps.length)) return fail();
    const info: GroupInfo = { motif: m, group, positions, hasSlider, objects: this.objects.slice(objMark) };
    this.groups.push(info);
    return { ok: true, count, info };
  }

  private buildSlider(head: Vec2, heading: number, spec: SliderSpec, sign: number, time: number): BuiltPath | null {
    const cfg = this.cfg;
    const spanMs = round1(spec.passes * cfg.beatMs);
    const length = cfg.sliderVelocity * spanMs;
    if (length < 2.4 * cfg.radius || length > 600) return null;
    const follow = 2 * cfg.radius;
    const base: SliderSpec = { ...spec, bend: (spec.bend * sign) as 1 | -1, headTurn: spec.headTurn * sign };
    // Tries the wanted shape, then its other side, then gentler versions, then a line.
    const shapes: SliderSpec[] = [base, { ...base, bend: -base.bend as 1 | -1 }];
    if (base.shape !== 'straight') {
      // A zigzag keeps its bend at 60 degrees or more whatever the scale (see zigzagLocal), so these stay zigzags.
      for (const f of [0.7, 0.45]) shapes.push({ ...base, alpha: base.alpha * f, k: base.k * f, headTurn: 0 });
      if (base.family === 'zigzag' || base.family === 'hook') shapes.push({ ...base, family: 'cubic', alpha: base.alpha * 0.7 });
    }
    shapes.push({ ...base, shape: 'straight', headTurn: 0 });
    const headings = [0, 25, -25, 50, -50, 90, -90, 135, -135, 180];
    for (const s of shapes) {
      for (const h of headings) {
        const built = buildSliderPath(head, heading + s.headTurn + h, length, s, follow);
        if (!built) continue;
        const pts = samplePath(built.flat, Math.max(4, cfg.radius / 3));
        if (!sliderBodyIsClear(built.segments, built.flat, pts, head, cfg.radius, follow)) continue;
        if (!this.layout.okSlider(pts, time, built.flat)) continue;
        built.pts = pts;
        return built;
      }
    }
    return null;
  }

  private pushSlider(pos: Vec2, time: number, built: BuiltPath, step: MotifStep, group: number, intensity: number): void {
    const cfg = this.cfg;
    const spec = step.slider as SliderSpec;
    const spanMs = round1(spec.passes * cfg.beatMs);
    const length = cfg.sliderVelocity * spanMs;
    const endTime = round1(time + spanMs * (spec.repeats + 1));
    const s: SliderObject = {
      kind: 'slider',
      index: 0,
      time,
      pos,
      radius: cfg.radius,
      approachMs: cfg.approachMs,
      windows: cfg.windows,
      group,
      number: 0,
      pattern: step.tag ?? 'slider',
      intensity,
      set: cfg.set,
      path: built.segments,
      length,
      velocity: cfg.sliderVelocity,
      repeats: spec.repeats,
      spanMs,
      endTime,
      tickDistance: cfg.tickDistance,
      followRadius: 2 * cfg.radius,
      shape: built.shape,
    };
    this.objects.push(s);
    this.layout.add({ x: pos.x, y: pos.y, time, end: endTime, group, seq: 0, stream: false, pts: built.pts as Float64Array });
  }

  /** Add a spinner. The next motif starts near the center. */
  addSpinner(time: number, durationMs: number, rotations: number, intensity: number): SpinnerObject {
    const group = this.group + 1;
    const s: SpinnerObject = {
      kind: 'spinner',
      index: 0,
      time: round1(time),
      pos: { x: PLAYFIELD_CENTER.x, y: PLAYFIELD_CENTER.y },
      radius: 60,
      approachMs: this.cfg.approachMs,
      windows: this.cfg.windows,
      group,
      number: 0,
      pattern: 'spinner',
      intensity,
      set: this.cfg.set,
      endTime: round1(time + durationMs),
      rotationsRequired: rotations,
    };
    this.objects.push(s);
    this.group = group;
    this.prevEnd = { x: PLAYFIELD_CENTER.x, y: PLAYFIELD_CENTER.y };
    this.dirIn = null;
    this.lastEnd = s.endTime;
    this.lastMove = null;
    this.afterSpinner = true;
    this.layout.afterSpinner = true;
    return s;
  }

  /** Assign index and number. Positions and times are already rounded. */
  finalize(indexBase = 0, groupBase = 0, oneGroup = false): HitObject[] {
    const counts = new Map<number, number>();
    this.objects.forEach((o, i) => {
      o.index = indexBase + i;
      const g = oneGroup ? 0 : o.group;
      const n = (counts.get(g) ?? 0) + 1;
      counts.set(g, n);
      o.number = n;
      o.group = g + groupBase;
    });
    return this.objects;
  }
}
