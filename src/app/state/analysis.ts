// Loads everything the dashboards need once, and keeps it until a play or a delete changes it.

import { useCallback, useEffect, useState } from 'react';
import { refreshDrill } from '../../analytics/drillEval';
import { detectInsights, INSIGHT_WINDOW_DAYS } from '../../analytics/insights';
import type { Insight } from '../../analytics/insights';
import { allRatings } from '../../analytics/ratings';
import type { RatingInfo } from '../../analytics/ratings';
import { listDrills, saveDrill } from '../../data/drills';
import { getTierHistory } from '../../data/meta';
import { listSummaries, loadPlayData } from '../../data/plays';
import { loadProgress } from '../../data/progress';
import type { Drill, DrillEval, PlayData, PlaySummary, ProgressRow, TierHistory } from '../../data/schema';
import type { ModuleId, SkillId } from '../../shared/types';

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
  /** The plays insights were found in, with their records. */
  windowPlays: PlayData[];
  drills: { drill: Drill; eval: DrillEval }[];
  tiers: TierHistory;
}

let cache: Promise<Analysis> | null = null;
const listeners = new Set<() => void>();

export function invalidateAnalysis(): void {
  cache = null;
  listeners.forEach((l) => l());
}

async function compute(): Promise<Analysis> {
  const now = Date.now();
  const [summaries, progress, drills, tiers] = await Promise.all([listSummaries(), loadProgress(), listDrills(), getTierHistory()]);

  // Insights read the newest plays only. Drills load their own data below, outside this cap.
  const windowStart = now - INSIGHT_WINDOW_DAYS * DAY;
  const wanted = summaries.filter((s) => s.startedAt >= windowStart && s.hasDetail).slice(0, MAX_DETAIL_PLAYS);
  const windowPlays: PlayData[] = await loadPlayData(wanted);
  const insights = detectInsights(windowPlays, now);

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
    const r = refreshDrill(drill, [...drillPlays, ...after], now, complete);
    if (r.changed) await saveDrill(r.drill).catch(() => undefined);
    evaluated.push({ drill: r.drill, eval: r.eval });
  }
  return { now, summaries, progress, ratings: allRatings(summaries, now), insights, windowPlays, drills: evaluated, tiers };
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
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);

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
        if (alive) setError(e instanceof Error ? e.message : 'Could not read your data.');
      },
    );
    return () => {
      alive = false;
    };
  }, [tick]);

  const reload = useCallback(() => invalidateAnalysis(), []);
  return { data, error, reload };
}
