// Milestones. `newMilestones(history, summary, all)` returns the ids a play reaches for the first time,
// and `recordMilestones` adds ids to the stored record. Names and descriptions come from MILESTONES in the catalog.

import type { Milestones, PlaySummary } from '../data/schema';
import { dailySeed } from '../shared/codes';
import type { MilestoneId } from '../shared/types';
import { keyDayNumber, localDayNumber, runEndingAt } from './calendar';

export const STREAK_MIN_MS = 60_000;
const HOUR = 3_600_000;

export const CLEAR_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const CLEAR_ACCURACY = 0.9;

/**
 * A play counts toward the streak and the plan when it completed or ran 60 s. A 60 s map ends just before 60 s of
 * played time, so completing it has to count on its own.
 */
export const countsAsPlayed = (p: Pick<PlaySummary, 'status' | 'playedMs'>): boolean => p.status === 'completed' || p.playedMs >= STREAK_MIN_MS;

/** The calendar days that hold a saved play that counts (see countsAsPlayed), by local start time. */
export function streakDays(plays: readonly PlaySummary[]): Set<number> {
  const days = new Set<number>();
  for (const p of plays) if (countsAsPlayed(p)) days.add(localDayNumber(p.startedAt));
  return days;
}

/** True when the play was made from the daily map of its date, not from a new map started after it. */
export const isDailyPlay = (p: PlaySummary): boolean => {
  const src = p.launch.source;
  return src?.kind === 'daily' && p.launch.seed === dailySeed(src.date);
};

/** Local dates (as day numbers) of completed daily plays, from the launch source and seed. */
export function dailyDays(plays: readonly PlaySummary[]): Set<number> {
  const days = new Set<number>();
  for (const p of plays) {
    const src = p.launch.source;
    if (p.status !== 'completed' || src?.kind !== 'daily' || !isDailyPlay(p)) continue;
    const day = keyDayNumber(src.date);
    if (day !== null) days.add(day);
  }
  return days;
}

export interface MilestoneOptions {
  /** True when a drill was measured as better. Drill evaluation lives outside the save. */
  drillBetter?: boolean;
}

/**
 * The milestones this play reaches for the first time. `all` is every saved play including this one
 * (it is added when missing), and `history` is the stored record, so a milestone is never reported twice.
 */
export function newMilestones(history: Milestones, summary: PlaySummary, all: readonly PlaySummary[], options: MilestoneOptions = {}): MilestoneId[] {
  const plays = all.some((p) => p.id === summary.id) ? all : [...all, summary];
  const reached: MilestoneId[] = [];
  const add = (id: MilestoneId, ok: boolean): void => {
    if (ok && !history[id] && !reached.includes(id)) reached.push(id);
  };
  const done = summary.status === 'completed';

  const finished = plays.filter((p) => p.status === 'completed').length;
  add('first-play', done && finished >= 1);
  add('plays-50', done && finished >= 50);
  add('plays-250', done && finished >= 250);

  const hours = plays.reduce((m, p) => m + p.playedMs, 0) / HOUR;
  add('hours-5', hours >= 5);
  add('hours-25', hours >= 25);

  if (countsAsPlayed(summary)) {
    const run = runEndingAt(streakDays(plays), localDayNumber(summary.startedAt));
    add('streak-7', run >= 7);
    add('streak-30', run >= 30);
  }

  add('combo-100', summary.maxCombo >= 100);
  add('combo-500', summary.maxCombo >= 500);
  add('no-miss', done && summary.modeId === 'dynamic' && summary.launch.lengthSec >= 60 && summary.counts.miss === 0);

  add('daily-7', done && isDailyPlay(summary) && dailyDays(plays).size >= 7);
  add('drill-better', options.drillBetter === true);
  add('placement', done && summary.modeId === 'placement');

  const level = summary.presetLevel;
  if (done && summary.modeId === 'dynamic' && level !== null && (CLEAR_LEVELS as readonly number[]).includes(level) && summary.accuracy >= CLEAR_ACCURACY) {
    add(`clear-${level}` as MilestoneId, true);
  }
  return reached;
}

/** Adds milestones to a stored record. Ids already in it keep their first entry. */
export function recordMilestones(history: Milestones, ids: readonly MilestoneId[], at: number, playId: string | null): Milestones {
  const next: Milestones = { ...history };
  for (const id of ids) if (!next[id]) next[id] = { at, playId };
  return next;
}

