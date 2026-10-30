import { useState } from 'react';
import type { RatingPoint } from '../../analytics/index';
import { dateOf, level } from '../format';
import { CHART, extent, linear, niceTicks } from './scale';

const W = 720;
const H = 260;
const M = { l: 44, r: 16, t: 12, b: 28 };

/** One skill's rating at the end of each day. Days before its first score are left out. Hover, or use the arrow keys. */
export function RatingHistory({ points, label }: { points: readonly RatingPoint[]; label: string }) {
  const [active, setActive] = useState<number | null>(null);
  const rated = points.filter((p): p is RatingPoint & { rating: number } => p.rating !== null);
  if (rated.length === 0) return <p className="text-ink-2">No rating for this skill in the last 90 days.</p>;

  const t0 = points[0]!.t;
  const t1 = points[points.length - 1]!.t;
  const [lo, hi] = extent(rated.map((p) => p.rating), 0.15);
  const min = Math.max(0, lo);
  const x = linear(t0, t1 === t0 ? t0 + 86_400_000 : t1, M.l, W - M.r);
  const y = linear(min, hi, H - M.b, M.t);
  const path = rated.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.rating).toFixed(1)}`).join(' ');
  const a = active === null ? null : rated[active];
  const pick = (clientX: number, box: DOMRect) => {
    const px = ((clientX - box.left) / box.width) * W;
    let best = 0;
    rated.forEach((p, i) => {
      if (Math.abs(x(p.t) - px) < Math.abs(x(rated[best]!.t) - px)) best = i;
    });
    setActive(best);
  };

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`${label} rating over the last 90 days, from ${level(rated[0]!.rating)} to ${level(rated[rated.length - 1]!.rating)}. Use the arrow keys to read single days.`}
        tabIndex={0}
        onMouseMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          setActive((cur) => Math.min(rated.length - 1, Math.max(0, (cur ?? rated.length - 1) + (e.key === 'ArrowRight' ? 1 : -1))));
        }}
      >
        {niceTicks(min, hi, 5).map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke={CHART.grid} />
            <text x={M.l - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize={11} fill={CHART.ink2}>
              {level(v)}
            </text>
          </g>
        ))}
        {[points[0]!, points[Math.floor(points.length / 2)]!, points[points.length - 1]!].map((p, i) => (
          <text key={p.day} x={x(p.t)} y={H - 8} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} fontSize={11} fill={CHART.ink2}>
            {dateOf(p.t).replace(/ \d{4}$/, '')}
          </text>
        ))}
        {a && <line x1={x(a.t)} x2={x(a.t)} y1={M.t} y2={H - M.b} stroke={CHART.axis} />}
        <path d={path} pathLength={1} className="hb-draw" fill="none" stroke={CHART.accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {a && <circle cx={x(a.t)} cy={y(a.rating)} r={4.5} fill={CHART.accent} stroke={CHART.empty} strokeWidth={1.5} />}
      </svg>
      <figcaption className="min-h-6 text-sm text-ink-2" aria-live="polite">
        {a ? (
          <>
            <span className="text-ink">{dateOf(a.t)}</span>: {level(a.rating)}, tier {a.tier}
            {a.provisional ? ', provisional' : ''}
          </>
        ) : (
          'The rating at the end of each day.'
        )}
      </figcaption>
    </figure>
  );
}
