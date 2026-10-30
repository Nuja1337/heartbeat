// Throughput in bits per second from jumps (PLAN-2 section 7.4). `throughputBuckets` returns one row per
// distance-and-gap bucket with at least 8 jumps. `playThroughput` returns the n-weighted mean over those
// rows as `{ n, bitsPerSec }`, or null when fewer than 15 jumps qualify.

import type { HitRecord } from '../shared/types';
import { distanceBin, gapBin, isJump } from './buckets';
import { mean, sd } from './stats';

export const THROUGHPUT_MIN_BUCKET = 8;
export const THROUGHPUT_MIN_TOTAL = 15;

export interface ThroughputBucket {
  key: string;
  n: number;
  /** Mean jump distance, playfield units. */
  distance: number;
  /** Mean target radius, playfield units. */
  radius: number;
  /** Mean time between targets, ms. */
  gapMs: number;
  /** Effective width, units. */
  we: number;
  /** Effective distance, units. */
  de: number;
  /** Nominal index of difficulty, log2(D / 2r + 1). */
  idNominal: number;
  /** Effective index of difficulty, log2(De / We + 1). */
  ide: number;
  /** Bits per second. */
  tp: number;
}

/** Jumps with a direction and a press. Records after a pause are left out. */
function usableJumps(records: readonly HitRecord[]): HitRecord[] {
  return records.filter(
    (r) => !r.afterPause && isJump(r) && r.features.direction !== null && r.aimAlong !== null && r.features.spacing !== null && r.features.gapMs !== null,
  );
}

export function throughputBuckets(records: readonly HitRecord[]): ThroughputBucket[] {
  const groups = new Map<string, HitRecord[]>();
  for (const r of usableJumps(records)) {
    const key = `${distanceBin(r.features.spacing!)}:g${gapBin(r.features.gapMs!)}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  const out: ThroughputBucket[] = [];
  for (const [key, list] of groups) {
    if (list.length < THROUGHPUT_MIN_BUCKET) continue;
    const along = list.map((r) => r.aimAlong!);
    const distance = mean(list.map((r) => r.features.distance!));
    const radius = mean(list.map((r) => r.radius));
    const gapMs = mean(list.map((r) => r.features.gapMs!));
    const we = Math.max(4.133 * sd(along), 1);
    const de = Math.max(0, distance + mean(along));
    const ide = Math.log2(de / we + 1);
    out.push({
      key, n: list.length, distance, radius, gapMs, we, de,
      idNominal: Math.log2(distance / (2 * radius) + 1),
      ide,
      tp: ide / (Math.max(gapMs, 1) / 1000),
    });
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : 1));
}

export function weightedThroughput(buckets: readonly ThroughputBucket[]): { n: number; bitsPerSec: number } | null {
  const n = buckets.reduce((m, b) => m + b.n, 0);
  if (n < THROUGHPUT_MIN_TOTAL) return null;
  return { n, bitsPerSec: buckets.reduce((m, b) => m + b.n * b.tp, 0) / n };
}

export const playThroughput = (records: readonly HitRecord[]): { n: number; bitsPerSec: number } | null =>
  weightedThroughput(throughputBuckets(records));
