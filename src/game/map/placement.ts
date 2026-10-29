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
import { flattenPath, samplePath, selfIntersects, sliderEndPoint, tangentAt } from './path';
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

export interface SliderSpec {
  /** Beats per pass. */
  passes: number;
  repeats: number;
  shape: 'straight' | 'arc' | 'curve';
  bend: 1 | -1;
  /** Heading of the path relative to the movement into the head, degrees. */
  headTurn: number;
  /** Arc sagitta over chord, at most 0.6. */
  k: number;
  /** Cubic control angle, degrees. */
  alpha: number;
  sCurve: boolean;
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
}

export interface GroupInfo {
  motif: Motif;
  group: number;
  positions: Vec2[];
  hasSlider: boolean;
}

export interface MotifOptions {
  negate?: boolean;
  scale?: number;
  intensity?: number;
  mirrorOf?: GroupInfo;
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
      if (this.distTo(prev, x, y) < need) return false;
      skipLast = true;
    }
    for (let i = n - 1 - (skipLast ? 1 : 0); i >= 0; i--) {
      const it = this.items[i] as Item;
      if (it.time + this.maxSpan + 100 < appear) break;
      if (appear > it.end + 100) continue;
      const d = this.distTo(it, x, y);
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
): Vec2 | null {
  const toCenter = dirDeg(PLAYFIELD_CENTER.x - from.x, PLAYFIELD_CENTER.y - from.y);
  let theta = (dirIn ?? toCenter) + turn;
  const dc = Math.hypot(PLAYFIELD_CENTER.x - from.x, PLAYFIELD_CENTER.y - from.y);
  if (pull && dc > 350) {
    const k = Math.min(0.5, Math.max(0, (dc - 350) / 150));
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

function unit(deg: number): Vec2 {
  return { x: Math.cos(deg * RAD), y: Math.sin(deg * RAD) };
}

const rp = (v: Vec2): Vec2 => ({ x: roundPos(v.x), y: roundPos(v.y) });

function segmentsFor(head: Vec2, heading: number, chord: number, spec: SliderSpec): PathSegment[] {
  const d = unit(heading);
  const end = rp({ x: head.x + d.x * chord, y: head.y + d.y * chord });
  if (spec.shape === 'straight') return [{ type: 'line', to: end }];
  if (spec.shape === 'arc') {
    const h = spec.k * chord;
    const mid = { x: (head.x + end.x) / 2, y: (head.y + end.y) / 2 };
    const perp = { x: -d.y * spec.bend, y: d.x * spec.bend };
    return [{ type: 'arc', through: rp({ x: mid.x + perp.x * h, y: mid.y + perp.y * h }), to: end }];
  }
  const a = spec.bend * spec.alpha;
  const e = spec.sCurve ? -a : a;
  const c1d = unit(heading + a);
  const c2d = unit(heading + e);
  const arm = chord * 0.36;
  return [
    {
      type: 'cubic',
      c1: rp({ x: head.x + c1d.x * arm, y: head.y + c1d.y * arm }),
      c2: rp({ x: end.x - c2d.x * arm, y: end.y - c2d.y * arm }),
      to: end,
    },
  ];
}

export interface BuiltPath {
  segments: PathSegment[];
  flat: FlatPath;
}

/** Build a path from `head` whose flattened length is `length` within 0.2%. */
export function buildSliderPath(head: Vec2, heading: number, length: number, spec: SliderSpec): BuiltPath | null {
  let chord = length;
  if (spec.shape === 'arc') chord = length / arcFactor(spec.k);
  let lo = length * 0.25;
  let hi = length;
  let segs = segmentsFor(head, heading, chord, spec);
  let flat = flattenPath(head, segs);
  if (spec.shape !== 'straight') {
    if (spec.shape === 'curve') chord = length * 0.8;
    for (let i = 0; i < 18; i++) {
      segs = segmentsFor(head, heading, chord, spec);
      flat = flattenPath(head, segs);
      if (Math.abs(flat.length - length) / length < 0.0015) break;
      if (flat.length > length) hi = chord;
      else lo = chord;
      chord = (lo + hi) / 2;
    }
  }
  if (Math.abs(flat.length - length) / length > 0.003) return null;
  return { segments: segs, flat };
}

/** Reject paths that touch themselves or fold back too tightly. */
function pathIsClear(flat: FlatPath, pts: Float64Array, radius: number): boolean {
  if (selfIntersects(flat)) return false;
  const n = pts.length / 2;
  const step = flat.length / Math.max(1, n - 1);
  const gap = Math.max(2, Math.ceil((4 * radius) / step));
  for (let i = 0; i < n; i++) {
    for (let j = i + gap; j < n; j++) {
      if (Math.hypot((pts[2 * i] as number) - (pts[2 * j] as number), (pts[2 * i + 1] as number) - (pts[2 * j + 1] as number)) < 1.5 * radius) {
        return false;
      }
    }
  }
  return true;
}

/* ---------------------------------------------------------- builder */

export class MapBuilder {
  objects: HitObject[] = [];
  groups: GroupInfo[] = [];
  readonly layout: Layout;
  prevEnd: Vec2 | null = null;
  dirIn: number | null = null;
  lastEnd = -Infinity;
  /** Where the first note goes, instead of near the center. */
  firstPos: Vec2 | null = null;
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

  private ctxFor(group: number, seq: number, m: Motif, constraint: PlaceCtx['constraint'], scale: number): PlaceCtx {
    return {
      group,
      seq,
      stream: !!m.stream,
      spacing: (m.spacing ?? 0) * scale,
      innerMin: m.minDist ?? this.cfg.jumpMinRadii * this.cfg.radius,
      jumpMin: this.cfg.jumpMinRadii * this.cfg.radius,
      constraint,
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
    const saved = { group: this.group, prevEnd: this.prevEnd, dirIn: this.dirIn, lastEnd: this.lastEnd, afterSpinner: this.afterSpinner, layoutAfter: this.layout.afterSpinner };
    const positions: Vec2[] = [];
    let hasSlider = false;
    const mirror = opts.mirrorOf;
    if (mirror && mirror.hasSlider) return { ok: false, count: 0, info: null };

    const fail = (): MotifResult => {
      this.layout.rollback(mark);
      this.objects.length = objMark;
      this.group = saved.group;
      this.prevEnd = saved.prevEnd;
      this.dirIn = saved.dirIn;
      this.lastEnd = saved.lastEnd;
      this.afterSpinner = saved.afterSpinner;
      this.layout.afterSpinner = saved.layoutAfter;
      return { ok: false, count: 0, info: null };
    };

    const nearCenter = this.afterSpinner ? 250 : 0;
    for (let k = 0; k < m.steps.length; k++) {
      const step = m.steps[k] as MotifStep;
      const time = round1(startTime + step.off * cfg.beatMs);
      if (time - this.lastEnd < cfg.minGapMs - 1e-6) {
        if (k === 0) return fail();
        break;
      }
      const ctx = this.ctxFor(
        group,
        k,
        m,
        nearCenter && k === 0 ? (x, y) => Math.hypot(x - PLAYFIELD_CENTER.x, y - PLAYFIELD_CENTER.y) <= nearCenter : null,
        scale,
      );
      let pos: Vec2 | null = null;
      let dist = step.dist * scale * (k === 0 ? (opts.accent ?? 1) : 1);
      if (nearCenter && k === 0) dist = Math.min(dist, 240);
      if (mirror) {
        const src = mirror.positions[k];
        if (!src) break;
        const mx = roundPos(PLAYFIELD.width - src.x);
        const my = src.y;
        if (this.layout.ok(mx, my, time, ctx)) {
          if (k === 0 && this.prevEnd) {
            const d = Math.hypot(mx - this.prevEnd.x, my - this.prevEnd.y);
            if (d >= cfg.jumpMinRadii * cfg.radius && d <= Math.max(dist * 1.3, cfg.jumpMinRadii * cfg.radius * 1.2)) pos = { x: mx, y: my };
          } else {
            pos = { x: mx, y: my };
          }
        }
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
        const turn = step.turn * sign + (k === 0 ? (opts.turnShift ?? 0) : 0);
        const shrink = k === 0 && !opts.exact ? cfg.jumpMinRadii * cfg.radius : null;
        pos = placeNote(this.layout, this.prevEnd, this.dirIn, dist, turn, time, ctx, shrink, !opts.exact);
      }
      if (!pos) {
        if (k === 0) return fail();
        break;
      }
      const moved = this.prevEnd ? Math.hypot(pos.x - this.prevEnd.x, pos.y - this.prevEnd.y) : 0;
      const newDir = this.prevEnd && moved > 1e-6 ? dirDeg(pos.x - this.prevEnd.x, pos.y - this.prevEnd.y) : this.dirIn;

      if (step.slider) {
        const built = this.buildSlider(pos, newDir ?? 0, step.slider, opts.negate ? -1 : 1, time);
        if (!built) {
          if (k === 0) return fail();
          break;
        }
        hasSlider = true;
        positions.push(pos);
        this.pushSlider(pos, time, built, step, m, group, intensity);
        const o = this.objects[this.objects.length - 1] as SliderObject;
        const tail = sliderEndPoint(built.flat, o.repeats, { x: 0, y: 0 });
        const tan = tangentAt(built.flat, o.repeats % 2 === 0 ? built.flat.length : 0, { x: 0, y: 0 });
        const sgn = o.repeats % 2 === 0 ? 1 : -1;
        this.prevEnd = { x: roundPos(tail.x), y: roundPos(tail.y) };
        this.dirIn = dirDeg(tan.x * sgn, tan.y * sgn);
        this.lastEnd = o.endTime;
        continue;
      }

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
      this.layout.add({ x: pos.x, y: pos.y, time, end: time, group, seq: k, stream: !!m.stream, pts: null });
      this.prevEnd = pos;
      this.dirIn = newDir;
      this.lastEnd = time;
    }
    this.afterSpinner = false;
    this.group = group;
    const count = this.objects.length - objMark;
    if (count === 0 || (opts.requireFull && count < m.steps.length)) return fail();
    const info: GroupInfo = { motif: m, group, positions, hasSlider };
    this.groups.push(info);
    return { ok: true, count, info };
  }

  private buildSlider(head: Vec2, heading: number, spec: SliderSpec, sign: number, time: number): BuiltPath | null {
    const cfg = this.cfg;
    const spanMs = round1(spec.passes * cfg.beatMs);
    const length = cfg.sliderVelocity * spanMs;
    if (length < 2.4 * cfg.radius || length > 600) return null;
    const shapes: SliderSpec[] = [];
    const base = { ...spec, bend: (spec.bend * sign) as 1 | -1, headTurn: spec.headTurn * sign };
    shapes.push(base);
    shapes.push({ ...base, bend: -base.bend as 1 | -1 });
    shapes.push({ ...base, headTurn: 0 });
    shapes.push({ ...base, shape: 'straight' });
    const headings = [0, 25, -25, 50, -50, 90, -90, 135, -135, 180];
    for (const s of shapes) {
      for (const h of headings) {
        const built = buildSliderPath(head, heading + s.headTurn + h, length, s);
        if (!built) continue;
        const pts = samplePath(built.flat, Math.max(4, cfg.radius / 3));
        if (!pathIsClear(built.flat, pts, cfg.radius)) continue;
        if (!this.layout.okSlider(pts, time, built.flat)) continue;
        // Keep the samples with the built path for the layout item.
        (built as BuiltPath & { pts?: Float64Array }).pts = pts;
        return built;
      }
    }
    return null;
  }

  private pushSlider(pos: Vec2, time: number, built: BuiltPath, step: MotifStep, m: Motif, group: number, intensity: number): void {
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
      shape: spec.shape === 'straight' ? 'straight' : spec.shape === 'arc' ? 'arc' : 'curve',
    };
    this.objects.push(s);
    const pts = (built as BuiltPath & { pts?: Float64Array }).pts as Float64Array;
    this.layout.add({ x: pos.x, y: pos.y, time, end: endTime, group, seq: 0, stream: false, pts });
    void m;
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
