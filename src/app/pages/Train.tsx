import { Link } from 'react-router';
import { SKILLS, MODES, MODE_ORDER, DEFAULT_MODULE_LEVEL, MODULE_IDS } from '../../shared/catalog';
import type { ModuleId } from '../../shared/types';
import { Badge, Card, PageHeader } from '../components/ui';
import { INTRO } from '../copy';
import { level } from '../format';
import { useAnalysis } from '../state/analysis';

export function Train() {
  const { data } = useAnalysis();
  const modes = MODE_ORDER.filter((m) => m !== 'dynamic');
  return (
    <>
      <PageHeader title="Train" intro={INTRO.train} />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modes.map((id) => {
          const mode = MODES[id];
          const isModule = (MODULE_IDS as string[]).includes(id);
          const row = isModule ? data?.progress[id as ModuleId] : undefined;
          return (
            <li key={id}>
              <Link
                to={`/train/${id}`}
                className="flex h-full flex-col rounded-lg border border-line bg-surface p-4 transition hover:border-accent focus-visible:border-accent"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-lg font-semibold">{mode.label}</span>
                  {isModule ? (
                    <Badge tone={row ? 'accent' : 'neutral'}>
                      {row ? `Level ${level(row.level)}` : `Starts at ${DEFAULT_MODULE_LEVEL}`}
                    </Badge>
                  ) : (
                    <Badge>{mode.adaptive ? 'Adaptive' : 'Fixed level'}</Badge>
                  )}
                </span>
                <span className="mt-1 flex-1 text-sm text-ink-2">{mode.description}</span>
                {mode.skills.length > 0 && <span className="mt-3 text-xs text-ink-3">{mode.skills.map((s) => SKILLS[s].label).join(', ')}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
      <Card className="mt-6">
        <p className="text-sm text-ink-2">
          A module's level changes only after plays with no mods, or with Mirror alone. Fade and Spotlight sets are still saved and counted in your stats.
        </p>
      </Card>
    </>
  );
}
