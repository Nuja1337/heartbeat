// Today's plan: read from the meta store, or built once from the insights and ratings and saved.

import type * as Analytics from '../../analytics/index';
import { getPlan, savePlan } from '../../data/meta';
import type { DailyPlan, Drill, PlanStep, PlaySummary } from '../../data/schema';
import { localDateKey } from '../../shared/codes';
import type { ModuleId } from '../../shared/types';

export interface PlanStatus {
  /** One flag per step, in order. */
  done: boolean[];
  /** The first step that is not done, or null when all are. */
  next: PlanStep | null;
  doneCount: number;
}

/** Which steps are done, and which comes next. `done` comes from `planStepsDone`. */
export function planStatus(plan: DailyPlan, done: readonly boolean[]): PlanStatus {
  const flags = plan.steps.map((_, i) => done[i] === true);
  const nextIndex = flags.indexOf(false);
  return { done: flags, next: nextIndex === -1 ? null : plan.steps[nextIndex]!, doneCount: flags.filter(Boolean).length };
}

/** The label on the Today card's button. */
export function planButtonLabel(status: PlanStatus): string | null {
  if (!status.next) return null;
  return status.doneCount === 0 ? "Start today's plan" : `Next: ${status.next.title}`;
}

export interface PlanInput {
  now: number;
  insights: Parameters<typeof Analytics.buildDailyPlan>[1];
  ratings: Parameters<typeof Analytics.buildDailyPlan>[2];
  summaries: readonly PlaySummary[];
  drills: readonly Drill[];
  levels: Partial<Record<ModuleId, number>>;
  dynamicLevel: number;
}

/** Today's stored plan, or a new one that is saved first. A plan that can't be saved is still returned. */
export async function ensurePlan(A: typeof Analytics, input: PlanInput): Promise<DailyPlan> {
  const date = localDateKey(input.now);
  const stored = await getPlan(date).catch(() => undefined);
  if (stored && Array.isArray(stored.steps) && stored.steps.length > 0) return stored;
  const plan = A.buildDailyPlan(
    date,
    input.insights,
    input.ratings,
    { playCount: input.summaries.length, drills: input.drills, dynamicLevel: input.dynamicLevel },
    input.levels,
    input.now,
  );
  await savePlan(plan).catch(() => undefined);
  return plan;
}
