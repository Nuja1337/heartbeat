// The daily map: its launch, and the plays made from it.

import type { PlaySummary } from '../../data/schema';
import { DAILY_LENGTH_SEC, gradeFor } from '../../shared/catalog';
import { isDailyPlay } from '../../analytics/index';
import { dailySeed } from '../../shared/codes';
import type { GradeId, LaunchRequest, ModuleId } from '../../shared/types';
import { dynamicLaunch, presetDifficulty } from './launch';

/** The player's chosen level, or the suggested one. */
export const dailyLevel = (chosen: number | null, suggested: number): number => chosen ?? suggested;

/**
 * Dynamic at the chosen preset, 90 s, no mods, with the seed fixed to the date. Two players with the same
 * date and level get the same map.
 */
export function dailyLaunch(date: string, level: number, levels: Partial<Record<ModuleId, number>>): LaunchRequest {
  return {
    ...dynamicLaunch({
      presetLevel: level,
      difficulty: presetDifficulty(level),
      mods: [],
      lengthSec: DAILY_LENGTH_SEC,
      seed: dailySeed(date),
      levels,
    }),
    source: { kind: 'daily', date },
  };
}

export interface DailyRow {
  id: string;
  /** The local date the map was for. */
  date: string;
  startedAt: number;
  level: number | null;
  accuracy: number;
  grade: GradeId | null;
  completed: boolean;
}

/** Plays made from the daily map of their date, newest first. A new map started from a daily has another seed and is left out. */
export function dailyHistory(summaries: readonly PlaySummary[]): DailyRow[] {
  const rows: DailyRow[] = [];
  for (const s of summaries) {
    const source = s.launch.source;
    if (source?.kind !== 'daily' || !isDailyPlay(s)) continue;
    rows.push({
      id: s.id,
      date: source.date,
      startedAt: s.startedAt,
      level: s.presetLevel,
      accuracy: s.accuracy,
      grade: gradeFor(s.accuracy, s.counts.miss, s.status),
      completed: s.status === 'completed',
    });
  }
  return rows.sort((a, b) => b.startedAt - a.startedAt);
}

/** The finished play with the highest accuracy for a date, or null when there is none. */
export function bestOfDay(rows: readonly DailyRow[], date: string): DailyRow | null {
  let best: DailyRow | null = null;
  for (const r of rows) if (r.date === date && r.completed && (!best || r.accuracy > best.accuracy)) best = r;
  return best;
}
