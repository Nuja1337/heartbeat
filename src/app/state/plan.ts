// Today's plan: read from the meta store, or built once from the insights and ratings and saved.

import type * as Analytics from '../../analytics/index';
import { RULE_NOUN, ruleTitle } from '../../analytics/insightCopy';
import { getPlan, savePlan } from '../../data/meta';
import type { DailyPlan, Drill, PlanStep, PlaySummary, RuleId } from '../../data/schema';
import { MODES } from '../../shared/catalog';
import { localDateKey } from '../../shared/codes';
import type { ModuleId } from '../../shared/types';
import { t } from '../i18n';

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
  return status.doneCount === 0 ? t("Start today's plan") : t('Next: {title}', { title: stepTitle(status.next) });
}

/** True when the plan is from an earlier day than `now`, for example a page left open past midnight. */
export const planIsStale = (plan: Pick<DailyPlan, 'date'>, now: number): boolean => plan.date !== localDateKey(now);

export interface PlanInput {
  now: number;
  insights: Parameters<typeof Analytics.buildDailyPlan>[1];
  ratings: Parameters<typeof Analytics.buildDailyPlan>[2];
  summaries: readonly PlaySummary[];
  drills: readonly Drill[];
  levels: Partial<Record<ModuleId, number>>;
  dynamicLevel: number;
  /** False when the data was deleted or replaced since this analysis began. The plan is then not saved. */
  isCurrent?: () => boolean;
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
  if (input.isCurrent && !input.isCurrent()) return plan;
  await savePlan(plan).catch(() => undefined);
  return plan;
}

/**
 * A step's title in the player's language. The stored title is the English of the day the plan was made, so the
 * title is worked out again from what the step is: the warm-up, the Dynamic level, or the insight's rule.
 */
export function stepTitle(step: PlanStep): string {
  if (step.kind === 'warmup') return MODES.warmup.label;
  if (step.kind === 'dynamic') {
    return step.launch.presetLevel !== null ? t('Level {level}', { level: step.launch.presetLevel }) : MODES.dynamic.label;
  }
  if (step.insightKey) {
    const colon = step.insightKey.indexOf(':');
    const ruleId = (colon === -1 ? step.insightKey : step.insightKey.slice(0, colon)) as RuleId;
    if (ruleId in RULE_NOUN) return ruleTitle(ruleId, colon === -1 ? null : step.insightKey.slice(colon + 1));
  }
  // A drill without an insight is a module chosen for variety. Its stored title is the module's name of that day.
  return MODES[step.launch.modeId]?.label ?? step.title;
}
