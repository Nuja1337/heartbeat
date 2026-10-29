// Daily series and change detection for the Trends tab.

import type { PlaySummary } from '../data/schema';
import { SKILLS } from '../shared/catalog';
import type { SkillId } from '../shared/types';
import { SKILL_ORDER } from './demand';
import { aggOf, ewma, weightedMean, welch } from './stats';

const DAY = 86_400_000;

export type TrendId =
  | 'accuracy'
  | 'timingSd'
  | 'timingMean'
  | 'radial'
  | 'along'
  | 'plays'
  | 'minutes'
  | `skill:${SkillId}`;

export interface TrendMetric {
  id: TrendId;
  label: string;
  unit: string;
  decimals: number;
  /** 'play' metrics have one value per play. 'daily' metrics are totals per day. */
  kind: 'play' | 'daily';
  /** Which direction counts as improvement. null when neither does (offsets). */
  better: 'up' | 'down' | null;
  /** Value of one play and how much it weighs in a day's mean. */
  value?: (s: PlaySummary) => number | null;
  weight?: (s: PlaySummary) => number;
}

/** One target width is two radii, so radii x 50 is a percentage of a width. */
const PCT_WIDTH = 50;

export const TREND_METRICS: TrendMetric[] = [
  {
    id: 'accuracy', label: 'Accuracy', unit: '%', decimals: 1, kind: 'play', better: 'up',
    value: (s) => s.accuracy * 100, weight: (s) => s.objectCount,
  },
  {
    id: 'timingSd', label: 'Timing spread', unit: 'ms', decimals: 1, kind: 'play', better: 'down',
    value: (s) => (s.timing.n >= 20 ? s.timing.sd : null), weight: (s) => s.timing.n,
  },
  {
    id: 'timingMean', label: 'Timing offset', unit: 'ms', decimals: 1, kind: 'play', better: null,
    value: (s) => (s.timing.n >= 20 ? s.timing.mean : null), weight: (s) => s.timing.n,
  },
  {
    id: 'radial', label: 'Distance from center', unit: '% of a width', decimals: 1, kind: 'play', better: 'down',
    value: (s) => (s.aim.n >= 20 ? s.aim.radialMean * PCT_WIDTH : null), weight: (s) => s.aim.n,
  },
  {
    id: 'along', label: 'Overshoot or undershoot', unit: '% of a width', decimals: 1, kind: 'play', better: null,
    value: (s) => (s.aim.n >= 20 ? s.aim.alongMean * PCT_WIDTH : null), weight: (s) => s.aim.n,
  },
  ...SKILL_ORDER.map(
    (skill): TrendMetric => ({
      id: `skill:${skill}`, label: `${SKILLS[skill].label} score`, unit: 'level', decimals: 2, kind: 'play', better: 'up',
      value: (s) => s.skills[skill]?.score ?? null, weight: (s) => s.skills[skill]?.n ?? 1,
    }),
  ),
  { id: 'plays', label: 'Plays per day', unit: 'plays', decimals: 0, kind: 'daily', better: null },
  { id: 'minutes', label: 'Minutes per day', unit: 'min', decimals: 1, kind: 'daily', better: null },
];

export function trendMetric(id: TrendId): TrendMetric {
  return TREND_METRICS.find((m) => m.id === id) ?? TREND_METRICS[0]!;
}

export const TREND_RANGES = [
  { id: '7', label: '7 days', days: 7 },
  { id: '30', label: '30 days', days: 30 },
  { id: '90', label: '90 days', days: 90 },
  { id: 'all', label: 'All', days: null },
] as const;
export type TrendRangeId = (typeof TREND_RANGES)[number]['id'];

/** Whole days since 1970 in the viewer's time zone. */
export function dayIndex(t: number): number {
  return Math.floor((t - new Date(t).getTimezoneOffset() * 60_000) / DAY);
}
export function dayStartMs(day: number): number {
  const approx = day * DAY;
  return approx + new Date(approx).getTimezoneOffset() * 60_000;
}

export interface DayPoint {
  day: number;
  /** Local midnight, ms. */
  t: number;
  value: number;
  /** Weight behind the value: objects, presses or plays. */
  n: number;
  smooth: number;
}

export function dailySeries(metric: TrendMetric, summaries: readonly PlaySummary[], range: TrendRangeId, now: number): DayPoint[] {
  const byDay = new Map<number, PlaySummary[]>();
  for (const s of summaries) {
    const d = dayIndex(s.startedAt);
    byDay.set(d, [...(byDay.get(d) ?? []), s]);
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  const points: { day: number; value: number; n: number }[] = [];
  for (const day of days) {
    const plays = byDay.get(day)!;
    if (metric.kind === 'daily') {
      const value = metric.id === 'plays' ? plays.length : plays.reduce((m, p) => m + p.playedMs, 0) / 60_000;
      points.push({ day, value, n: plays.length });
      continue;
    }
    const vals: number[] = [];
    const weights: number[] = [];
    for (const p of plays) {
      const v = metric.value!(p);
      if (v === null || !Number.isFinite(v)) continue;
      vals.push(v);
      weights.push(Math.max(1, metric.weight!(p)));
    }
    if (vals.length === 0) continue;
    points.push({ day, value: weightedMean(vals, weights), n: weights.reduce((a, b) => a + b, 0) });
  }
  const smooth = ewma(points.map((p) => ({ day: p.day, value: p.value })));
  const out = points.map((p, i): DayPoint => ({ ...p, t: dayStartMs(p.day), smooth: smooth[i]! }));
  const days_ = TREND_RANGES.find((r) => r.id === range)?.days ?? null;
  if (days_ === null) return out;
  const from = dayIndex(now - days_ * DAY);
  return out.filter((p) => p.day >= from);
}

export interface Change {
  before: number;
  after: number;
  /** after - before */
  diff: number;
  t: number;
  nBefore: number;
  nAfter: number;
  /** true when the change is an improvement, null for metrics where neither direction is. */
  improved: boolean | null;
}

/** The last 14 days against the 14 before. Null unless both windows have 3 plays and |t| is 2 or more. */
export function changeOf(metric: TrendMetric, summaries: readonly PlaySummary[], now: number): Change | null {
  if (metric.kind !== 'play') return null;
  const pick = (from: number, to: number): number[] => {
    const out: number[] = [];
    for (const s of summaries) {
      if (s.startedAt < from || s.startedAt >= to) continue;
      const v = metric.value!(s);
      if (v !== null && Number.isFinite(v)) out.push(v);
    }
    return out;
  };
  const after = pick(now - 14 * DAY, now + 1);
  const before = pick(now - 28 * DAY, now - 14 * DAY);
  if (after.length < 3 || before.length < 3) return null;
  const a = aggOf(after);
  const b = aggOf(before);
  const w = welch(a, b);
  if (!(Math.abs(w.t) >= 2)) return null;
  return {
    before: b.mean,
    after: a.mean,
    diff: w.diff,
    t: w.t,
    nBefore: b.n,
    nAfter: a.n,
    improved: metric.better === null ? null : metric.better === 'up' ? w.diff > 0 : w.diff < 0,
  };
}
