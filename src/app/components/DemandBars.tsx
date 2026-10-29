import { SKILL_ORDER } from '../../analytics/demand';
import type { SkillDemand } from '../../analytics/demand';
import { SKILLS } from '../../shared/catalog';
import type { SkillId } from '../../shared/types';
import { level } from '../format';

/** How demanding a map is for each skill, on the same scale as the Level 1 to 8 presets. */
export function DemandBars({ demand }: { demand: Partial<Record<SkillId, Pick<SkillDemand, 'level'>>> }) {
  return (
    <ul className="space-y-1.5">
      {SKILL_ORDER.map((skill) => {
        const d = demand[skill];
        return (
          <li key={skill} className="grid grid-cols-[6rem_1fr_4.5rem] items-center gap-3 text-sm">
            <span className="text-ink-2">{SKILLS[skill].label}</span>
            <span className="h-1.5 rounded-full bg-line" role="img" aria-label={d ? `${SKILLS[skill].label} demand, level ${level(d.level)}` : `${SKILLS[skill].label}: not in this map`}>
              {d && <span className="block h-1.5 rounded-full bg-accent" style={{ width: `${Math.min(100, (d.level / 10) * 100)}%` }} />}
            </span>
            <span className="text-right">{d ? `Level ${level(d.level)}` : 'none'}</span>
          </li>
        );
      })}
    </ul>
  );
}
