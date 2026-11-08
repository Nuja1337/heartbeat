import { useState } from 'react';
import type { DayPoint } from '../../analytics/trends';
import { dateOf, shortDate } from '../format';
import { t, tx } from '../i18n';
import { extent, fixed, linear, niceTicks, useChartColors } from './scale';

const W = 720;
const H = 280;
const M = { l: 52, r: 16, t: 12, b: 28 };

/** Daily values as dots and the smoothed line through them. Hover or focus a day for its numbers. */
export function LineChart({
  points,
  decimals,
  format,
  label,
  zeroLine = false,
}: {
  points: DayPoint[];
  decimals: number;
  format(v: number): string;
  label: string;
  zeroLine?: boolean;
}) {
  const C = useChartColors();
  const [active, setActive] = useState<number | null>(null);
  if (points.length === 0) return <p className="text-ink-2">{t('No data in this range.')}</p>;

  const t0 = points[0]!.t;
  const t1 = points[points.length - 1]!.t;
  const [lo, hi] = extent([...points.map((p) => p.value), ...points.map((p) => p.smooth), ...(zeroLine ? [0] : [])]);
  const x = linear(t0, t1 === t0 ? t0 + 86_400_000 : t1, M.l, W - M.r);
  const y = linear(lo, hi, H - M.b, M.t);
  const yTicks = niceTicks(lo, hi, 5);
  const xTicks = points.length <= 1 ? [points[0]!] : [points[0]!, points[Math.floor(points.length / 2)]!, points[points.length - 1]!];
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.smooth).toFixed(1)}`).join(' ');
  const a = active === null ? null : points[active];

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={label}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke={C.grid} />
            <text x={M.l - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize={11} fill={C.ink2}>
              {fixed(v, decimals)}
            </text>
          </g>
        ))}
        {zeroLine && lo < 0 && hi > 0 && <line x1={M.l} x2={W - M.r} y1={y(0)} y2={y(0)} stroke={C.axis} strokeDasharray="4 3" />}
        {xTicks.map((p) => (
          <text key={p.day} x={x(p.t)} y={H - 8} textAnchor="middle" fontSize={11} fill={C.ink2}>
            {shortDate(p.t)}
          </text>
        ))}
        {a && <line x1={x(a.t)} x2={x(a.t)} y1={M.t} y2={H - M.b} stroke={C.axis} />}
        {points.length > 1 && (
          <path
            d={line}
            pathLength={1}
            className="hb-draw"
            fill="none"
            stroke={C.accent}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {points.map((p, i) => (
          <g key={p.day}>
            <circle
              cx={x(p.t)}
              cy={y(p.value)}
              r={active === i ? 5 : 3.5}
              fill={C.accent}
              fillOpacity={0.55}
              stroke={C.empty}
              strokeWidth={1.5}
            />
            <circle
              cx={x(p.t)}
              cy={y(p.value)}
              r={14}
              fill="transparent"
              tabIndex={0}
              aria-label={t('{date}: {value}', { date: dateOf(p.t), value: format(p.value) })}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            />
          </g>
        ))}
      </svg>
      <figcaption className="min-h-6 text-sm text-ink-2" aria-live="polite">
        {a ? (
          <>
            {tx('{date}: {value}, trend line {trend}', {
              date: <span className="text-ink">{dateOf(a.t)}</span>,
              value: format(a.value),
              trend: format(a.smooth),
            })}
          </>
        ) : (
          t('Dots are single days. The line is the trend.')
        )}
      </figcaption>
    </figure>
  );
}
