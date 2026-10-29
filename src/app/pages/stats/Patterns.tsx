import { useMemo, useState } from 'react';
import { DISTANCE_BINS, DISTANCE_LABELS, GAP_COUNT, GAP_LABELS, TURN_BINS, TURN_LABELS, mergeBuckets, missRate } from '../../../analytics/buckets';
import type { BucketStat } from '../../../data/schema';
import { HeatGrid } from '../../charts/HeatGrid';
import type { HeatCell } from '../../charts/HeatGrid';
import { Rose } from '../../charts/Rose';
import type { RoseSector } from '../../charts/Rose';
import { Card, Field, PageHeader, SectionTitle, Segmented } from '../../components/ui';
import { EMPTY_STATS, INTRO } from '../../copy';
import { useAnalysis } from '../../state/analysis';

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
    label: 'Miss rate',
    scale: 'sequential',
    max: (vs) => Math.max(0.1, ...vs),
    value: (b) => missRate(b),
    text: (v) => `${Math.round(v * 100)}%`,
    describe: (v) => `${Math.round(v * 100)}% missed`,
  },
  along: {
    label: 'Overshoot or undershoot',
    scale: 'diverging',
    max: (vs) => Math.max(0.3, ...vs.map(Math.abs)),
    value: (b) => (b.along.n > 0 ? b.along.mean : null),
    text: (v) => `${sign(v)}${Math.round(v * 50)}%`,
    describe: (v) => `${Math.abs(Math.round(v * 50))}% ${v < 0 ? 'short of' : 'past'} the center`,
  },
  spread: {
    label: 'Sideways spread',
    scale: 'sequential',
    max: (vs) => Math.max(0.2, ...vs),
    value: (b) => (b.lat.n > 1 ? b.lat.sd : null),
    text: (v) => `${Math.round(v * 50)}%`,
    describe: (v) => `clicks scatter ${Math.round(v * 50)}% of a width across the line`,
  },
  timing: {
    label: 'Timing offset',
    scale: 'diverging',
    max: (vs) => Math.max(20, ...vs.map(Math.abs)),
    value: (b) => (b.t.n > 0 ? b.t.mean : null),
    text: (v) => `${sign(v)}${Math.round(v)}`,
    describe: (v) => `${Math.abs(Math.round(v))} ms ${v < 0 ? 'early' : 'late'}`,
  },
};

const RANGES = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'all', label: 'All plays' },
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

  const dgValues = DISTANCE_BINS.flatMap((d) => Array.from({ length: GAP_COUNT }, (_, g) => cellFor(`dg:${d}:g${g}`))).filter((c) => c.n >= 20 && c.value !== null).map((c) => c.value!);
  const tdValues = TURN_BINS.flatMap((t) => DISTANCE_BINS.map((d) => cellFor(`td:${t}:${d}`))).filter((c) => c.n >= 20 && c.value !== null).map((c) => c.value!);
  const sectors: RoseSector[] = Array.from({ length: 8 }, (_, o) => {
    const c = cellFor(`dir:${o}`);
    return { octant: o, value: c.value, n: c.n, text: c.value === null ? '' : def.describe(c.value) };
  });
  const dirValues = sectors.filter((s) => s.n >= 20 && s.value !== null).map((s) => s.value!);

  if (!data) return <p className="text-ink-2">Loading.</p>;
  const empty = Object.keys(merged).length === 0;

  return (
    <>
      <PageHeader title="Patterns" intro={INTRO.patterns} />
      {empty ? (
        <Card>
          <p className="text-ink-2">{EMPTY_STATS}</p>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-end gap-6">
            <Field label="Show">
              <Segmented legend="Metric" value={metric} onChange={setMetric} options={(Object.keys(METRICS) as Metric[]).map((m) => ({ value: m, label: METRICS[m].label }))} />
            </Field>
            <Field label="Plays">
              <Segmented legend="Plays" value={range} onChange={setRange} options={RANGES} />
            </Field>
          </div>

          <Card>
            <SectionTitle aside="Rows are the distance between targets in target widths. Columns are the time between them in ms.">Distance and gap</SectionTitle>
            <HeatGrid
              rowTitle="Distance"
              colTitle="gap"
              rows={DISTANCE_BINS.map((d) => ({ key: d, label: DISTANCE_LABELS[d] }))}
              cols={GAP_LABELS.map((label, g) => ({ key: `g${g}`, label }))}
              cell={(r, c) => cellFor(`dg:${r}:${c}`)}
              scale={def.scale}
              max={def.max(dgValues)}
              describe={(r, c, h) => {
                const gap = GAP_LABELS[Number(c.slice(1))] ?? '';
                const rowLabel = DISTANCE_LABELS[r as keyof typeof DISTANCE_LABELS];
                return h.n === 0 ? `${rowLabel} widths, ${gap} ms: no taps` : h.n < 20 || h.value === null ? `${rowLabel} widths, ${gap} ms: only ${h.n} taps` : `${rowLabel} widths, ${gap} ms: ${def.describe(h.value)}, ${h.n} taps`;
              }}
            />
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <SectionTitle aside="Rows are the turn from the last move. Columns are the distance in target widths.">Turn and distance</SectionTitle>
              <HeatGrid
                rowTitle="Turn"
                colTitle="distance"
                rows={TURN_BINS.map((t) => ({ key: t, label: TURN_LABELS[t] }))}
                cols={DISTANCE_BINS.map((d) => ({ key: d, label: DISTANCE_LABELS[d] }))}
                cell={(r, c) => cellFor(`td:${r}:${c}`)}
                scale={def.scale}
                max={def.max(tdValues)}
                describe={(r, c, h) => {
                  const rowLabel = TURN_LABELS[r as keyof typeof TURN_LABELS];
                  const colLabel = DISTANCE_LABELS[c as keyof typeof DISTANCE_LABELS];
                  return h.n === 0 ? `Turn ${rowLabel}, ${colLabel} widths: no taps` : h.n < 20 || h.value === null ? `Turn ${rowLabel}, ${colLabel} widths: only ${h.n} taps` : `Turn ${rowLabel}, ${colLabel} widths: ${def.describe(h.value)}, ${h.n} taps`;
                }}
              />
            </Card>
            <Card>
              <SectionTitle aside="Direction of movement into the target.">Direction</SectionTitle>
              <Rose sectors={sectors} scale={def.scale} max={def.max(dirValues)} metricLabel={def.label.toLowerCase()} />
            </Card>
          </div>
          <p className="text-sm text-ink-2">
            {def.scale === 'diverging'
              ? 'Orange is short or early. Blue is past or late. Gray is close to zero.'
              : 'Brighter cells have higher values.'}
          </p>
        </div>
      )}
    </>
  );
}
