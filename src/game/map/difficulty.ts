// DifficultySettings and mods to generator parameters (PLAN section 6).

import { MOD_SCALE, windowsForTiming } from '../../shared/catalog';
import type { DifficultySettings, HitWindows, ModId } from '../../shared/types';

export interface GenParams {
  /** Radius after Tight or Wide. */
  radius: number;
  /** Hit windows after Tight or Wide, real ms. */
  windows: HitWindows;
  approachMs: number;
  bpm: number;
  beatMs: number;
  density: number;
  spacing: number;
  complexity: number;
  streams: number;
  streamMaxLength: number;
  sliders: number;
  spinners: number;
  timing: number;
  /** Jump speed, units per ms. */
  vJump: number;
  /** Slider ball speed, units per ms. */
  sliderVelocity: number;
}

export const MAX_JUMP = 620;
/** Consecutive jumps keep at least this many radii between centers. Slightly above the 2.2 rule for rounding. */
export const JUMP_MIN_RADII = 2.25;

export function scaleWindows(w: HitWindows, f: number): HitWindows {
  return { crisp: w.crisp * f, solid: w.solid * f, rough: w.rough * f, early: w.early * f };
}

export function deriveParams(d: DifficultySettings, mods: readonly ModId[]): GenParams {
  let radius = d.radius;
  let windows = windowsForTiming(d.timing);
  if (mods.includes('tight')) {
    radius *= MOD_SCALE.tight.radius;
    windows = scaleWindows(windows, MOD_SCALE.tight.windows);
  } else if (mods.includes('wide')) {
    radius *= MOD_SCALE.wide.radius;
    windows = scaleWindows(windows, MOD_SCALE.wide.windows);
  }
  const vJump = 0.25 + 0.12 * d.spacing;
  return {
    radius,
    windows,
    approachMs: d.approachMs,
    bpm: d.bpm,
    beatMs: 60000 / d.bpm,
    density: d.density,
    spacing: d.spacing,
    complexity: d.complexity,
    streams: d.streams,
    streamMaxLength: d.streamMaxLength,
    sliders: d.sliders,
    spinners: d.spinners,
    timing: d.timing,
    vJump,
    sliderVelocity: 0.5 * vJump * (0.85 + 0.03 * d.complexity),
  };
}

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Distance of a jump for a gap in beats at section intensity I. */
export function jumpDistance(p: GenParams, gapBeats: number, intensity: number, accent = 1): number {
  const gap = Math.min(gapBeats, 1) * p.beatMs;
  return clamp(p.vJump * gap * (0.75 + 0.35 * intensity) * accent, JUMP_MIN_RADII * p.radius, MAX_JUMP);
}

/** Share of jumps on half beats. */
export function halfBeatProb(p: GenParams, intensity: number): number {
  return Math.min(0.85, clamp(0.08 * p.density - 0.02, 0.05, 0.8) * (0.6 + 0.6 * intensity));
}

export function restProb(p: GenParams): number {
  return 0.45 - 0.03 * p.density;
}

export function streamSpacing(p: GenParams): number {
  return p.radius * (0.6 + 0.07 * p.spacing);
}

/** Most turn a stream note makes, degrees. */
export function streamMaxTurn(p: GenParams): number {
  return Math.min(28, 8 + 2 * p.complexity);
}

export function flowShare(complexity: number): number {
  return clamp(0.9 - 0.075 * (complexity - 1), 0.2, 0.9);
}

export type PatternKind =
  | 'jump'
  | 'backforth'
  | 'triangle'
  | 'square'
  | 'star'
  | 'flow'
  | 'stream'
  | 'burst'
  | 'doubles'
  | 'slider'
  | 'sliderchain'
  | 'single';

export const PATTERN_KINDS: PatternKind[] = [
  'jump',
  'backforth',
  'triangle',
  'square',
  'star',
  'flow',
  'stream',
  'burst',
  'doubles',
  'slider',
  'sliderchain',
];

/** Weights of the pattern table at section intensity I. */
export function patternWeights(p: GenParams, intensity: number): Record<PatternKind, number> {
  const c = p.complexity;
  const slider = 0.35 * p.sliders * (1.5 - intensity);
  // Triangles, squares, stars and doubles sit on half beats, so they thin out as density falls.
  const halfBeat = 0.2 + (0.8 * (p.density - 1)) / 9;
  return {
    jump: 3,
    backforth: 0.6 + 0.25 * c,
    triangle: c >= 3 ? 0.25 * c * halfBeat : 0,
    square: c >= 4 ? 0.2 * c * halfBeat : 0,
    star: c >= 6 ? 0.12 * c * halfBeat : 0,
    flow: Math.max(0.6, 3 - 0.2 * c),
    stream: 0.35 * p.streams * (0.5 + intensity),
    burst: 0.25 * p.streams,
    doubles: c >= 5 ? 0.1 * c * halfBeat : 0,
    slider: slider * 0.75,
    sliderchain: slider * 0.25,
    single: 0,
  };
}

export function sliderSpanBeatsOptions(p: GenParams, radius = p.radius): number[] {
  const out: number[] = [];
  for (const b of [0.5, 1, 1.5, 2, 3, 4]) {
    const len = p.sliderVelocity * p.beatMs * b;
    if (len >= 2.4 * radius * 1.02 && len <= 600) out.push(b);
  }
  return out;
}

export function sliderTickDistance(p: GenParams): number {
  return p.sliderVelocity * p.beatMs * (p.bpm < 120 ? 0.5 : 1);
}
