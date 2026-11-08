// The pattern library as turtle programs (PLAN section 7). A motif is a list of steps; MapBuilder places them.

import { flowShare, halfBeatProb, JUMP_MIN_RADII, jumpDistance, sliderSpanBeatsOptions, streamMaxTurn, streamSpacing } from './difficulty';
import type { GenParams, PatternKind } from './difficulty';
import type { CurveFamily, Motif, MotifStep, SliderSpec } from './placement';
import type { Rng } from './rng';

export interface PatternCtx {
  rng: Rng;
  p: GenParams;
  /** Section intensity, 0..1. */
  intensity: number;
  /** Most beats the motif may take. */
  maxBeats: number;
  /** Turns shared by every motif of a section, so flow runs carry across motifs. */
  turns?: () => number;
}

/** Turns for a run of jumps. Flow runs bend one way, sharp turns alternate. */
export function turnSource(rng: Rng, p: GenParams): () => number {
  const pFlow = flowShare(p.complexity);
  let flowLeft = 0;
  let flowSign: number = rng.sign();
  let sharpSign: number = rng.sign();
  return () => {
    if (flowLeft > 0) {
      flowLeft--;
      return flowSign * rng.range(15, 75);
    }
    if (rng.chance(pFlow)) {
      flowLeft = rng.int(3, 6) - 1;
      flowSign = rng.sign();
      return flowSign * rng.range(15, 75);
    }
    sharpSign = -sharpSign;
    return sharpSign * rng.range(110, 180);
  };
}

/** Gaps in beats that add up to `total`, each 1 or 1/2. */
function gapsFor(rng: Rng, pHalf: number, total: number): number[] {
  const out: number[] = [];
  let rem = total;
  while (rem > 1e-9) {
    const half = rem < 1 ? true : rng.chance(pHalf);
    const g = half ? 0.5 : 1;
    out.push(g);
    rem -= g;
  }
  return out;
}

function offsets(gaps: number[]): number[] {
  const out: number[] = [];
  let t = 0;
  for (const g of gaps) {
    out.push(t);
    t += g;
  }
  return out;
}

function stepsOf(offs: number[], dist: number, turns: (k: number) => number): MotifStep[] {
  return offs.map((off, k) => ({ off, dist, turn: turns(k) }));
}

function jumpChain(ctx: PatternCtx): Motif | null {
  const { rng, p, intensity } = ctx;
  const total = Math.floor(Math.min(4, ctx.maxBeats));
  if (total < 1) return null;
  const gaps = gapsFor(rng, halfBeatProb(p, intensity), total);
  const dist = jumpDistance(p, total / gaps.length, intensity);
  const next = ctx.turns ?? turnSource(rng, p);
  return { tag: 'jump', steps: stepsOf(offsets(gaps), dist, () => next()), beats: total };
}

function backForth(ctx: PatternCtx): Motif | null {
  const { rng, p, intensity } = ctx;
  const total = Math.floor(Math.min(4, ctx.maxBeats));
  if (total < 3) return null;
  const gaps = gapsFor(rng, halfBeatProb(p, intensity), total);
  const dist = jumpDistance(p, total / gaps.length, intensity);
  const next = ctx.turns ?? turnSource(rng, p);
  // The anchor pair has to swing far enough that its second pass clears the first.
  const need = (Math.asin(Math.min(1, (2.2 * p.radius) / dist)) * 180) / Math.PI;
  const drift = rng.sign() * Math.min(40, Math.max(6, need / 2 + rng.range(0, 4)));
  const lead = next();
  return { tag: 'backforth', steps: stepsOf(offsets(gaps), dist, (k) => (k === 0 ? lead : 180 + drift)), beats: total };
}

function triangle(ctx: PatternCtx): Motif | null {
  const { rng, p, intensity } = ctx;
  if (ctx.maxBeats < 3) return null;
  const dist = Math.max(jumpDistance(p, 0.5, intensity), 3.9 * p.radius);
  const s = rng.sign();
  const rot = rng.sign() * 20;
  const lead = (ctx.turns ?? turnSource(rng, p))();
  const offs = [0, 0.5, 1, 1.5, 2, 2.5];
  return { tag: 'triangle', steps: stepsOf(offs, dist, (k) => (k === 0 ? lead : s * 120 + (k % 3 === 0 ? rot : 0))), beats: 3 };
}

function square(ctx: PatternCtx): Motif | null {
  const { rng, p, intensity } = ctx;
  if (ctx.maxBeats < 2) return null;
  const s = rng.sign();
  const lead = (ctx.turns ?? turnSource(rng, p))();
  const long = ctx.maxBeats >= 4 && rng.chance(0.5);
  const gap = long ? 1 : 0.5;
  const n = long ? 4 : ctx.maxBeats >= 4 ? 8 : 4;
  // Eight notes make two loops, so the second one turns 45 degrees to clear the first.
  const rot = n === 8 ? 45 : rng.chance(0.5) ? 0 : 45;
  const dist = Math.max(jumpDistance(p, gap, intensity), n === 8 ? 4 * p.radius : 0);
  const offs = Array.from({ length: n }, (_, k) => k * gap);
  const beats = Math.ceil(n * gap);
  return { tag: 'square', steps: stepsOf(offs, dist, (k) => (k === 0 ? lead : s * 90 + (k % 4 === 0 ? s * rot : 0))), beats };
}

function star(ctx: PatternCtx): Motif | null {
  const { rng, p, intensity } = ctx;
  if (ctx.maxBeats < 3) return null;
  const dist = Math.max(jumpDistance(p, 0.5, intensity), 3.5 * p.radius);
  const s = rng.sign();
  const lead = (ctx.turns ?? turnSource(rng, p))();
  return { tag: 'star', steps: stepsOf([0, 0.5, 1, 1.5, 2], dist, (k) => (k === 0 ? lead : s * 144)), beats: 3 };
}

function flow(ctx: PatternCtx): Motif | null {
  const { rng, p, intensity } = ctx;
  const total = Math.floor(Math.min(rng.int(3, 6), ctx.maxBeats));
  if (total < 2) return null;
  const s = rng.sign();
  const bend = s * rng.range(15, 45);
  // The rhythm follows density like a jump chain does.
  const gaps = gapsFor(rng, halfBeatProb(p, intensity), total);
  // Stay under one full turn so the curve never lands on itself.
  const n = Math.min(gaps.length, Math.floor(330 / Math.abs(bend)) + 1);
  if (n < 3) return null;
  const offs = offsets(gaps.slice(0, n));
  const dist = jumpDistance(p, total / gaps.length, intensity);
  const ramp = rng.sign() * 0.1;
  const lead = (ctx.turns ?? turnSource(rng, p))();
  const steps: MotifStep[] = offs.map((off, k) => {
    const f = n > 1 ? (2 * k) / (n - 1) - 1 : 0;
    return { off, dist: dist * (1 + ramp * f), turn: k === 0 ? lead : bend };
  });
  return { tag: 'flow', steps, beats: Math.ceil((offs[n - 1] as number) + (gaps[n - 1] as number)) };
}

function streamNotes(ctx: PatternCtx, tag: 'stream' | 'burst'): Motif | null {
  const { rng, p, intensity } = ctx;
  const s = streamSpacing(p);
  const maxN = Math.floor(4 * (ctx.maxBeats - 1)) + 1;
  let n: number;
  if (tag === 'burst') {
    n = Math.min(rng.int(3, 5), maxN);
  } else {
    const lo = Math.max(3, Math.round(0.4 * p.streamMaxLength));
    n = Math.min(rng.int(lo, Math.max(lo, p.streamMaxLength)), maxN);
    if (n >= 5) n -= (n - 1) % 4;
  }
  if (n < 3) return null;
  const maxTurn = streamMaxTurn(p);
  // Keep the whole stream inside the field: a long one has to curve.
  let shape = rng.weighted([0.3, 0.4, 0.3]);
  const extent = (n - 1) * s;
  let turn = 0;
  if (extent > 520) {
    const tMin = (2 * Math.asin(Math.min(1, s / 420)) * 180) / Math.PI;
    n = Math.min(n, Math.max(3, Math.floor(330 / Math.max(tMin, 1)) + 1));
    if (n >= 5) n -= (n - 1) % 4;
    turn = Math.min(maxTurn, Math.max(tMin, rng.range(0.5, 1) * maxTurn));
    if (shape === 0) shape = 1;
  } else if (shape !== 0) {
    turn = rng.range(0.4, 1) * Math.min(maxTurn, 280 / n);
  }
  const sign = rng.sign();
  const lead = (ctx.turns ?? turnSource(rng, p))();
  const connect = jumpDistance(p, 1, intensity);
  const half = Math.floor((n - 1) / 2);
  const steps: MotifStep[] = [];
  for (let k = 0; k < n; k++) {
    let t = 0;
    if (k > 0) {
      if (shape === 1) t = sign * turn;
      else if (shape === 2) t = (k <= half ? sign : -sign) * turn;
      else t = sign * rng.range(0, 2);
    }
    steps.push({ off: k / 4, dist: k === 0 ? connect : s, turn: k === 0 ? lead : t });
  }
  return { tag, steps, beats: Math.ceil((n - 1) / 4 + 1), stream: true, spacing: s, minDist: 0.6 * p.radius };
}

function doubles(ctx: PatternCtx): Motif | null {
  const { rng, p, intensity } = ctx;
  if (ctx.maxBeats < 4) return null;
  const dist = Math.max(jumpDistance(p, 0.5, intensity), JUMP_MIN_RADII * p.radius * 1.05);
  const next = ctx.turns ?? turnSource(rng, p);
  const offs = [0, 0.25, 1, 1.25, 2, 2.25, 3, 3.25];
  const inner = rng.sign() * rng.range(30, 80);
  const lead = next();
  return { tag: 'doubles', steps: stepsOf(offs, dist, (k) => (k === 0 ? lead : k % 2 === 1 ? inner : next())), beats: 4 };
}

export function makeSliderSpec(ctx: PatternCtx, passesWanted?: number, maxRepeatBeats?: number): SliderSpec | null {
  const { rng, p } = ctx;
  const budget = maxRepeatBeats ?? ctx.maxBeats - 1;
  const opts = sliderSpanBeatsOptions(p).filter((b) => b <= budget);
  if (opts.length === 0) return null;
  let passes: number;
  if (passesWanted !== undefined) {
    passes = opts.reduce((best, b) => (Math.abs(b - passesWanted) < Math.abs(best - passesWanted) ? b : best), opts[0] as number);
  } else if (rng.chance(0.6 - 0.04 * p.complexity) && opts.includes(2)) {
    passes = 2;
  } else {
    passes = opts.includes(1) ? 1 : (opts[0] as number);
  }
  let repeats = rng.weighted([0.7, 0.25, 0.05]);
  while (repeats > 0 && passes * (repeats + 1) > budget) repeats--;
  const shape = (['straight', 'arc', 'curve'] as const)[rng.weighted([0.3, 0.4, 0.3])] as SliderSpec['shape'];
  return {
    passes,
    repeats,
    shape,
    bend: rng.sign(),
    headTurn: rng.sign() * rng.range(0, 40),
    k: rng.range(0.15, 0.5),
    alpha: rng.range(20, 60),
    family: curveFamily(rng, p.complexity),
    legs: rng.chance(0.6) ? 2 : 3,
  };
}

/** A curve family by the mix inside the curve share: cubic 0.4, S 0.25, hook 0.15, wave 0.1, zigzag 0.1 (from complexity 6). */
export function curveFamily(rng: Rng, complexity: number): CurveFamily {
  const fams: CurveFamily[] = ['cubic', 's', 'hook', 'wave', 'zigzag'];
  return fams[rng.weighted([0.4, 0.25, 0.15, 0.1, complexity >= 6 ? 0.1 : 0])] as CurveFamily;
}

function sliderMotif(ctx: PatternCtx): Motif | null {
  const spec = makeSliderSpec(ctx);
  if (!spec) return null;
  const lead = (ctx.turns ?? turnSource(ctx.rng, ctx.p))();
  const total = spec.passes * (spec.repeats + 1);
  return {
    tag: 'slider',
    steps: [{ off: 0, dist: jumpDistance(ctx.p, 1, ctx.intensity), turn: lead, slider: spec }],
    beats: Math.ceil(total + 1),
  };
}

function sliderChain(ctx: PatternCtx): Motif | null {
  const { rng, p, intensity } = ctx;
  if (ctx.maxBeats < 4) return null;
  const a = makeSliderSpec(ctx, 1, 1);
  const b = makeSliderSpec(ctx, 1, 1);
  if (!a || !b) return null;
  a.repeats = 0;
  b.repeats = 0;
  const lead = (ctx.turns ?? turnSource(rng, p))();
  const d = jumpDistance(p, 0.5, intensity);
  const t1 = a.passes;
  const t2 = b.passes;
  const bend = rng.sign() * rng.range(10, 40);
  const steps: MotifStep[] = [
    { off: 0, dist: jumpDistance(p, 1, intensity), turn: lead, slider: a },
    { off: t1 + 0.5, dist: d, turn: bend, tag: 'flow' },
    { off: t1 + 1, dist: d, turn: bend, slider: b },
  ];
  return { tag: 'slider', steps, beats: Math.ceil(t1 + 1 + t2 + 1) };
}

/** A run of 1/1 singles, shorter jumps than usual. Used in breaks. */
export function singleRun(ctx: PatternCtx): Motif | null {
  const { rng, p, intensity } = ctx;
  const n = Math.min(4, Math.floor(ctx.maxBeats));
  if (n < 1) return null;
  const dist = Math.max(0.6 * jumpDistance(p, 1, intensity), JUMP_MIN_RADII * p.radius * 1.02);
  const next = ctx.turns ?? turnSource(rng, p);
  return { tag: 'single', steps: stepsOf(offsets(Array<number>(n).fill(1)), dist, () => next() * 0.6), beats: n };
}

function polygon(ctx: PatternCtx): Motif | null {
  const { rng, p, intensity } = ctx;
  if (ctx.maxBeats < 3) return null;
  const n = rng.chance(0.5) ? 5 : 6;
  const turn = n === 5 ? 72 : 60;
  const s = rng.sign();
  // The first and last corner sit one side apart too, so the side has to clear the jump rule.
  const side = Math.max(jumpDistance(p, 0.5, intensity), 3 * p.radius);
  const lead = (ctx.turns ?? turnSource(rng, p))();
  const offs = Array.from({ length: n }, (_, k) => k * 0.5);
  return { tag: 'polygon', steps: stepsOf(offs, side, (k) => (k === 0 ? lead : s * turn)), beats: Math.ceil(n * 0.5) };
}

/** Two or three notes on one spot at 1/4 beat (1/2 below 140 bpm), then a jump on the next beat. */
function stackMotif(ctx: PatternCtx): Motif | null {
  const { rng, p, intensity } = ctx;
  if (ctx.maxBeats < 2) return null;
  const q = p.bpm < 140 ? 0.5 : 0.25;
  const n = rng.chance(0.5) ? 2 : 3;
  const lastOff = (n - 1) * q;
  const jumpOff = Math.floor(lastOff + 1e-9) + 1;
  if (jumpOff + 1 > ctx.maxBeats) return null;
  const next = ctx.turns ?? turnSource(rng, p);
  const steps: MotifStep[] = [{ off: 0, dist: jumpDistance(p, 1, intensity), turn: next(), tag: 'stack' }];
  for (let j = 1; j < n; j++) steps.push({ off: j * q, dist: 0, turn: 0, stack: true, tag: 'stack' });
  steps.push({
    off: jumpOff,
    dist: Math.max(jumpDistance(p, jumpOff - lastOff, intensity), JUMP_MIN_RADII * p.radius * 1.05),
    turn: next(),
    tag: 'jump',
  });
  return { tag: 'stack', steps, beats: jumpOff + 1, minDist: JUMP_MIN_RADII * p.radius };
}

/** Three notes at 1/4 beat, then a jump on the next beat. */
function triple(ctx: PatternCtx): Motif | null {
  const { rng, p, intensity } = ctx;
  if (ctx.maxBeats < 2) return null;
  const s = streamSpacing(p);
  const next = ctx.turns ?? turnSource(rng, p);
  const lead = next();
  const bend = rng.sign() * rng.range(0, 12);
  const steps: MotifStep[] = [0, 1, 2].map((k) => ({
    off: k / 4,
    dist: k === 0 ? jumpDistance(p, 1, intensity) : s,
    turn: k === 0 ? lead : bend,
    tag: 'burst' as const,
  }));
  steps.push({
    off: 1,
    dist: Math.max(jumpDistance(p, 0.5, intensity), JUMP_MIN_RADII * p.radius * 1.05),
    turn: next(),
    tag: 'jump',
  });
  return { tag: 'burst', steps, beats: 2, stream: true, spacing: s, minDist: 0.6 * p.radius };
}

/** A stream cut in the middle by a turn of 70 to 110 degrees and one gap of 1.5 times the others. */
function cutStream(ctx: PatternCtx): Motif | null {
  const { rng, p, intensity } = ctx;
  if (ctx.maxBeats < 3) return null;
  const s = streamSpacing(p);
  const maxN = Math.floor(4 * (ctx.maxBeats - 1 - 0.125)) + 1;
  const cap = Math.min(maxN, p.streamMaxLength, 2 * Math.floor(330 / s + 1));
  if (cap < 8) return null;
  let n = rng.int(8, cap);
  n -= n % 2;
  const half = n / 2;
  const cut = rng.sign() * rng.range(70, 110);
  const lead = (ctx.turns ?? turnSource(rng, p))();
  const connect = jumpDistance(p, 1, intensity);
  const steps: MotifStep[] = [];
  for (let k = 0; k < n; k++) {
    const t = k === 0 ? lead : k === half ? cut : rng.range(-2, 2);
    steps.push({ off: k / 4 + (k >= half ? 0.125 : 0), dist: k === 0 ? connect : s, turn: t });
  }
  return { tag: 'cutstream', steps, beats: Math.ceil((n - 1) / 4 + 0.125 + 1), stream: true, spacing: s, minDist: 0.6 * p.radius };
}

/** Quarter-beat notes that are real jumps, 1.15 to 1.6 widths apart. They curl so the run stays on the field. */
function spacedStream(ctx: PatternCtx): Motif | null {
  const { rng, p, intensity } = ctx;
  if (ctx.maxBeats < 2) return null;
  const d = rng.range(1.15, 1.6) * 2 * p.radius;
  const maxN = Math.min(12, Math.max(5, p.streamMaxLength), Math.floor(4 * (ctx.maxBeats - 1)) + 1, Math.floor(520 / d) + 1);
  if (maxN < 5) return null;
  const n = rng.int(5, maxN);
  const curl = rng.sign() * rng.range(8, 20);
  const lead = (ctx.turns ?? turnSource(rng, p))();
  const steps: MotifStep[] = Array.from({ length: n }, (_, k) => ({
    off: k / 4,
    dist: k === 0 ? jumpDistance(p, 1, intensity) : d,
    turn: k === 0 ? lead : curl,
  }));
  return { tag: 'spacedstream', steps, beats: Math.ceil((n - 1) / 4 + 1), minDist: JUMP_MIN_RADII * p.radius };
}

/** Two jumps, a short slider, then a jump off its end. Where no slider is short enough, it spans one beat. */
function kickSlider(ctx: PatternCtx): Motif | null {
  const { rng, p, intensity } = ctx;
  if (ctx.maxBeats < 4 || p.sliders <= 0) return null;
  const spec = makeSliderSpec({ ...ctx, maxBeats: 2 }, 0.5, 1);
  if (!spec || spec.passes > 1) return null;
  spec.repeats = 0;
  const jd = jumpDistance(p, 1, intensity);
  const next = ctx.turns ?? turnSource(rng, p);
  const steps: MotifStep[] = [
    { off: 0, dist: jd, turn: next(), tag: 'jump' },
    { off: 1, dist: jd, turn: next(), tag: 'jump' },
    { off: 2, dist: jd, turn: next(), slider: spec, tag: 'slider' },
    {
      off: 2 + spec.passes + 0.5,
      dist: Math.max(jumpDistance(p, 0.5, intensity), JUMP_MIN_RADII * p.radius * 1.05),
      turn: next(),
      tag: 'jump',
    },
  ];
  return { tag: 'slider', steps, beats: 4 };
}

export function makeMotif(kind: PatternKind, ctx: PatternCtx): Motif | null {
  switch (kind) {
    case 'jump':
      return jumpChain(ctx);
    case 'backforth':
      return backForth(ctx);
    case 'triangle':
      return triangle(ctx);
    case 'square':
      return square(ctx);
    case 'star':
      return star(ctx);
    case 'flow':
      return flow(ctx);
    case 'stream':
      return streamNotes(ctx, 'stream');
    case 'burst':
      return streamNotes(ctx, 'burst');
    case 'doubles':
      return doubles(ctx);
    case 'slider':
      return sliderMotif(ctx);
    case 'sliderchain':
      return sliderChain(ctx);
    case 'single':
      return singleRun(ctx);
    case 'polygon':
      return polygon(ctx);
    case 'stack':
      return stackMotif(ctx);
    case 'triple':
      return triple(ctx);
    case 'cutstream':
      return cutStream(ctx);
    case 'spacedstream':
      return spacedStream(ctx);
    case 'kick':
      return kickSlider(ctx);
  }
}
