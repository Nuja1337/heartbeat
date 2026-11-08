import { useState } from 'react';
import type { FatiguePoint } from '../../analytics/index';
import { duration, pct0 } from '../format';
import { t, tx } from '../i18n';
import { linear, niceTicks, useChartColors } from './scale';

/** Accuracy over the last 20 objects against time. `compact` is a small sparkline with no axes. */
export function Fatigue({ points, compact = false }: { points: readonly FatiguePoint[]; compact?: boolean }) {
  const C = useChartColors();
  const [active, setActive] = useState<number | null>(null);
  if (points.length < 2) return <p className="text-sm text-ink-2">{t('The play was too short to show how your accuracy changed.')}</p>;

  const W = compact ? 240 : 720;
  const H = compact ? 64 : 240;
  const M = compact ? { l: 4, r: 4, t: 6, b: 6 } : { l: 44, r: 12, t: 12, b: 26 };
  const t1 = points[points.length - 1]!.t;
  const values = points.map((p) => p.accuracy);
  // At least 30 points of range, and never past 0 to 100%.
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 0.3) {
    const mid = (hi + lo) / 2;
    lo = mid - 0.15;
    hi = mid + 0.15;
  }
  lo = Math.max(0, lo - 0.03);
  hi = Math.min(1, hi + 0.03);
  const x = linear(points[0]!.t, t1 || 1, M.l, W - M.r);
  const y = linear(lo, hi, H - M.b, M.t);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.accuracy).toFixed(1)}`).join(' ');
  const area = `${line} L${x(t1).toFixed(1)},${H - M.b} L${x(points[0]!.t).toFixed(1)},${H - M.b} Z`;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const a = active === null ? null : points[active];

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={t('Accuracy over the play, from {start} near the start to {end} at the end', {
          start: pct0(first.accuracy),
          end: pct0(last.accuracy),
        })}
        onMouseLeave={() => setActive(null)}
        onMouseMove={
          compact
            ? undefined
            : (e) => {
                const box = e.currentTarget.getBoundingClientRect();
                const px = ((e.clientX - box.left) / box.width) * W;
                let best = 0;
                points.forEach((p, i) => {
                  if (Math.abs(x(p.t) - px) < Math.abs(x(points[best]!.t) - px)) best = i;
                });
                setActive(best);
              }
        }
      >
        {!compact &&
          niceTicks(lo, hi, 4).map((v) => (
            <g key={v}>
              <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke={C.grid} />
              <text x={M.l - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize={11} fill={C.ink2}>
                {Math.round(v * 100)}%
              </text>
            </g>
          ))}
        {!compact && (
          <>
            <text x={M.l} y={H - 8} fontSize={11} fill={C.ink2}>
              0:00
            </text>
            <text x={W - M.r} y={H - 8} fontSize={11} fill={C.ink2} textAnchor="end">
              {duration(t1)}
            </text>
          </>
        )}
        <path d={area} fill={C.accent} fillOpacity={0.1} />
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
        {a && (
          <g>
            <line x1={x(a.t)} x2={x(a.t)} y1={M.t} y2={H - M.b} stroke={C.axis} />
            <circle cx={x(a.t)} cy={y(a.accuracy)} r={4.5} fill={C.accent} stroke={C.empty} strokeWidth={1.5} />
          </g>
        )}
      </svg>
      <figcaption className="min-h-6 text-sm text-ink-2" aria-live="polite">
        {a ? (
          <>
            {tx('{time}: {accuracy} over the 20 objects before', {
              time: <span className="text-ink">{duration(a.t)}</span>,
              accuracy: pct0(a.accuracy),
            })}
          </>
        ) : compact ? (
          t('{start} near the start, {end} at the end.', { start: pct0(first.accuracy), end: pct0(last.accuracy) })
        ) : (
          t('Each point is your accuracy over the last 20 objects.')
        )}
      </figcaption>
    </figure>
  );
}
