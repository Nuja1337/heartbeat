import { useMemo, useState } from 'react';
import {
  DISTANCE_BINS,
  DISTANCE_LABELS,
  GAP_COUNT,
  GAP_LABELS,
  TURN_BINS,
  TURN_LABELS,
  mergeBuckets,
  missRate,
} from '../../../analytics/buckets';
import type { BucketStat } from '../../../data/schema';
import { HeatGrid } from '../../charts/HeatGrid';
import type { HeatCell } from '../../charts/HeatGrid';
import { Rose } from '../../charts/Rose';
import type { RoseSector } from '../../charts/Rose';
import { Card, Field, PageHeader, SectionTitle, Segmented } from '../../components/ui';
import { EMPTY_STATS, INTRO } from '../../copy';
import { useAnalysis } from '../../state/analysis';
import { msg, t } from '../../i18n';
import { lowerLabel } from '../../format';

type Metric = 'miss' | 'along' | 'spread' | 'timing';
const DAY = 86_400_000;

interface MetricDef {
  label: string;
  scale: 'sequential' | 'diverging';
  max(values: number[]): number;
  value(b: BucketStat): number | null;
  text(v: number): string;
  describe(v: number): string;
}

const sign = (v: number) => (v > 0 ? '+' : '');
const METRICS: Record<Metric, MetricDef> = {
  miss: {
    label: msg('Miss rate'),
    scale: 'sequential',
    max: (vs) => Math.max(0.1, ...vs),
    value: (b) => missRate(b),
    text: (v) => `${Math.round(v * 100)}%`,
    describe: (v) => t('{n}% missed', { n: Math.round(v * 100) }),
  },
  along: {
    label: msg('Overshoot or undershoot'),
    scale: 'diverging',
    max: (vs) => Math.max(0.3, ...vs.map(Math.abs)),
    value: (b) => (b.along.n > 0 ? b.along.mean : null),
    text: (v) => `${sign(v)}${Math.round(v * 50)}%`,
    describe: (v) =>
      t('{n}% {side, select, short {short of} other {past}} the center', {
        n: Math.abs(Math.round(v * 50)),
        side: v < 0 ? 'short' : 'past',
      }),
  },
  spread: {
    label: msg('Sideways spread'),
    scale: 'sequential',
    max: (vs) => Math.max(0.2, ...vs),
    value: (b) => (b.lat.n > 1 ? b.lat.sd : null),
    text: (v) => `${Math.round(v * 50)}%`,
    describe: (v) => t('clicks scatter {n}% of a width across the line', { n: Math.round(v * 50) }),
  },
  timing: {
    label: msg('Timing offset'),
    scale: 'diverging',
    max: (vs) => Math.max(20, ...vs.map(Math.abs)),
    value: (b) => (b.t.n > 0 ? b.t.mean : null),
    text: (v) => `${sign(v)}${Math.round(v)}`,
    describe: (v) => t('{n} ms {side, select, early {early} other {late}}', { n: Math.abs(Math.round(v)), side: v < 0 ? 'early' : 'late' }),
  },
};

const RANGES = [
  { value: '30', label: msg('30 days') },
  { value: '90', label: msg('90 days') },
  { value: 'all', label: msg('All plays') },
];

export function Patterns() {
  const { data } = useAnalysis();
  const [metric, setMetric] = useState<Metric>('miss');
  const [range, setRange] = useState('90');
  const def = METRICS[metric];

  const merged = useMemo(() => {
    if (!data) return {};
    const since = range === 'all' ? 0 : data.now - Number(range) * DAY;
    return mergeBuckets(data.summaries.filter((s) => s.startedAt >= since).map((s) => s.buckets));
  }, [data, range]);

  const cellFor = (key: string): HeatCell => {
    const b = merged[key];
    if (!b) return { value: null, n: 0, text: '' };
    const v = def.value(b);
    return { value: v, n: b.n, text: v === null ? '' : def.text(v) };
  };

  const dgValues = DISTANCE_BINS.flatMap((d) => Array.from({ length: GAP_COUNT }, (_, g) => cellFor(`dg:${d}:g${g}`)))
    .filter((c) => c.n >= 20 && c.value !== null)
    .map((c) => c.value!);
  const tdValues = TURN_BINS.flatMap((b) => DISTANCE_BINS.map((d) => cellFor(`td:${b}:${d}`)))
    .filter((c) => c.n >= 20 && c.value !== null)
    .map((c) => c.value!);
  const sectors: RoseSector[] = Array.from({ length: 8 }, (_, o) => {
    const c = cellFor(`dir:${o}`);
    return { octant: o, value: c.value, n: c.n, text: c.value === null ? '' : def.describe(c.value) };
  });
  const dirValues = sectors.filter((s) => s.n >= 20 && s.value !== null).map((s) => s.value!);

  if (!data) return <p className="text-ink-2">{t('Loading.')}</p>;
  const empty = Object.keys(merged).length === 0;

  return (
    <>
      <PageHeader title={t('Patterns')} intro={INTRO.patterns} />
      {empty ? (
        <Card>
          <p className="text-ink-2">{t(EMPTY_STATS)}</p>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-end gap-6">
            <Field label={t('Show')}>
              <Segmented
                legend={t('Metric')}
                value={metric}
                onChange={setMetric}
                options={(Object.keys(METRICS) as Metric[]).map((m) => ({ value: m, label: t(METRICS[m].label) }))}
              />
            </Field>
            <Field label={t('Plays')}>
              <Segmented legend={t('Plays')} value={range} onChange={setRange} options={RANGES.map((r) => ({ ...r, label: t(r.label) }))} />
            </Field>
          </div>

          <Card>
            <SectionTitle aside={t('Rows are the distance between targets in target widths. Columns are the time between them in ms.')}>
              {t('Distance and gap')}
            </SectionTitle>
            <HeatGrid
              rowTitle={t('Distance')}
              colTitle={t('gap')}
              rows={DISTANCE_BINS.map((d) => ({ key: d, label: t(DISTANCE_LABELS[d]) }))}
              cols={GAP_LABELS.map((label, g) => ({ key: `g${g}`, label: t(label) }))}
              cell={(r, c) => cellFor(`dg:${r}:${c}`)}
              scale={def.scale}
              max={def.max(dgValues)}
              describe={(r, c, h) => {
                const gapLabel = GAP_LABELS[Number(c.slice(1))];
                const gap = gapLabel ? t(gapLabel) : '';
                const row = t(DISTANCE_LABELS[r as keyof typeof DISTANCE_LABELS]);
                return h.n === 0
                  ? t('{row} widths, {gap} ms: no taps', { row, gap })
                  : h.n < 20 || h.value === null
                    ? t('{row} widths, {gap} ms: only {n, plural, one {# tap} other {# taps}}', { row, gap, n: h.n })
                    : t('{row} widths, {gap} ms: {description}, {n, plural, one {# tap} other {# taps}}', {
                        row,
                        gap,
                        description: def.describe(h.value),
                        n: h.n,
                      });
              }}
            />
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <SectionTitle aside={t('Rows are the turn from the last move. Columns are the distance in target widths.')}>
                {t('Turn and distance')}
              </SectionTitle>
              <HeatGrid
                rowTitle={t('Turn')}
                colTitle={t('distance')}
                rows={TURN_BINS.map((b) => ({ key: b, label: t(TURN_LABELS[b]) }))}
                cols={DISTANCE_BINS.map((d) => ({ key: d, label: t(DISTANCE_LABELS[d]) }))}
                cell={(r, c) => cellFor(`td:${r}:${c}`)}
                scale={def.scale}
                max={def.max(tdValues)}
                describe={(r, c, h) => {
                  const turn = t(TURN_LABELS[r as keyof typeof TURN_LABELS]);
                  const distance = t(DISTANCE_LABELS[c as keyof typeof DISTANCE_LABELS]);
                  return h.n === 0
                    ? t('Turn {turn}, {distance} widths: no taps', { turn, distance })
                    : h.n < 20 || h.value === null
                      ? t('Turn {turn}, {distance} widths: only {n, plural, one {# tap} other {# taps}}', { turn, distance, n: h.n })
                      : t('Turn {turn}, {distance} widths: {description}, {n, plural, one {# tap} other {# taps}}', {
                          turn,
                          distance,
                          description: def.describe(h.value),
                          n: h.n,
                        });
                }}
              />
            </Card>
            <Card>
              <SectionTitle aside={t('Direction of movement into the target.')}>{t('Direction')}</SectionTitle>
              <Rose sectors={sectors} scale={def.scale} max={def.max(dirValues)} metricLabel={lowerLabel(t(def.label))} />
            </Card>
          </div>
          <p className="text-sm text-ink-2">
            {def.scale === 'diverging'
              ? t('Orange is short or early. Blue is past or late. Gray is close to zero.')
              : t('Brighter cells have higher values.')}
          </p>
        </div>
      )}
    </>
  );
}
