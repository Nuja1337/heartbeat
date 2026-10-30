import { SKILL_ORDER } from '../../analytics/demand';
import type { RatingInfo } from '../../analytics/ratings';
import { SKILLS } from '../../shared/catalog';
import type { SkillId } from '../../shared/types';
import { SKILL_EXPLAIN } from '../copy';
import { level } from '../format';
import { Badge } from './ui';

/** Seven skill ratings. `compact` shows a bar per skill and no explanations. */
export function Ratings({ ratings, compact = false }: { ratings: Record<SkillId, RatingInfo | null>; compact?: boolean }) {
  return (
    <ul className={compact ? 'grid gap-2 sm:grid-cols-2' : 'grid gap-3 sm:grid-cols-2'}>
      {SKILL_ORDER.map((skill) => {
        const r = ratings[skill];
        const fill = r ? Math.min(1, r.rating / 8) : 0;
        return (
          <li key={skill} className="rounded-md border border-line bg-bg px-3 py-2" title={SKILL_EXPLAIN[skill]}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{SKILLS[skill].label}</span>
              {r ? (
                <span className="flex items-baseline gap-2">
                  <span className="text-lg font-semibold">{level(r.rating)}</span>
                  <Badge tone={r.provisional ? 'neutral' : 'accent'}>Tier {r.tier}</Badge>
                </span>
              ) : (
                <span className="text-sm text-ink-2">No rating yet</span>
              )}
            </div>
            <div className="mt-1.5 h-1 rounded-full bg-line" role="img" aria-label={r ? `${SKILLS[skill].label} rating ${level(r.rating)} of 8` : 'No rating'}>
              <div className="hb-grow h-1 rounded-full bg-accent" style={{ width: `${fill * 100}%` }} />
            </div>
            {!compact && (
              <p className="mt-1.5 text-sm text-ink-2">
                {r ? `${r.plays} ${r.plays === 1 ? 'play' : 'plays'} in the last 60 days${r.provisional ? ', provisional' : ''}. ` : ''}
                {SKILLS[skill].description}.
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
