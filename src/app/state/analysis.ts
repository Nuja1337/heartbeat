// Loads everything the dashboards need once, and keeps it until a play or a delete changes it.
// The summaries load on their own first, because the streak chip in the top bar needs only those.

import { useCallback, useEffect, useState } from 'react';
// The analytics modules load on first use, so Home's first paint doesn't wait for them.
import type { Insight, RadarAxis, RatingInfo, StreakInfo, WeeklyChange, WeeklyGoal } from '../../analytics/index';
import { listDrills, saveDrill } from '../../data/drills';
import { getInsightSnooze, getTierHistory, patchMilestones } from '../../data/meta';
import { listSummaries, loadPlayData } from '../../data/plays';
import { levelsFromProgress, loadProgress } from '../../data/progress';
import type { DailyPlan, Drill, DrillEval, InsightSnooze, PlayData, PlaySummary, ProgressRow, TierHistory } from '../../data/schema';
import type { ModuleId, SkillId } from '../../shared/types';
import { t } from '../i18n';
import { ensurePlan, planStatus } from './plan';
import type { PlanStatus } from './plan';
import { getSettings } from './store';

const DAY = 86_400_000;
/** Plays whose detail is read for insights and drills. */
const MAX_DETAIL_PLAYS = 60;
/** Most plays loaded for one drill's after-window. */
const MAX_DRILL_PLAYS = 500;

export interface Analysis {
  now: number;
  /** Newest first. */
  summaries: PlaySummary[];
  progress: Partial<Record<ModuleId, ProgressRow>>;
  ratings: Record<SkillId, RatingInfo | null>;
  insights: Insight[];
  /** The insight keys hidden by "Not now", with the time they come back. */
  snoozed: InsightSnooze;
  /** The plays insights were found in, with their records. */
  windowPlays: PlayData[];
  drills: { drill: Drill; eval: DrillEval }[];
  tiers: TierHistory;
  streak: StreakInfo;
  dailyStreak: StreakInfo;
  /** Minutes this week. The goal is read from the settings when it is shown, so a change there shows at once. */
  week: WeeklyGoal;
  changes: WeeklyChange[];
  radar: RadarAxis[];
  radarMax: number;
  /** The Dynamic level to suggest, 1 to 8. */
  suggestedLevel: number;
  /** Today's plan with its progress, or null when it could not be read or saved. */
  plan: (PlanStatus & { plan: DailyPlan }) | null;
}

/**
 * Writes the "drill-better" milestone the first time any drill measures better. It does nothing when the
 * milestone is already stored, and a failed write is tried again on the next analysis. The read and the write are one
 * transaction, so a play saved at the same time can't lose its milestones. `isCurrent` turns the write off for an
 * analysis that was started before the data was deleted.
 */
export async function recordDrillBetter(
  evals: readonly DrillEval[],
  now = Date.now(),
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (!evals.some((e) => e.outcome === 'better')) return;
  try {
    const { recordMilestones } = await import('../../analytics/milestones');
    if (!isCurrent()) return;
    await patchMilestones((history) => (history['drill-better'] ? null : recordMilestones(history, ['drill-better'], now, null)));
  } catch {
    // Storage problems are shown elsewhere.
  }
}

/* ---------------------------------------------------------------- summaries */

let summariesCache: Promise<PlaySummary[]> | null = null;
let cache: Promise<Analysis> | null = null;
const listeners = new Set<() => void>();

/** Bumped by every invalidation. A running analysis that sees a newer number is outdated and must not write. */
let generation = 0;

export function invalidateAnalysis(): void {
  generation++;
  cache = null;
  summariesCache = null;
  listeners.forEach((l) => l());
}

export function loadSummaries(): Promise<PlaySummary[]> {
  if (!summariesCache) {
    summariesCache = listSummaries();
    summariesCache.catch(() => {
      summariesCache = null;
    });
  }
  return summariesCache;
}

function useInvalidation(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);
  return tick;
}

/** The current play streak for the top bar. It reads summaries only and stays null until they are in. */
export function useStreak(): StreakInfo | null {
  const tick = useInvalidation();
  const [streak, setStreak] = useState<StreakInfo | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([loadSummaries(), import('../../analytics/training')])
      .then(([summaries, { playStreak }]) => alive && setStreak(playStreak(summaries, Date.now())))
      .catch(() => alive && setStreak(null));
    return () => {
      alive = false;
    };
    // The tick is the signal to load again. Nothing in the effect reads it.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [tick]);
  return streak;
}

/* ----------------------------------------------------------------- analysis */

async function compute(): Promise<Analysis> {
  const now = Date.now();
  const started = generation;
  const isCurrent = () => generation === started;
  const A = await import('../../analytics/index');
  const { INSIGHT_WINDOW_DAYS } = await import('../../analytics/insights');
  const [summaries, progress, drills, tiers, snoozed] = await Promise.all([
    loadSummaries(),
    loadProgress(),
    listDrills(),
    getTierHistory(),
    getInsightSnooze(),
  ]);

  // Insights read the newest plays only. Drills load their own data below, outside this cap.
  const windowStart = now - INSIGHT_WINDOW_DAYS * DAY;
  const wanted = summaries.filter((s) => s.startedAt >= windowStart && s.hasDetail).slice(0, MAX_DETAIL_PLAYS);
  const windowPlays: PlayData[] = await loadPlayData(wanted);
  const insights = A.detectInsights(windowPlays, now, { snoozed });

  const loaded = new Map(windowPlays.map((p) => [p.summary.id, p]));
  const evaluated: Analysis['drills'] = [];
  for (const drill of drills) {
    if (drill.final) {
      evaluated.push({ drill, eval: drill.final });
      continue;
    }
    // Sessions come from the summaries of every drill play.
    const drillPlays: PlayData[] = summaries.filter((s) => s.drillId === drill.id).map((summary) => ({ summary, records: [] }));
    const first = drillPlays.reduce((m, p) => Math.min(m, p.summary.startedAt), Infinity);
    const candidates = summaries.filter((s) => s.drillId !== drill.id && s.modeId !== drill.modeId && s.startedAt >= first);
    const chosen = candidates.slice(0, MAX_DRILL_PLAYS);
    // A result from partial data is shown but never locked.
    const complete = candidates.length <= MAX_DRILL_PLAYS && candidates.every((s) => s.hasDetail || s.objectCount === 0);
    const missing = chosen.filter((s) => s.hasDetail && !loaded.has(s.id));
    for (const p of await loadPlayData(missing)) loaded.set(p.summary.id, p);
    const after = chosen.map((s) => loaded.get(s.id) ?? { summary: s, records: [] });
    const r = A.refreshDrill(drill, [...drillPlays, ...after], now, complete);
    if (r.changed && isCurrent()) await saveDrill(r.drill).catch(() => undefined);
    evaluated.push({ drill: r.drill, eval: r.eval });
  }
  await recordDrillBetter(
    evaluated.map((e) => e.eval),
    now,
    isCurrent,
  );

  const ratings = A.allRatings(summaries, now);
  const radar = A.radarData(ratings);
  const suggestedLevel = A.suggestedDynamicLevel(summaries, ratings, now);

  // The plan is built once a day and kept. A failure here leaves the rest of the page working.
  let plan: Analysis['plan'] = null;
  try {
    const built = await ensurePlan(A, {
      now,
      insights,
      ratings,
      summaries,
      drills: evaluated.map((e) => e.drill),
      levels: levelsFromProgress(progress),
      dynamicLevel: suggestedLevel,
      isCurrent,
    });
    plan = { plan: built, ...planStatus(built, A.planStepsDone(built, summaries)) };
  } catch {
    plan = null;
  }

  return {
    now,
    summaries,
    progress,
    ratings,
    insights,
    snoozed,
    windowPlays,
    drills: evaluated,
    tiers,
    streak: A.playStreak(summaries, now),
    dailyStreak: A.dailyStreak(summaries, now),
    week: A.weeklyGoal(summaries, getSettings().goals.weeklyMinutes, now),
    changes: A.weeklyChanges(summaries, now),
    radar,
    radarMax: A.radarMax(radar),
    suggestedLevel,
    plan,
  };
}

export function loadAnalysis(): Promise<Analysis> {
  if (!cache) {
    cache = compute();
    cache.catch(() => {
      cache = null;
    });
  }
  return cache;
}

export interface AnalysisState {
  data: Analysis | null;
  error: string | null;
  reload(): void;
}

export function useAnalysis(): AnalysisState {
  const [data, setData] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tick = useInvalidation();

  useEffect(() => {
    let alive = true;
    loadAnalysis().then(
      (a) => {
        if (alive) {
          setData(a);
          setError(null);
        }
      },
      (e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : t('Could not read your data.'));
      },
    );
    return () => {
      alive = false;
    };
    // The tick is the signal to load again. Nothing in the effect reads it.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [tick]);

  const reload = useCallback(() => invalidateAnalysis(), []);
  return { data, error, reload };
}
