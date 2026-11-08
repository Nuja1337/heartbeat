// Demand over the length of a map, on the level scale, with a band behind it for each section role.
// Hand-written SVG like the other charts. The data comes from demandTimeline.

import type { DemandTimeline } from '../../analytics/index';
import type { SectionRole } from '../../shared/types';
import { linear, niceTicks, useChartColors } from '../charts/scale';
import { duration, level } from '../format';
import { msg, t } from '../i18n';

type DemandBin = DemandTimeline['bins'][number];

const W = 720;
const H = 200;
const M = { l: 34, r: 10, t: 10, b: 24 };

const ROLE_COLOR: Record<SectionRole, string> = {
  intro: 'var(--color-ink-3)',
  build: 'var(--color-data)',
  peak: 'var(--color-accent)',
  rest: 'var(--color-ink-2)',
  outro: 'var(--color-ink-3)',
};
const ROLE_LABEL: Record<SectionRole, string> = {
  intro: msg('Intro'),
  build: msg('Build'),
  peak: msg('Peak'),
  rest: msg('Rest'),
  outro: msg('Outro'),
};
const ROLE_ORDER: SectionRole[] = ['intro', 'build', 'peak', 'rest', 'outro'];

/** Runs of consecutive bins that have a value. A bin with no objects leaves a gap. */
export function demandRuns(bins: readonly DemandBin[]): DemandBin[][] {
  const runs: DemandBin[][] = [];
  let cur: DemandBin[] = [];
  for (const b of bins) {
    if (b.overall === null) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else cur.push(b);
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/** The sentence a screen reader gets for the graph. */
export function graphSummary(timeline: DemandTimeline): string {
  const values = timeline.bins.map((b) => b.overall).filter((v): v is number => v !== null);
  if (values.length === 0) return t('The map has no demand to show.');
  const peak = Math.max(...values);
  const low = Math.min(...values);
  const last = timeline.bins[timeline.bins.length - 1]?.end ?? 0;
  return t('Difficulty over {length}, from level {low} at the lowest to level {high} at the highest.', {
    length: duration(last),
    low: level(low),
    high: level(peak),
  });
}

export function DifficultyGraph({ timeline }: { timeline: DemandTimeline }) {
  const C = useChartColors();
  const { bins, sections } = timeline;
  const end = bins.length ? bins[bins.length - 1]!.end : 1;
  const values = bins.map((b) => b.overall).filter((v): v is number => v !== null);
  const top = Math.max(4, Math.ceil(Math.max(0, ...values) + 0.5));
  const x = linear(0, end, M.l, W - M.r);
  const y = linear(0, top, H - M.b, M.t);
  const runs = demandRuns(bins);
  const roles = ROLE_ORDER.filter((r) => sections.some((s) => s.role === r));
  const ticks = niceTicks(0, top, Math.min(5, top + 1)).filter((v) => Number.isInteger(v));
  const timeTicks = niceTicks(0, end / 1000, 5).map((s) => s * 1000);

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={graphSummary(timeline)}>
        {sections
          .filter((s) => s.role && s.end > s.start)
          .map((s, i) => (
            <rect
              key={i}
              x={x(s.start)}
              y={M.t}
              width={Math.max(1, x(s.end) - x(s.start))}
              height={H - M.t - M.b}
              fill={ROLE_COLOR[s.role!]}
              fillOpacity={s.role === 'peak' ? 0.16 : 0.1}
            >
              <title>
                {t('{role}, {start} to {end}', { role: t(ROLE_LABEL[s.role!]), start: duration(s.start), end: duration(s.end) })}
              </title>
            </rect>
          ))}
        {sections
          .filter((s) => s.role && s.end > s.start)
          .map((s, i) => (
            <line key={`b${i}`} x1={x(s.start)} x2={x(s.end)} y1={M.t} y2={M.t} stroke={ROLE_COLOR[s.role!]} strokeWidth={2} />
          ))}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? C.axis : C.grid} />
            <text x={M.l - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize={11} fill={C.ink2}>
              {v}
            </text>
          </g>
        ))}
        {timeTicks.map((tick) => (
          <text
            key={tick}
            x={x(tick)}
            y={H - 6}
            fontSize={11}
            fill={C.ink2}
            textAnchor={tick === 0 ? 'start' : tick >= end - 1 ? 'end' : 'middle'}
          >
            {duration(tick)}
          </text>
        ))}
        {runs.map((run, i) => {
          const pts = run.map((b) => [x((b.start + b.end) / 2), y(b.overall!)] as const);
          const line = pts.map(([px, py], k) => `${k === 0 ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
          const area = `${line} L${pts[pts.length - 1]![0].toFixed(1)} ${y(0)} L${pts[0]![0].toFixed(1)} ${y(0)} Z`;
          return (
            <g key={i}>
              <path d={area} fill="var(--color-accent)" fillOpacity={0.14} />
              <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {pts.length === 1 && <circle cx={pts[0]![0]} cy={pts[0]![1]} r={2.5} fill="var(--color-accent)" />}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-3 rounded-full bg-accent" />
          {t('Demand, on the level scale')}
        </span>
        {roles.map((r) => (
          <span key={r} className="flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-sm" style={{ background: ROLE_COLOR[r] }} />
            {t(ROLE_LABEL[r])}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
