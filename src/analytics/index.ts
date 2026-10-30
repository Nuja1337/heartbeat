// The analytics API the pages call. It holds no code of its own and only re-exports the functions below.
// Insights and drills: detectInsights, playNotes, drillLaunch, snoozeUntil, createDrill, refreshDrill, drillText.
// Summaries and ratings: summarizePlay, allRatings, skillRating, computeBests, dailySeries, changeOf.
// New in 2.0: ratingHistory, radarData, throughputScatter, weeklyChanges, playVsAverage, fatigueCurve,
// demandTimeline, playStreak, dailyStreak, weeklyGoal, suggestedDynamicLevel, buildDailyPlan, planStepsDone,
// newMilestones, recordMilestones.

export { computeBests, pbFlags } from './bests';
export { distinct } from './contrast';
export { createDrill, evaluateDrill, refreshDrill, archiveDrill } from './drillEval';
export { detectInsights, drillLaunch, playNotes } from './insights';
export type { Insight, Recommendation } from './insights';
export { drillText, OUTCOME_LABEL } from './insightCopy';
export { newMilestones, recordMilestones } from './milestones';
export { allRatings, newTierEvents, recordTierEvents, skillRating, skillScoreOf } from './ratings';
export type { RatingInfo } from './ratings';
export { isSnoozed, snoozeUntil } from './snooze';
export { summarizePlay } from './summary';
export { changeOf, dailySeries, trendMetric } from './trends';
export {
  buildDailyPlan, dailyStreak, isPlanStepDone, planStepsDone, playStreak, suggestedDynamicLevel, weeklyGoal,
} from './training';
export type { PlanProgress, StreakInfo, WeeklyGoal } from './training';
export { demandTimeline, fatigueCurve, playVsAverage, radarData, radarMax, ratingHistory, throughputScatter, weeklyChanges } from './views';
export type {
  DemandTimeline, FatiguePoint, PlayVsAverage, RadarAxis, RatingSeries, ThroughputPoint, WeeklyChange,
} from './views';
