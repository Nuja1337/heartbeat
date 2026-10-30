import { useMemo, useState } from 'react';
import { throughputScatter } from '../../../analytics/index';
import { TREND_RANGES, changeOf, dailySeries } from '../../../analytics/index';
import type { TrendMetric } from '../../../analytics/index';
import type { TrendId, TrendRangeId } from '../../../analytics/trends';
import { LineChart } from '../../charts/LineChart';
import { ThroughputScatter } from '../../charts/ThroughputScatter';
import { Card, PageHeader, SectionTitle, Segmented, Stat } from '../../components/ui';
import { EMPTY_STATS, INTRO, changeSentence } from '../../copy';
import { trendValue } from '../../format';
import { useAnalysis } from '../../state/analysis';

// The series functions read only `kind`, `value` and `weight`, so these metrics carry a TrendId that is never looked up.
const metric = (m: Omit<TrendMetric, 'id' | 'kind'> & { key: string }): TrendMetric => ({ ...m, id: m.key as TrendId, kind: 'play' });

const THROUGHPUT = metric({
  key: 'throughput', label: 'Throughput', unit: 'bits/s', decimals: 2, better: 'up',
  value: (s) => s.throughput?.bitsPerSec ?? null, weight: (s) => s.throughput?.n ?? 1,
});

const MOVEMENT = [
  metric({
    key: 'leave', label: 'Time before you leave a target', unit: '% of the gap', decimals: 1, better: 'down',
    value: (s) => (s.movement?.leaveFrac != null ? s.movement.leaveFrac * 100 : null), weight: (s) => s.movement?.n ?? 1,
  }),
  metric({
    key: 'first', label: 'Where your first motion stops', unit: '% of a width', decimals: 1, better: null,
    value: (s) => (s.movement?.primaryAlong != null ? s.movement.primaryAlong * 50 : null), weight: (s) => s.movement?.n ?? 1,
  }),
  metric({
    key: 'corrections', label: 'Jumps with a second motion', unit: '%', decimals: 1, better: 'down',
    value: (s) => (s.movement?.correctionShare != null ? s.movement.correctionShare * 100 : null), weight: (s) => s.movement?.n ?? 1,
  }),
];

function Trend({ m, summaries, range, now }: { m: TrendMetric; summaries: Parameters<typeof dailySeries>[1]; range: TrendRangeId; now: number }) {
  const points = useMemo(() => dailySeries(m, summaries, range, now), [m, summaries, range, now]);
  const change = useMemo(() => changeOf(m, summaries, now), [m, summaries, now]);
  const fmt = (v: number) => trendValue(m.unit, m.decimals, v);
  return (
    <Card>
      <SectionTitle>{m.label}</SectionTitle>
      {points.length === 0 ? (
        <p className="text-ink-2">No plays with this number in the range.</p>
      ) : (
        <>
          <LineChart points={points} decimals={m.decimals} format={fmt} label={`${m.label} by day`} zeroLine={m.better === null} />
          <p className="mt-3 min-h-6 text-sm">{change ? changeSentence(m.label, fmt(change.before), fmt(change.after), change.diff, change.improved) : ''}</p>
        </>
      )}
    </Card>
  );
}

export function Aim() {
  const { data } = useAnalysis();
  const [range, setRange] = useState<TrendRangeId>('30');
  const points = useMemo(() => (data ? throughputScatter(data.windowPlays) : []), [data]);
  if (!data) return <p className="text-ink-2">Loading.</p>;
  const latest = data.summaries.find((s) => s.throughput);

  return (
    <>
      <PageHeader title="Aim" intro={INTRO.aim} />
      {data.summaries.length === 0 ? (
        <Card>
          <p className="text-ink-2">{EMPTY_STATS}</p>
        </Card>
      ) : (
        <div className="space-y-8">
          <section>
            <SectionTitle aside="Your newest plays from the last 30 days, up to 60">Throughput by jump</SectionTitle>
            <Card>
              {latest && (
                <div className="mb-4 flex flex-wrap gap-x-12 gap-y-3">
                  <Stat label="Latest play" value={`${latest.throughput!.bitsPerSec.toFixed(2)} bits/s`} sub={`${latest.throughput!.n} jumps counted`} />
                </div>
              )}
              <ThroughputScatter points={points} />
            </Card>
          </section>

          <section>
            <SectionTitle aside={<Segmented legend="Range" value={range} onChange={setRange} options={TREND_RANGES.map((r) => ({ value: r.id, label: r.label }))} />}>
              Over time
            </SectionTitle>
            <div className="space-y-6">
              <Trend m={THROUGHPUT} summaries={data.summaries} range={range} now={data.now} />
              <div className="grid gap-6 xl:grid-cols-2">
                {MOVEMENT.map((m) => (
                  <Trend key={m.id} m={m} summaries={data.summaries} range={range} now={data.now} />
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
