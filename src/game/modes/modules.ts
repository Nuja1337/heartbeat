// Training module set builders (PLAN section 8). Each module turns a level into a set of objects.

import { LEVEL_LIMITS, MODES, PLAYFIELD_CENTER, levelForDemand, rawDemandAt, windowsForTiming } from '../../shared/catalog';
import type { HitObject, HitRecord, HitWindows, MapSection, ModuleId, ModuleOptions, Vec2 } from '../../shared/types';
import { MapBuilder, angleDiff } from '../map/placement';
import type { BuilderConfig, Motif, SliderSpec } from '../map/placement';
import { curveFamily } from '../map/patterns';
import { createRng } from '../map/rng';
import type { Rng } from '../map/rng';

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const round5 = (x: number) => Math.round(x / 5) * 5;
const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * The highest level at which a module's map still changes. Streams stop getting faster once the gap reaches
 * 50 ms, and Reading stops once the approach time reaches 250 ms, so a staircase gains nothing past that.
 */
export function maxLevelFor(module: ModuleId): number {
  const cap =
    module === 'streams'
      ? levelForDemand('speed', 1000 / 50)
      : module === 'reading'
        ? levelForDemand('reading', 1000 / 250)
        : LEVEL_LIMITS.max;
  return Math.min(LEVEL_LIMITS.max, Math.floor(cap * 20) / 20);
}

export function clampLevel(l: number): number {
  return clamp(l, LEVEL_LIMITS.min, LEVEL_LIMITS.max);
}

const D = (skill: Parameters<typeof rawDemandAt>[0], level: number) => rawDemandAt(skill, level);

/** What a set at a level looks like before any object exists. */
export interface ModuleParams {
  radius: number;
  approachMs: number;
  windows: HitWindows;
}

export function paramsAtLevel(module: ModuleId, level: number): ModuleParams {
  const L = clampLevel(level);
  switch (module) {
    case 'jumps':
      return { radius: Math.max(16, 66 - 3.5 * (L - 1)), approachMs: Math.max(400, 1100 - 50 * (L - 1)), windows: windowsForTiming(4) };
    case 'angles':
      return { radius: Math.max(16, 60 - 3 * (L - 1)), approachMs: Math.max(400, 1100 - 50 * (L - 1)), windows: windowsForTiming(4) };
    case 'streams':
      return { radius: 56, approachMs: 900, windows: windowsForTiming(5) };
    case 'tracking':
      return { radius: 56, approachMs: 900, windows: windowsForTiming(5) };
    case 'spinning':
      return { radius: 60, approachMs: 1000, windows: windowsForTiming(5) };
    case 'precision':
      return { radius: clamp(1000 / D('precision', L), 12, 80), approachMs: 1000, windows: windowsForTiming(4) };
    case 'reading':
      return { radius: 50, approachMs: Math.round(clamp(1000 / D('reading', L), 250, 1800)), windows: windowsForTiming(5) };
    case 'timing': {
      const crisp = round1(clamp(1000 / D('timing', L), 8, 60));
      return { radius: 64, approachMs: 800, windows: { crisp, solid: 2 * crisp, rough: 3 * crisp, early: 3 * crisp + 60 } };
    }
  }
}

export interface SetSpec {
  module: ModuleId;
  level: number;
  options: ModuleOptions;
  /** Adaptive set index, or -1 for sets inside a fixed map. */
  set: number;
  seed: number;
  /** Time of the set's first object. */
  startTime: number;
  indexBase: number;
  groupBase: number;
  /** Objects in the set. Defaults to the mode's set size. */
  size?: number;
  /** Where the first object goes, when the set continues an earlier one. */
  startPos?: Vec2;
}

export interface BuiltSet {
  objects: HitObject[];
  section: MapSection;
  endTime: number;
  groupsUsed: number;
  endPos: Vec2 | null;
}

function configFor(p: ModuleParams, set: number, sliderVelocity = 0, tickDistance = 0): BuilderConfig {
  return {
    radius: p.radius,
    approachMs: p.approachMs,
    windows: p.windows,
    beatMs: 1,
    sliderVelocity,
    tickDistance,
    jumpMinRadii: 2.25,
    minGapMs: 50,
    set,
  };
}

const single = (dist: number, turn: number): Motif => ({ tag: 'jump', steps: [{ off: 0, dist, turn }], beats: 1 });

/** Turn that points the next move along an absolute heading. */
function turnToward(b: MapBuilder, heading: number): number {
  const base =
    b.dirIn ?? (b.prevEnd ? (Math.atan2(PLAYFIELD_CENTER.y - b.prevEnd.y, PLAYFIELD_CENTER.x - b.prevEnd.x) * 180) / Math.PI : 0);
  return angleDiff(base, heading);
}

/** How far a move from pos can go along a heading before it leaves the field. */
function roomAlong(pos: Vec2, headingDeg: number, r: number): number {
  const a = (headingDeg * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const m = r + 8.1;
  let room = Infinity;
  if (ux > 1e-6) room = Math.min(room, (1000 - m - pos.x) / ux);
  else if (ux < -1e-6) room = Math.min(room, (m - pos.x) / ux);
  if (uy > 1e-6) room = Math.min(room, (625 - m - pos.y) / uy);
  else if (uy < -1e-6) room = Math.min(room, (m - pos.y) / uy);
  return Math.max(0, room);
}

/** Try a note at several distances until one fits. Returns the placed distance, or null. */
function placeTap(
  b: MapBuilder,
  time: (dist: number) => number,
  desired: number,
  turn: number,
  tag: Motif['tag'],
): { dist: number; time: number } | null {
  const r = b.cfg.radius;
  const before = b.prevEnd;
  for (const f of [1, 0.92, 0.85, 0.78, 0.7]) {
    const dist = Math.max(desired * f, 2.25 * r * 1.001);
    const t = time(dist);
    const m = single(dist, turn);
    m.tag = tag;
    const res = b.addMotif(m, t, { exact: true });
    if (res.ok) return { dist: before ? dist : 0, time: t };
  }
  return null;
}

function section(start: number, end: number): MapSection {
  return { start, end, intensity: 0.5, focus: 'set' };
}

/* --------------------------------------------------------------- jumps */

function buildJumps(spec: SetSpec, rng: Rng, p: ModuleParams): BuiltSet {
  const b = new MapBuilder(configFor(p, spec.set), rng.fork('place'));
  if (spec.startPos) b.firstPos = spec.startPos;
  const o = spec.options;
  const demand = D('aim', spec.level);
  const n = spec.size ?? MODES.jumps.setSize;
  const focus = o.distanceFocus ?? 'mixed';
  const octant = o.directionFocus ?? null;
  const r = p.radius;
  const gapFor = (d: number) => round5(clamp((1000 * Math.log2(d / (2 * r) + 1)) / demand, 120, 1500));
  let t = spec.startTime;
  if (octant !== null && !spec.startPos) {
    // Start on the far side so the focused moves have room to run.
    const u = { x: Math.cos((octant * Math.PI) / 4), y: Math.sin((octant * Math.PI) / 4) };
    const tx = Math.abs(u.x) > 1e-6 ? (500 - r - 8.1) / Math.abs(u.x) : Infinity;
    const ty = Math.abs(u.y) > 1e-6 ? (312.5 - r - 8.1) / Math.abs(u.y) : Infinity;
    const reach = 0.9 * Math.min(tx, ty);
    b.firstPos = { x: 500 - u.x * reach, y: 312.5 - u.y * reach };
  }
  for (let k = 0; k < n; k++) {
    const kind = focus === 'mixed' ? rng.pick(['short', 'medium', 'long']) : focus;
    const widths = kind === 'short' ? rng.range(1.5, 3) : kind === 'long' ? rng.range(4.5, 7) : rng.range(2.5, 4.5);
    let desired = widths * 2 * r;
    let turn = rng.sign() * rng.range(0, 180);
    if (octant !== null && k > 0 && b.prevEnd) {
      // Two moves along the chosen direction, then one back to make room.
      const forward = k % 3 !== 0;
      const heading = forward ? octant * 45 + rng.range(-15, 15) : octant * 45 + 180 + rng.range(-40, 40);
      const room = roomAlong(b.prevEnd, heading, r);
      if (room >= 2.4 * r) {
        desired = Math.min(desired, (forward ? 0.45 : 0.9) * room);
        turn = turnToward(b, heading);
      }
    }
    const prevT = t;
    const got = k === 0 ? placeTap(b, () => t, desired, turn, 'jump') : placeTap(b, (d) => prevT + gapFor(d), desired, turn, 'jump');
    if (!got) continue;
    t = got.time;
  }
  const objects = b.finalize(spec.indexBase, spec.groupBase, true);
  return finish(spec, b, objects, 1);
}

/* -------------------------------------------------------------- angles */

function buildAngles(spec: SetSpec, rng: Rng, p: ModuleParams): BuiltSet {
  const b = new MapBuilder(configFor(p, spec.set), rng.fork('place'));
  if (spec.startPos) b.firstPos = spec.startPos;
  const n = spec.size ?? MODES.angles.setSize;
  const focus = spec.options.angleFocus ?? 'mixed';
  const demand = D('aim', spec.level);
  const r = p.radius;
  const gap = round5(clamp((1000 * Math.log2(4.5)) / demand, 120, 1500));
  const desired = 7 * r;
  let t = spec.startTime;
  for (let k = 0; k < n; k++) {
    const sharp = focus === 'sharp' || (focus === 'mixed' && Math.floor(k / 4) % 2 === 0);
    const turn = rng.sign() * (sharp ? rng.range(120, 180) : rng.range(0, 60));
    const prevT = t;
    const got = k === 0 ? placeTap(b, () => t, desired, turn, 'jump') : placeTap(b, () => prevT + gap, desired, turn, 'jump');
    if (!got) continue;
    t = got.time;
  }
  return finish(spec, b, b.finalize(spec.indexBase, spec.groupBase, true), 1);
}

/* ------------------------------------------------------------- streams */

function buildStreams(spec: SetSpec, rng: Rng, p: ModuleParams): BuiltSet {
  const b = new MapBuilder(configFor(p, spec.set), rng.fork('place'));
  if (spec.startPos) b.firstPos = spec.startPos;
  const total = spec.size ?? MODES.streams.setSize;
  const r = p.radius;
  const gap = round1(Math.max(50, 1000 / D('speed', spec.level)));
  const s = 0.9 * r;
  const lengths = { short: [3, 5], medium: [6, 12], long: [13, 24] }[spec.options.streamLength ?? 'medium'];
  let t = spec.startTime;
  let placed = 0;
  let guard = 0;
  while (placed < total && guard++ < 40) {
    let n = rng.int(lengths[0] as number, lengths[1] as number);
    n = Math.min(n, total - placed);
    // A long stream has to curve to stay inside the field.
    let turn = rng.sign() * rng.range(0, 8);
    if ((n - 1) * s > 450) turn = rng.sign() * Math.min(330 / n, Math.max(8, (2 * Math.asin(s / 420) * 180) / Math.PI));
    const steps = Array.from({ length: n }, (_, k) => ({
      off: k * gap,
      dist: k === 0 ? 8 * r : s,
      turn: k === 0 ? rng.sign() * rng.range(0, 180) : turn,
    }));
    const m: Motif = { tag: 'stream', steps, beats: 1, stream: true, spacing: s, minDist: 0.6 * r };
    let start = placed === 0 ? t : t + Math.max(350, 4 * gap);
    let res = b.addMotif(m, start, { exact: true });
    if (!res.ok) {
      start += 300;
      res = b.addMotif({ ...m, steps: m.steps.map((st, k) => (k === 0 ? { ...st, dist: 5 * r } : st)) }, start, { exact: true });
    }
    if (!res.ok) {
      t = start;
      continue;
    }
    placed += res.count;
    t = b.lastEnd;
  }
  return finish(spec, b, b.finalize(spec.indexBase, spec.groupBase), b.groupCount);
}

/* ------------------------------------------------------------ tracking */

function buildTracking(spec: SetSpec, rng: Rng, p: ModuleParams): BuiltSet {
  const r = p.radius;
  const velocity = (D('tracking', spec.level) * 2 * r) / 1000;
  const b = new MapBuilder(configFor(p, spec.set, velocity, 1.5 * r), rng.fork('place'));
  if (spec.startPos) b.firstPos = spec.startPos;
  const n = spec.size ?? MODES.tracking.setSize;
  const focus = spec.options.sliderFocus ?? 'mixed';
  let t = spec.startTime;
  let placed = 0;
  let guard = 0;
  while (placed < n && guard++ < 30) {
    const length = rng.range(4 * r, 9 * r);
    const spanMs = length / velocity;
    let repeats = 0;
    if (focus === 'repeats') repeats = rng.int(1, 2);
    else if (spec.level >= 3) repeats = rng.weighted([0.6, 0.3, 0.1]);
    const shapeIdx = focus === 'straight' ? 0 : focus === 'curves' ? rng.pick([1, 2]) : rng.weighted([0.3, 0.4, 0.3]);
    const slider: SliderSpec = {
      passes: spanMs,
      repeats,
      shape: (['straight', 'arc', 'curve'] as const)[shapeIdx] as SliderSpec['shape'],
      bend: rng.sign(),
      headTurn: rng.sign() * rng.range(0, 60),
      k: rng.range(0.15, 0.5),
      alpha: rng.range(20, 60),
      family: curveFamily(rng, 5),
      legs: 2,
    };
    const m: Motif = {
      tag: 'slider',
      steps: [{ off: 0, dist: rng.range(4 * r, 8 * r), turn: rng.sign() * rng.range(0, 180), slider }],
      beats: 1,
    };
    let res = b.addMotif(m, t, { exact: true });
    if (!res.ok)
      res = b.addMotif(
        {
          ...m,
          steps: [
            { ...(m.steps[0] as Motif['steps'][number]), dist: 3 * r, turn: 0, slider: { ...slider, shape: 'straight', repeats: 0 } },
          ],
        },
        t,
        { exact: true },
      );
    if (res.ok) {
      placed++;
      t = b.lastEnd + 450;
    } else {
      t += 200;
    }
  }
  return finish(spec, b, b.finalize(spec.indexBase, spec.groupBase), b.groupCount);
}

/* ------------------------------------------------------------ spinning */

function buildSpinning(spec: SetSpec, _rng: Rng, p: ModuleParams): BuiltSet {
  const b = new MapBuilder(configFor(p, spec.set), _rng.fork('place'));
  const n = spec.size ?? MODES.spinning.setSize;
  const rot = Math.max(0.5, Math.round((D('spin', spec.level) * 3 * 2) / 60) / 2);
  let t = spec.startTime;
  for (let k = 0; k < n; k++) {
    const s = b.addSpinner(t, 3000, rot, 0.5);
    t = s.endTime + 1500;
  }
  return finish(spec, b, b.finalize(spec.indexBase, spec.groupBase), b.groupCount);
}

/* ------------------------------------------------- tap-only module sets */

/** Precision, reading and timing share one loop. They differ in the distance, the gap and the lead-in. */
function buildTaps(
  spec: SetSpec,
  rng: Rng,
  p: ModuleParams,
  gapAt: (k: number) => number,
  widths: [number, number],
  size: number,
): BuiltSet {
  const b = new MapBuilder(configFor(p, spec.set), rng.fork('place'));
  if (spec.startPos) b.firstPos = spec.startPos;
  const r = p.radius;
  let t = spec.startTime;
  for (let k = 0; k < size; k++) {
    const desired = Math.max(rng.range(widths[0], widths[1]) * 2 * r, 2.3 * r);
    const turn = rng.sign() * rng.range(0, 180);
    const prevT = t;
    const got = k === 0 ? placeTap(b, () => t, desired, turn, 'jump') : placeTap(b, () => prevT + gapAt(k), desired, turn, 'jump');
    if (!got) continue;
    t = got.time;
  }
  return finish(spec, b, b.finalize(spec.indexBase, spec.groupBase, true), 1);
}

function finish(spec: SetSpec, b: MapBuilder, objects: HitObject[], groupsUsed: number): BuiltSet {
  const first = objects[0];
  const last = objects[objects.length - 1];
  const end = last ? (last.kind === 'circle' ? last.time : last.endTime) : spec.startTime;
  const endPos = b.prevEnd ? { x: b.prevEnd.x, y: b.prevEnd.y } : null;
  return { objects, section: section(first ? first.time : spec.startTime, end), endTime: end, groupsUsed, endPos };
}

export function buildSet(spec: SetSpec): BuiltSet {
  const level = clampLevel(spec.level);
  const full: SetSpec = { ...spec, level };
  const rng = createRng(spec.seed);
  const p = paramsAtLevel(spec.module, level);
  switch (spec.module) {
    case 'jumps':
      return buildJumps(full, rng, p);
    case 'angles':
      return buildAngles(full, rng, p);
    case 'streams':
      return buildStreams(full, rng, p);
    case 'tracking':
      return buildTracking(full, rng, p);
    case 'spinning':
      return buildSpinning(full, rng, p);
    case 'precision':
      return buildTaps(full, rng, p, () => 650, [1.5, 3], spec.size ?? MODES.precision.setSize);
    case 'reading':
      return buildTaps(full, rng, p, (k) => (k % 4 === 0 ? 400 : 200), [2, 4], spec.size ?? MODES.reading.setSize);
    case 'timing': {
      const gapRng = rng.fork('rhythm');
      const gaps = [500, 250, 375, 125];
      return buildTaps(
        full,
        rng,
        p,
        () => gaps[gapRng.weighted([0.35, 0.35, 0.15, 0.15])] as number,
        [1.2, 2],
        spec.size ?? MODES.timing.setSize,
      );
    }
  }
}

/* ------------------------------------------------------------- success */

/** Did this object count as a success for the module that played it? */
export function isSuccess(module: ModuleId, r: HitRecord): boolean {
  switch (module) {
    case 'jumps':
    case 'angles':
    case 'reading':
      return r.judgment !== 'miss';
    case 'streams':
      return r.judgment === 'crisp' || r.judgment === 'solid';
    case 'tracking':
      return r.headJudgment !== 'miss' && r.slider !== null && r.slider.trackedFraction >= 0.9;
    case 'spinning':
      return r.spinner !== null && r.spinner.rotations >= r.spinner.rotationsRequired;
    case 'precision':
      return r.judgment !== 'miss' && r.aimRadial !== null && r.aimRadial <= 0.5 * r.radius;
    case 'timing':
      return r.judgment === 'crisp';
  }
}

export function successShare(module: ModuleId, records: readonly HitRecord[]): number {
  if (records.length === 0) return 1;
  let ok = 0;
  for (const r of records) if (isSuccess(module, r)) ok++;
  return ok / records.length;
}
