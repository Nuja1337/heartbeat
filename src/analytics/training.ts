// Training state from saved plays. Returns: `playStreak` and `dailyStreak` (current and longest run of local days),
// `weeklyGoal` (minutes this local Monday-to-Sunday week against the goal), `suggestedDynamicLevel` (1 to 8),
// `buildDailyPlan` (a DailyPlan with fixed seeds and a plan source on every launch) and `planStepsDone`.

import type { DailyPlan, Drill, PlanStep, PlaySummary } from '../data/schema';
import { DEFAULT_DIFFICULTY, LEVEL_PRESETS, MODES } from '../shared/catalog';
import { dailySeed } from '../shared/codes';
import type { LaunchRequest, ModeId, ModuleId, SkillId } from '../shared/types';
import { dayNumberStart, localDayNumber, longestRun, mondayOf, runEndingAt } from './calendar';
import { SKILL_ORDER } from './demand';
import { recommendationLabel } from './insightCopy';
import { drillLaunch } from './insights';
import type { Insight, Recommendation } from './insights';
import { countsAsPlayed, dailyDays, streakDays } from './milestones';
import type { RatingInfo } from './ratings';

const DAY = 86_400_000;

/* ------------------------------------------------------------ streaks */

export interface StreakInfo {
  /** Consecutive local days ending today, or ending yesterday while today has no play yet. */
  current: number;
  longest: number;
  /** A qualifying play exists today. */
  doneToday: boolean;
  /** The streak is alive but nothing has counted today. */
  atRisk: boolean;
}

function streakOf(days: ReadonlySet<number>, now: number): StreakInfo {
  const today = localDayNumber(now);
  const doneToday = days.has(today);
  const current = doneToday ? runEndingAt(days, today) : runEndingAt(days, today - 1);
  return { current, longest: Math.max(longestRun(days), current), doneToday, atRisk: current > 0 && !doneToday };
}

/** Consecutive local days with at least one saved play that completed or ran 60 s. Today keeps the streak alive until it ends. */
export const playStreak = (summaries: readonly PlaySummary[], now: number): StreakInfo => streakOf(streakDays(summaries), now);

/** Consecutive local days with a completed daily play, by the date on the launch. */
export const dailyStreak = (summaries: readonly PlaySummary[], now: number): StreakInfo => streakOf(dailyDays(summaries), now);

/* -------------------------------------------------------- weekly goal */

export interface WeeklyGoal {
  /** Minutes played since this week's Monday, local time. */
  minutes: number;
  goalMinutes: number;
  /** 0 to 1, or null when there is no goal. */
  fraction: number | null;
  reached: boolean;
  /** Local midnight of Monday, and of the next Monday. */
  weekStart: number;
  weekEnd: number;
  /** Days left in the week, today included. */
  daysLeft: number;
}

export function weeklyGoal(summaries: readonly PlaySummary[], goalMinutes: number, now: number): WeeklyGoal {
  const today = localDayNumber(now);
  const monday = mondayOf(today);
  const weekStart = dayNumberStart(monday);
  const weekEnd = dayNumberStart(monday + 7);
  const minutes = summaries.reduce((m, s) => (s.startedAt >= weekStart && s.startedAt < weekEnd ? m + s.playedMs / 60_000 : m), 0);
  return {
    minutes,
    goalMinutes,
    fraction: goalMinutes > 0 ? Math.min(1, minutes / goalMinutes) : null,
    reached: goalMinutes > 0 && minutes >= goalMinutes,
    weekStart,
    weekEnd,
    daysLeft: monday + 7 - today,
  };
}

/* ------------------------------------------------- suggested level */

const clampLevel = (n: number): number => Math.min(8, Math.max(1, Math.round(n)));

/**
 * The Dynamic level to suggest. From the latest finished preset play in the last 14 days: one up for 95%
 * accuracy or more, one down for under 85% or a failed play. Without one, the rounded mean of the aim, speed
 * and timing ratings. Otherwise 3. Always 1 to 8.
 */
export function suggestedDynamicLevel(
  summaries: readonly PlaySummary[],
  ratings: Partial<Record<SkillId, RatingInfo | null>>,
  now: number,
): number {
  const recent = summaries
    .filter(
      (s) => s.modeId === 'dynamic' && s.presetLevel !== null && s.status !== 'quit' && s.startedAt >= now - 14 * DAY && s.startedAt <= now,
    )
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  if (recent) {
    const step = recent.status === 'failed' || recent.accuracy < 0.85 ? -1 : recent.accuracy >= 0.95 ? 1 : 0;
    return clampLevel(recent.presetLevel! + step);
  }
  const rated = (['aim', 'speed', 'timing'] as const).map((k) => ratings[k]?.rating).filter((v): v is number => typeof v === 'number');
  if (rated.length > 0) return clampLevel(rated.reduce((a, b) => a + b, 0) / rated.length);
  return 3;
}

/* ---------------------------------------------------------- daily plan */

/** The module that trains each skill. */
export const SKILL_MODULE: Record<SkillId, ModuleId> = {
  aim: 'jumps',
  speed: 'streams',
  tracking: 'tracking',
  precision: 'precision',
  timing: 'timing',
  reading: 'reading',
  spin: 'spinning',
};

export const PLAN_WARMUP_SEC = 120;
export const PLAN_DRILL_SEC = 90;
export const PLAN_DYNAMIC_SEC = 120;

export interface PlanProgress {
  /** Saved plays so far. Under 3 gives Jumps and Streams. */
  playCount: number;
  /** Drills from the store. Only active ones are used. */
  drills: readonly Drill[];
  /** From suggestedDynamicLevel. */
  dynamicLevel: number;
}

const planSeed = (date: string, step: number): number => dailySeed(`plan-${date}-${step}`);

function withSource(launch: LaunchRequest, date: string, step: number): LaunchRequest {
  return { ...launch, source: { kind: 'plan', date, step } };
}

interface Candidate {
  rec: Recommendation;
  title: string;
  insight: Insight | null;
}

const moduleOf = (c: Candidate): ModeId => c.rec.modeId;

function skillCandidate(module: ModuleId): Candidate {
  const options = { ...MODES[module].defaultOptions };
  return { rec: { modeId: module, options, label: recommendationLabel(module, options) }, title: MODES[module].label, insight: null };
}

/**
 * One day's plan: a 120 s warm-up, two 90 s drills on different modules and 120 s of Dynamic at the suggested level.
 * Drill A is the top insight's recommendation, or the lowest-rated skill's module. Drill B is the next insight on
 * another module, or the lowest-rated skill's module that A does not use. With fewer than 3 plays A is Jumps and B is
 * Streams. An active drill whose rule and variant match an insight supplies its id.
 */
export function buildDailyPlan(
  date: string,
  insights: readonly Insight[],
  ratings: Partial<Record<SkillId, RatingInfo | null>>,
  progress: PlanProgress,
  levels: Partial<Record<ModuleId, number>>,
  now = Date.now(),
): DailyPlan {
  let candidates: Candidate[];
  if (progress.playCount < 3) {
    candidates = [skillCandidate('jumps'), skillCandidate('streams')];
  } else {
    const fromInsights: Candidate[] = insights
      .filter((i) => i.recommendation !== null)
      .map((i) => ({ rec: i.recommendation!, title: i.title, insight: i }));
    const rated = SKILL_ORDER.map((skill) => ({ skill, rating: ratings[skill]?.rating }))
      .filter((r): r is { skill: SkillId; rating: number } => typeof r.rating === 'number')
      .sort((a, b) => a.rating - b.rating)
      .map((r) => skillCandidate(SKILL_MODULE[r.skill]));
    candidates = [...fromInsights, ...rated, skillCandidate('jumps'), skillCandidate('streams'), skillCandidate('tracking')];
  }
  const a = candidates[0]!;
  const b = candidates.find((c) => moduleOf(c) !== moduleOf(a))!;

  const drillFor = (c: Candidate): string | null => {
    const insight = c.insight;
    if (!insight) return null;
    return progress.drills.find((d) => d.status === 'active' && d.ruleId === insight.ruleId && d.variant === insight.variant)?.id ?? null;
  };

  const steps: PlanStep[] = [];
  const push = (kind: PlanStep['kind'], title: string, launch: LaunchRequest, insightKey: string | null): void => {
    const step = steps.length;
    steps.push({ step, kind, title, launch: withSource(launch, date, step), insightKey });
  };

  push(
    'warmup',
    'Warm-up',
    {
      modeId: 'warmup',
      difficulty: { ...DEFAULT_DIFFICULTY },
      presetLevel: null,
      options: { ...MODES.warmup.defaultOptions },
      mods: [],
      seed: planSeed(date, 0),
      lengthSec: PLAN_WARMUP_SEC,
      levels,
      drillId: null,
    },
    null,
  );
  for (const c of [a, b]) {
    const launch = drillLaunch(c.rec, levels, drillFor(c), planSeed(date, steps.length));
    if (MODES[c.rec.modeId].lengthOptions.includes(PLAN_DRILL_SEC)) launch.lengthSec = PLAN_DRILL_SEC;
    push('drill', c.title, launch, c.insight?.key ?? null);
  }
  const level = clampLevel(progress.dynamicLevel);
  const preset = LEVEL_PRESETS[level - 1]!;
  push(
    'dynamic',
    preset.label,
    {
      modeId: 'dynamic',
      difficulty: { ...preset.difficulty },
      presetLevel: level,
      options: {},
      mods: [],
      seed: planSeed(date, steps.length),
      lengthSec: PLAN_DYNAMIC_SEC,
      levels,
      drillId: null,
    },
    null,
  );
  return { date, createdAt: now, steps };
}

/** A step is done when a saved play from it completed or ran 60 s or more. */
export function isPlanStepDone(plays: readonly PlaySummary[], date: string, step: number): boolean {
  return plays.some((p) => {
    const src = p.launch.source;
    return src?.kind === 'plan' && src.date === date && src.step === step && countsAsPlayed(p);
  });
}

/** One flag per step of the plan, in order. */
export const planStepsDone = (plan: DailyPlan, plays: readonly PlaySummary[]): boolean[] =>
  plan.steps.map((s) => isPlanStepDone(plays, plan.date, s.step));
