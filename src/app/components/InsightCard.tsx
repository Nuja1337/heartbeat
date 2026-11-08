import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { Insight } from '../../analytics/index';
import { snoozeUntil } from '../../analytics/snooze';
import { snoozeInsight } from '../../data/meta';
import { currentLevels } from '../../data/progress';
import { invalidateAnalysis, useAnalysis } from '../state/analysis';
import { trainThis } from '../state/drills';
import { t } from '../i18n';
import { Button, Kicker, Notice, Panel } from './ui';

/** An insight with "Train this" and "Not now". Not now hides it for 7 days. */
export function InsightCard({ insight, compact = false }: { insight: Insight; compact?: boolean }) {
  const navigate = useNavigate();
  const { data } = useAnalysis();
  const rec = insight.recommendation;
  const [error, setError] = useState<string | null>(null);
  const train = async () => {
    try {
      const levels = await currentLevels();
      await trainThis(
        insight,
        (data?.drills ?? []).map((d) => d.drill),
        levels,
        data?.windowPlays ?? [],
        navigate,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not start the drill.'));
    }
  };
  const later = async () => {
    try {
      const now = Date.now();
      await snoozeInsight(insight.key, snoozeUntil(7, now), now);
      invalidateAnalysis();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not hide this insight.'));
    }
  };
  return (
    <Panel as="article">
      <Kicker>{insight.title}</Kicker>
      <p className={`mt-3 ${compact ? '' : 'text-lg'}`}>{insight.text}</p>
      <p className="mt-1 text-sm text-ink-2">{insight.basis}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {rec && (
          <Button variant="primary" disabled={!data} onClick={() => void train()}>
            {t('Train this')}
          </Button>
        )}
        <Button variant="ghost" onClick={() => void later()}>
          {t('Not now')}
        </Button>
        {rec && <span className="text-sm text-ink-2">{t('Opens {label}.', { label: rec.label })}</span>}
      </div>
      {error && (
        <div className="mt-3">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
    </Panel>
  );
}
