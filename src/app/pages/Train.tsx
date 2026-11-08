import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { MODE_ORDER, MODS, MODULE_IDS } from '../../shared/catalog';
import type { ModeId, ModuleId } from '../../shared/types';
import { ModeCard, PlacementCard, modeLevel } from '../components/ModeCard';
import { Card, PageHeader } from '../components/ui';
import { INTRO } from '../copy';
import { t } from '../i18n';
import { useAnalysis } from '../state/analysis';
import { placementLaunch, startPlay } from '../state/launch';
import { useCurrentLevels } from '../state/levels';
import { getAppState } from '../state/store';

export function Train() {
  const { data } = useAnalysis();
  const navigate = useNavigate();
  const { levels, error: levelsError } = useCurrentLevels();
  // Placement is not in MODE_ORDER, so it never gets a card of its own in the grid.
  const modes = MODE_ORDER.filter((m) => m !== 'dynamic');

  const lastPlayed = useMemo(() => {
    const out: Partial<Record<ModeId, number>> = {};
    for (const s of data?.summaries ?? []) if (out[s.modeId] === undefined) out[s.modeId] = s.startedAt;
    return out;
  }, [data]);

  const noProgress = data !== null && data !== undefined && Object.keys(data.progress).length === 0;
  const startPlacement = () => {
    if (!levels) return;
    startPlay(navigate, placementLaunch(levels), '/train', getAppState().prefs.fullscreen);
  };

  return (
    <>
      <PageHeader title={t('Train')} intro={INTRO.train} />
      {noProgress && (
        <div className="mb-6">
          <PlacementCard disabled={!levels} error={levelsError} onStart={startPlacement} />
        </div>
      )}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
        {modes.map((id) => {
          const isModule = (MODULE_IDS as string[]).includes(id);
          const row = isModule ? data?.progress[id as ModuleId] : undefined;
          return (
            <li key={id}>
              <ModeCard modeId={id} level={modeLevel(id, row, isModule)} lastPlayed={lastPlayed[id] ?? null} />
            </li>
          );
        })}
      </ul>
      <Card className="mt-6">
        <p className="text-sm text-ink-2">
          {t(
            "A module's level changes only after plays with no mods, or with {mirror} alone. {fade} and {spotlight} sets are still saved and counted in your stats.",
            {
              mirror: MODS.mirror.label,
              fade: MODS.fade.label,
              spotlight: MODS.spotlight.label,
            },
          )}
        </p>
      </Card>
    </>
  );
}
