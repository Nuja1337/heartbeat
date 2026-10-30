// Starting a drill from an insight.

import type { NavigateFunction } from 'react-router';
import type { Insight } from '../../analytics/insights';
import { saveDrill } from '../../data/drills';
import { patchMilestones } from '../../data/meta';
import type { Drill, DrillEval, PlayData } from '../../data/schema';
import type { ModuleId } from '../../shared/types';
import { invalidateAnalysis } from './analysis';
import { randomSeed } from './launch';

/** Opens the module setup prefilled for the insight, and records a drill so progress can be measured. */
export async function trainThis(
  insight: Insight,
  drills: readonly Drill[],
  levels: Partial<Record<ModuleId, number>>,
  plays: readonly PlayData[],
  navigate: NavigateFunction,
): Promise<void> {
  if (!insight.recommendation) return;
  const [{ createDrill }, { drillLaunch }] = await Promise.all([import('../../analytics/drillEval'), import('../../analytics/insights')]);
  let drill = drills.find((d) => d.status === 'active' && !d.final && d.ruleId === insight.ruleId && d.variant === insight.variant) ?? null;
  if (!drill) {
    drill = createDrill(insight, crypto.randomUUID(), Date.now(), plays);
    if (drill) {
      try {
        await saveDrill(drill);
        invalidateAnalysis();
      } catch {
        drill = null;
      }
    }
  }
  const prefill = drillLaunch(insight.recommendation, levels, drill?.id ?? null, randomSeed());
  navigate(`/train/${insight.recommendation.modeId}`, { state: { prefill } });
}

/**
 * Writes the "drill-better" milestone the first time any drill measures better. It does nothing when the
 * milestone is already stored, and a failed write is tried again on the next analysis. The read and the write are one
 * transaction, so a play saved at the same time can't lose its milestones. `isCurrent` turns the write off for an
 * analysis that was started before the data was deleted.
 */
export async function recordDrillBetter(evals: readonly DrillEval[], now = Date.now(), isCurrent: () => boolean = () => true): Promise<void> {
  if (!evals.some((e) => e.outcome === 'better')) return;
  try {
    const { recordMilestones } = await import('../../analytics/milestones');
    if (!isCurrent()) return;
    await patchMilestones((history) => (history['drill-better'] ? null : recordMilestones(history, ['drill-better'], now, null)));
  } catch {
    // Storage problems are shown elsewhere.
  }
}
