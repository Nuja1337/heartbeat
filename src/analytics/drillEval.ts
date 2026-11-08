// "Did drilling help". A drill stores the measurement an insight was based on. Later it measures the
// same thing on plays outside the drill, so the result shows whether the skill carried over and not
// just whether the drill got easier.

import type { Drill, DrillEval, PlayData } from '../data/schema';
import { baselineOf, buildRows, ruleGood, ruleMinN, ruleSample, ruleThreshold, sampleN } from './insights';
import type { Insight, Sample } from './insights';
import { groupSessions } from './sessions';
import { aggOf, logSdZ, twoPropZ, welch } from './stats';

export const DRILL_SESSIONS_NEEDED = 3;
export const DRILL_LOCK_DAYS = 30;
const DAY = 86_400_000;

const DAY_MS = 86_400_000;
/** Fewest values a baseline needs before it replaces the insight's own measurement. */
const MIN_BASELINE = 10;

/**
 * A drill from an insight. Null when the insight has no module or no measurement to compare.
 * Pass the recent plays so the baseline is measured on the same kind of plays the after-data uses,
 * which leave out the drill's own module.
 */
export function createDrill(insight: Insight, id: string, now: number, plays?: readonly PlayData[]): Drill | null {
  if (!insight.recommendation || !insight.baseline) return null;
  let baseline = insight.baseline;
  if (plays) {
    const before = plays.filter(
      (p) => p.summary.startedAt < now && p.summary.startedAt >= now - 30 * DAY_MS && p.summary.modeId !== insight.recommendation!.modeId,
    );
    const sample = ruleSample(insight.ruleId, insight.variant, buildRows(before));
    if (sample && sampleN(sample) >= MIN_BASELINE) baseline = baselineOf(sample);
  }
  return {
    id,
    ruleId: insight.ruleId,
    variant: insight.variant,
    modeId: insight.recommendation.modeId,
    options: insight.recommendation.options,
    title: insight.title,
    createdAt: now,
    baseline,
    status: 'active',
    final: null,
  };
}

function collecting(drill: Drill, sessions: number, nAfter: number, perPlay: number, now: number): DrillEval {
  const minN = ruleMinN(drill.ruleId);
  const missing = Math.max(0, minN - nAfter);
  return {
    outcome: 'collecting',
    sessions,
    sessionsNeeded: DRILL_SESSIONS_NEEDED,
    morePlays: missing === 0 ? 0 : Math.ceil(missing / Math.max(1, perPlay)),
    before: null,
    after: null,
    nBefore: drill.baseline.n,
    nAfter,
    nNeeded: minN,
    stat: null,
    evaluatedAt: now,
  };
}

interface Compared {
  before: number;
  after: number;
  /** Positive when the change is the way the rule wants. */
  improvement: number;
  stat: number;
}

function compare(drill: Drill, sample: Sample): Compared | null {
  const good = ruleGood(drill.ruleId, drill.variant);
  const b = drill.baseline;
  if (b.kind === 'mean' && sample.kind === 'mean') {
    const after = aggOf(sample.values);
    const w = welch(after, { n: b.n, mean: b.mean, sd: b.sd });
    const improvement =
      good === 'zero' ? Math.abs(b.mean) - Math.abs(after.mean) : good === 'up' ? after.mean - b.mean : b.mean - after.mean;
    return { before: b.mean, after: after.mean, improvement, stat: w.t };
  }
  if (b.kind === 'rate' && sample.kind === 'rate') {
    const after = sample.n ? sample.hits / sample.n : 0;
    const z = twoPropZ(sample.hits, sample.n, b.rate * b.n, b.n);
    return { before: b.rate, after, improvement: good === 'up' ? after - b.rate : b.rate - after, stat: z };
  }
  if (b.kind === 'sd' && sample.kind === 'sd') {
    const after = aggOf(sample.values).sd;
    const z = logSdZ(after, sample.values.length, b.sd, b.n);
    return { before: b.sd, after, improvement: b.sd - after, stat: z };
  }
  return null;
}

/** Measures a drill against the plays given. Locked drills return their stored result. */
export function evaluateDrill(drill: Drill, plays: readonly PlayData[], now: number): DrillEval {
  if (drill.final) return drill.final;
  const drillPlays = plays.filter((p) => p.summary.drillId === drill.id).map((p) => p.summary);
  const sessions = groupSessions(drillPlays).length;
  if (drillPlays.length === 0) return collecting(drill, 0, 0, 1, now);

  const first = Math.min(...drillPlays.map((p) => p.startedAt));
  const after = plays.filter((p) => p.summary.drillId !== drill.id && p.summary.modeId !== drill.modeId && p.summary.startedAt >= first);
  const rows = buildRows(after);
  const sample = ruleSample(drill.ruleId, drill.variant, rows);
  const nAfter = sample ? sampleN(sample) : 0;
  const perPlay = after.length > 0 ? nAfter / after.length : 20;
  if (!sample || sessions < DRILL_SESSIONS_NEEDED || nAfter < ruleMinN(drill.ruleId)) {
    return collecting(drill, sessions, nAfter, perPlay || 20, now);
  }
  const c = compare(drill, sample);
  if (!c) return collecting(drill, sessions, nAfter, perPlay, now);

  const significant = Math.abs(c.stat) >= 1.96;
  const enough = c.improvement >= 0.25 * ruleThreshold(drill.ruleId, drill.variant);
  const outcome = significant && enough ? 'better' : significant && c.improvement < 0 ? 'worse' : 'unclear';
  return {
    outcome,
    sessions,
    sessionsNeeded: DRILL_SESSIONS_NEEDED,
    morePlays: 0,
    before: c.before,
    after: c.after,
    nBefore: drill.baseline.n,
    nAfter,
    nNeeded: ruleMinN(drill.ruleId),
    stat: c.stat,
    evaluatedAt: now,
  };
}

/** Evaluates a drill and locks it after 30 days. Returns the drill to store when it changed. */
/** `canLock` is false when the plays given are known to be incomplete, so a partial result is never locked. */
export function refreshDrill(
  drill: Drill,
  plays: readonly PlayData[],
  now: number,
  canLock = true,
): { drill: Drill; eval: DrillEval; changed: boolean } {
  if (drill.final) return { drill, eval: drill.final, changed: false };
  const ev = evaluateDrill(drill, plays, now);
  if (canLock && now - drill.createdAt >= DRILL_LOCK_DAYS * DAY) {
    return { drill: { ...drill, final: ev }, eval: ev, changed: true };
  }
  return { drill, eval: ev, changed: false };
}

export function archiveDrill(drill: Drill, plays: readonly PlayData[], now: number): Drill {
  const ev = drill.final ?? evaluateDrill(drill, plays, now);
  return { ...drill, status: 'archived', final: ev };
}
