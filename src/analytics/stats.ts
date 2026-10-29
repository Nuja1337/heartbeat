// Plain statistics. Nothing here knows about Flickwise.

import type { Agg } from '../data/schema';

export type { Agg };

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function sum(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : sum(xs) / xs.length;
}

/** Sample standard deviation. 0 below two values. */
export function sd(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

/** Linear-interpolated quantile, q in 0..1. */
export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = clamp(q, 0, 1) * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

export const median = (xs: readonly number[]): number => quantile(xs, 0.5);

export function aggOf(xs: readonly number[]): Agg {
  return { n: xs.length, mean: mean(xs), sd: sd(xs) };
}

/** Combines two aggregates as if their values had been pooled. */
export function mergeAgg(a: Agg, b: Agg): Agg {
  if (a.n === 0) return b;
  if (b.n === 0) return a;
  const n = a.n + b.n;
  const m = (a.n * a.mean + b.n * b.mean) / n;
  const m2a = a.n > 1 ? (a.n - 1) * a.sd * a.sd : 0;
  const m2b = b.n > 1 ? (b.n - 1) * b.sd * b.sd : 0;
  const delta = b.mean - a.mean;
  const m2 = m2a + m2b + (delta * delta * a.n * b.n) / n;
  return { n, mean: m, sd: n > 1 ? Math.sqrt(m2 / (n - 1)) : 0 };
}

/** Mean of weighted values. */
export function weightedMean(values: readonly number[], weights: readonly number[]): number {
  let s = 0;
  let w = 0;
  values.forEach((v, i) => {
    const wi = weights[i] ?? 0;
    s += v * wi;
    w += wi;
  });
  return w === 0 ? 0 : s / w;
}

/**
 * Exponentially weighted moving average over points ordered by day. The weight of a new point is
 * 1 - 2^(-gapDays / halfLifeDays), so a point after a long gap counts for more.
 */
export function ewma(points: readonly { day: number; value: number }[], halfLifeDays = 7): number[] {
  const out: number[] = [];
  let prev = 0;
  points.forEach((p, i) => {
    if (i === 0) {
      prev = p.value;
    } else {
      const gap = Math.max(0, p.day - points[i - 1]!.day);
      const alpha = 1 - Math.pow(2, -gap / halfLifeDays);
      prev = prev + alpha * (p.value - prev);
    }
    out.push(prev);
  });
  return out;
}

export interface WelchResult {
  /** a.mean - b.mean */
  diff: number;
  t: number;
  df: number;
}

/** Welch's t from aggregates. A zero standard error gives an infinite t when the means differ. */
export function welch(a: Agg, b: Agg): WelchResult {
  const diff = a.mean - b.mean;
  const va = a.n > 0 ? (a.sd * a.sd) / a.n : 0;
  const vb = b.n > 0 ? (b.sd * b.sd) / b.n : 0;
  const se2 = va + vb;
  if (a.n < 2 || b.n < 2 || se2 === 0) {
    return { diff, t: diff === 0 ? 0 : diff > 0 ? Infinity : -Infinity, df: Math.max(1, a.n + b.n - 2) };
  }
  const df = (se2 * se2) / ((va * va) / (a.n - 1) + (vb * vb) / (b.n - 1));
  return { diff, t: diff / Math.sqrt(se2), df };
}

/** z for the difference between two proportions, a minus b, using the pooled rate. */
export function twoPropZ(xa: number, na: number, xb: number, nb: number): number {
  if (na === 0 || nb === 0) return 0;
  const pa = xa / na;
  const pb = xb / nb;
  const pool = (xa + xb) / (na + nb);
  const se = Math.sqrt(pool * (1 - pool) * (1 / na + 1 / nb));
  if (se === 0) return pa === pb ? 0 : pa > pb ? Infinity : -Infinity;
  return (pa - pb) / se;
}

/** z for the ratio of two standard deviations, a over b, from the log ratio. */
export function logSdZ(sdA: number, nA: number, sdB: number, nB: number): number {
  if (nA < 3 || nB < 3 || sdA <= 0 || sdB <= 0) return 0;
  const se = Math.sqrt(1 / (2 * (nA - 1)) + 1 / (2 * (nB - 1)));
  return Math.log(sdA / sdB) / se;
}

export interface Regression {
  slope: number;
  intercept: number;
  r2: number;
}

export function linearRegression(xs: readonly number[], ys: readonly number[]): Regression {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { slope: 0, intercept: n === 1 ? ys[0]! : 0, r2: 0 };
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const r2 = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept: my - slope * mx, r2 };
}
