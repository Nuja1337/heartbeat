// Record classes and the bins that group taps. Bins are applied at analysis time, so changing them
// needs no migration. Keys look like dg:long:g3, turn:sharp, dir:4, vel:2, motion:stream, td:sharp:long.

import { msg } from '../shared/i18n';
import type { BucketStat } from '../data/schema';
import type { HitRecord, Judgment } from '../shared/types';
import { aggOf, mergeAgg } from './stats';

/* ------------------------------------------------------------ classes */

/** Taps are circles and slider heads. */
export const isTap = (r: HitRecord): boolean => r.kind !== 'spinner';

/** The judgment of the tap itself. Sliders use their head. */
export function tapJudgment(r: HitRecord): Judgment {
  return r.kind === 'slider' ? (r.headJudgment ?? r.judgment) : r.judgment;
}
export const tapMissed = (r: HitRecord): boolean => tapJudgment(r) === 'miss';

export function isStreamNote(r: HitRecord): boolean {
  return isTap(r) && r.features.runLength >= 3 && r.features.spacing !== null && r.features.spacing < 1.6;
}

/** A tap that isn't a stream note, has a distance and comes less than 700 ms after the last object. */
export function isJump(r: HitRecord): boolean {
  const f = r.features;
  return isTap(r) && !isStreamNote(r) && f.distance !== null && f.gapMs !== null && f.gapMs < 700;
}

export function isIsolated(r: HitRecord): boolean {
  return isTap(r) && r.features.gapMs !== null && r.features.gapMs >= 700;
}

export type Motion = 'stream' | 'jump' | 'isolated';
export function motionOf(r: HitRecord): Motion | null {
  if (!isTap(r)) return null;
  if (isStreamNote(r)) return 'stream';
  if (isJump(r)) return 'jump';
  if (isIsolated(r)) return 'isolated';
  return null;
}

/* --------------------------------------------------------------- bins */

export const DISTANCE_BINS = ['stack', 'short', 'medium', 'long', 'far'] as const;
export type DistanceBin = (typeof DISTANCE_BINS)[number];
// Real maps put most jumps between 1 and 3 widths, so the bins are finer there.
const DISTANCE_EDGES = [1, 2, 3, 4.5];
export const DISTANCE_LABELS: Record<DistanceBin, string> = {
  stack: msg('Under 1'),
  short: msg('1 to 2'),
  medium: msg('2 to 3'),
  long: msg('3 to 4.5'),
  far: msg('4.5 and up'),
};

export const GAP_EDGES = [110, 160, 250, 400, 700];
export const GAP_COUNT = GAP_EDGES.length + 1;
export const GAP_LABELS = [msg('Under 110'), msg('110 to 160'), msg('160 to 250'), msg('250 to 400'), msg('400 to 700'), msg('700 and up')];

const VELOCITY_EDGES = [0.4, 0.9, 1.5];
export const VELOCITY_LABELS = [msg('Under 0.4'), msg('0.4 to 0.9'), msg('0.9 to 1.5'), msg('1.5 and up')];

export const TURN_BINS = ['straight', 'wide', 'sharp', 'reversal'] as const;
export type TurnBin = (typeof TURN_BINS)[number];
const TURN_EDGES = [45, 100, 150];
export const TURN_LABELS: Record<TurnBin, string> = {
  straight: msg('Under 45 degrees'),
  wide: msg('45 to 100'),
  sharp: msg('100 to 150'),
  reversal: msg('150 and up'),
};

function binIndex(v: number, edges: readonly number[]): number {
  let i = 0;
  while (i < edges.length && v >= edges[i]!) i++;
  return i;
}

export const distanceBin = (spacing: number): DistanceBin => DISTANCE_BINS[binIndex(spacing, DISTANCE_EDGES)]!;
export const gapBin = (gapMs: number): number => binIndex(gapMs, GAP_EDGES);
export const velocityBin = (v: number): number => binIndex(v, VELOCITY_EDGES);
export const turnBin = (deg: number): TurnBin => TURN_BINS[binIndex(deg, TURN_EDGES)]!;

/** Octant 0 is moving right, then clockwise on screen: 2 is down, 4 is left, 6 is up. */
export function octantOf(directionDeg: number): number {
  return Math.floor(((((directionDeg + 22.5) % 360) + 360) % 360) / 45) % 8;
}

export const OCTANT_NAMES = ['right', 'down and right', 'down', 'down and left', 'left', 'up and left', 'up', 'up and right'];

/* ------------------------------------------------------------ buckets */

/** The bucket keys one tap belongs to. */
export function bucketKeys(r: HitRecord): string[] {
  if (!isTap(r)) return [];
  const f = r.features;
  const keys: string[] = [];
  if (f.spacing !== null && f.gapMs !== null) keys.push(`dg:${distanceBin(f.spacing)}:g${gapBin(f.gapMs)}`);
  if (f.turnAngle !== null) keys.push(`turn:${turnBin(f.turnAngle)}`);
  if (f.turnAngle !== null && f.spacing !== null) keys.push(`td:${turnBin(f.turnAngle)}:${distanceBin(f.spacing)}`);
  if (f.direction !== null) keys.push(`dir:${octantOf(f.direction)}`);
  if (f.velocity !== null) keys.push(`vel:${velocityBin(f.velocity)}`);
  const m = motionOf(r);
  if (m) keys.push(`motion:${m}`);
  return keys;
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const roundAgg = (a: { n: number; mean: number; sd: number }) => ({ n: a.n, mean: round3(a.mean), sd: round3(a.sd) });

/** Per-bucket metrics for a set of records. Errors are in radii. */
export function computeBuckets(records: readonly HitRecord[]): Record<string, BucketStat> {
  interface Acc {
    n: number;
    miss: number;
    t: number[];
    along: number[];
    lat: number[];
    rad: number[];
  }
  const acc = new Map<string, Acc>();
  for (const r of records) {
    if (r.afterPause) continue;
    for (const key of bucketKeys(r)) {
      let a = acc.get(key);
      if (!a) {
        a = { n: 0, miss: 0, t: [], along: [], lat: [], rad: [] };
        acc.set(key, a);
      }
      a.n++;
      if (tapMissed(r)) a.miss++;
      if (r.timingError !== null) a.t.push(r.timingError);
      if (r.aimAlong !== null) a.along.push(r.aimAlong / r.radius);
      if (r.aimLateral !== null) a.lat.push(r.aimLateral / r.radius);
      if (r.aimRadial !== null) a.rad.push(r.aimRadial / r.radius);
    }
  }
  const out: Record<string, BucketStat> = {};
  for (const [key, a] of acc) {
    out[key] = {
      n: a.n,
      miss: a.miss,
      t: roundAgg(aggOf(a.t)),
      along: roundAgg(aggOf(a.along)),
      lat: roundAgg(aggOf(a.lat)),
      rad: roundAgg(aggOf(a.rad)),
    };
  }
  return out;
}

export function mergeBucketStat(a: BucketStat, b: BucketStat): BucketStat {
  return {
    n: a.n + b.n,
    miss: a.miss + b.miss,
    t: mergeAgg(a.t, b.t),
    along: mergeAgg(a.along, b.along),
    lat: mergeAgg(a.lat, b.lat),
    rad: mergeAgg(a.rad, b.rad),
  };
}

/** Combines the buckets of several plays. */
export function mergeBuckets(list: readonly Record<string, BucketStat>[]): Record<string, BucketStat> {
  const out: Record<string, BucketStat> = {};
  for (const buckets of list) {
    for (const [key, stat] of Object.entries(buckets)) {
      const prev = out[key];
      out[key] = prev ? mergeBucketStat(prev, stat) : stat;
    }
  }
  return out;
}

export const missRate = (b: BucketStat | undefined): number | null => (b && b.n > 0 ? b.miss / b.n : null);
