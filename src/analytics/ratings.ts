// Skill ratings and tiers. A rating is a weighted mean of a skill's best scores in the last 60 days.

import type { PlaySummary, TierEvent, TierHistory } from '../data/schema';
import type { SkillId } from '../shared/types';
import { SKILL_ORDER } from './demand';

export const RATING = { windowDays: 60, top: 20, decay: 0.85, provisionalBelow: 5 } as const;
const DAY = 86_400_000;

export interface RatingInfo {
  skill: SkillId;
  rating: number;
  /** Plays that contributed. */
  plays: number;
  provisional: boolean;
  tier: number;
}

export const tierOf = (rating: number): number => Math.floor(rating);

export function skillRating(skill: SkillId, summaries: readonly PlaySummary[], now: number): RatingInfo | null {
  const since = now - RATING.windowDays * DAY;
  const scores: number[] = [];
  for (const s of summaries) {
    const sc = s.skills[skill];
    if (sc && s.startedAt >= since && s.startedAt <= now) scores.push(sc.score);
  }
  if (scores.length === 0) return null;
  scores.sort((a, b) => b - a);
  const top = scores.slice(0, RATING.top);
  let num = 0;
  let den = 0;
  top.forEach((v, i) => {
    const w = Math.pow(RATING.decay, i);
    num += w * v;
    den += w;
  });
  const rating = num / den;
  return { skill, rating, plays: scores.length, provisional: scores.length < RATING.provisionalBelow, tier: tierOf(rating) };
}

export function allRatings(summaries: readonly PlaySummary[], now: number): Record<SkillId, RatingInfo | null> {
  const out = {} as Record<SkillId, RatingInfo | null>;
  for (const skill of SKILL_ORDER) out[skill] = skillRating(skill, summaries, now);
  return out;
}

export function highestTier(history: TierHistory, skill: SkillId): number {
  return (history[skill] ?? []).reduce((m, e) => Math.max(m, e.tier), 0);
}

/** Tiers reached for the first time. Provisional ratings don't count. */
export function newTierEvents(history: TierHistory, ratings: Record<SkillId, RatingInfo | null>): TierEvent[] {
  const out: TierEvent[] = [];
  for (const skill of SKILL_ORDER) {
    const r = ratings[skill];
    if (!r || r.provisional || r.tier < 1) continue;
    if (r.tier > highestTier(history, skill)) out.push({ skill, tier: r.tier });
  }
  return out;
}

export function recordTierEvents(history: TierHistory, events: readonly TierEvent[], at: number): TierHistory {
  const next: TierHistory = { ...history };
  for (const e of events) next[e.skill] = [...(next[e.skill] ?? []), { tier: e.tier, at }];
  return next;
}
