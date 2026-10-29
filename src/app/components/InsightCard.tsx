import { useNavigate } from 'react-router';
import type { Insight } from '../../analytics/insights';
import { currentLevels } from '../../data/progress';
import { useAnalysis } from '../state/analysis';
import { trainThis } from '../state/drills';
import { useState } from 'react';
import { Button, Card, Notice } from './ui';

export function InsightCard({ insight, compact = false }: { insight: Insight; compact?: boolean }) {
  const navigate = useNavigate();
  const { data } = useAnalysis();
  const rec = insight.recommendation;
  const [error, setError] = useState<string | null>(null);
  const train = async () => {
    try {
      const levels = await currentLevels();
      await trainThis(insight, (data?.drills ?? []).map((d) => d.drill), levels, data?.windowPlays ?? [], navigate);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the drill.');
    }
  };
  return (
    <Card as="article">
      <div className="text-xs font-semibold uppercase tracking-wider text-accent">{insight.title}</div>
      <p className={`mt-1 ${compact ? '' : 'text-lg'}`}>{insight.text}</p>
      <p className="mt-1 text-sm text-ink-2">{insight.basis}</p>
      {rec && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={!data} onClick={() => void train()}>
            Train this
          </Button>
          <span className="text-sm text-ink-2">Opens {rec.label}.</span>
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
    </Card>
  );
}
