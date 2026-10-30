import { Link } from 'react-router';
import { Motif } from '../components/Motif';
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
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
        {modes.map((id) => {
          const mode = MODES[id];
          const isModule = (MODULE_IDS as string[]).includes(id);
          const row = isModule ? data?.progress[id as ModuleId] : undefined;
          return (
            <li key={id}>
              <Link
                to={`/train/${id}`}
                className="fw-panel fw-marks fw-interactive flex h-full flex-col p-4 sm:p-6"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-display text-lg font-semibold">{mode.label}</span>
                  {isModule ? (
                    <Badge tone={row ? 'accent' : 'neutral'}>
                      {row ? `Level ${level(row.level)}` : `Starts at ${DEFAULT_MODULE_LEVEL}`}
                    </Badge>
                  ) : (
                    <Badge>{mode.adaptive ? 'Adaptive' : 'Fixed level'}</Badge>
                  )}
                </span>
                <span className="mt-2 flex-1 text-sm text-ink-2">{mode.description}</span>
                <span className="mt-4 flex items-end justify-between gap-3">
                  <span className="text-xs text-ink-3">{mode.skills.map((s) => SKILLS[s].label).join(', ')}</span>
                  <Motif mode={id} />
                </span>
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
