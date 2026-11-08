import { useMemo, useState } from 'react';
import { TREND_METRICS, TREND_RANGES, changeOf, dailySeries, trendMetric } from '../../../analytics/trends';
import type { TrendId, TrendRangeId } from '../../../analytics/trends';
import { LineChart } from '../../charts/LineChart';
import { Card, Field, PageHeader, Segmented } from '../../components/ui';
import { EMPTY_STATS, INTRO, changeSentence } from '../../copy';
import { trendValue } from '../../format';
import { useAnalysis } from '../../state/analysis';
import { t } from '../../i18n';

export function Trends() {
  const { data } = useAnalysis();
  const [id, setId] = useState<TrendId>('accuracy');
  const [range, setRange] = useState<TrendRangeId>('30');
  const metric = trendMetric(id);

  const points = useMemo(() => (data ? dailySeries(metric, data.summaries, range, data.now) : []), [data, metric, range]);
  const change = useMemo(() => (data ? changeOf(metric, data.summaries, data.now) : null), [data, metric]);

  if (!data) return <p className="text-ink-2">{t('Loading.')}</p>;
  const fmt = (v: number) => trendValue(metric.unit, metric.decimals, v);

  return (
    <>
      <PageHeader title={t('Trends')} intro={INTRO.trends} />
      {data.summaries.length === 0 ? (
        <Card>
          <p className="text-ink-2">{t(EMPTY_STATS)}</p>
        </Card>
      ) : (
        <Card>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-4">
            <Field label={t('Metric')}>
              <select aria-label={t('Metric')} value={id} onChange={(e) => setId(e.target.value as TrendId)}>
                {TREND_METRICS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            <Segmented
              legend={t('Range')}
              value={range}
              onChange={setRange}
              options={TREND_RANGES.map((r) => ({ value: r.id, label: t(r.label) }))}
            />
          </div>
          <LineChart
            points={points}
            decimals={metric.decimals}
            format={fmt}
            label={t('{label} by day', { label: metric.label })}
            zeroLine={metric.better === null}
          />
          <p className="mt-3 min-h-6">
            {change
              ? changeSentence(metric.label, fmt(change.before), fmt(change.after), change.diff, change.improved)
              : metric.kind === 'play'
                ? t(
                    'No clear change between the last 14 days and the 14 before. A change shows only when each period has 3 plays and the difference is larger than the usual swing.',
                  )
                : ''}
          </p>
        </Card>
      )}
    </>
  );
}
