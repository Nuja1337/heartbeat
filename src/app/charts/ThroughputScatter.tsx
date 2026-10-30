import { useState } from 'react';
import type { ThroughputPoint } from '../../analytics/index';
import { PEER_FOCUS, PointNav } from './PointNav';
import { CHART, extent, linear, niceTicks } from './scale';

const W = 720;
const H = 360;
const M = { l: 52, r: 16, t: 14, b: 40 };

/**
 * Each dot is a group of jumps of similar distance and time. Across is how hard the jump was by its distance and
 * the target size, up is how hard it was by where your clicks landed. The line is where the two are equal.
 */
export function ThroughputScatter({ points }: { points: readonly ThroughputPoint[] }) {
  const [active, setActive] = useState<number | null>(null);
  if (points.length === 0) return <p className="text-ink-2">Not enough jumps yet. A dot needs 8 jumps of similar distance and time.</p>;

  const [lo, hi] = extent([...points.map((p) => p.nominalId), ...points.map((p) => p.ide)], 0.1);
  const min = Math.max(0, lo);
  const x = linear(min, hi, M.l, W - M.r);
  const y = linear(min, hi, H - M.b, M.t);
  const ticks = niceTicks(min, hi, 6);
  const maxN = Math.max(...points.map((p) => p.n));
  const radius = (n: number) => 4 + 9 * Math.sqrt(n / maxN);
  const a = active === null ? null : points[active];

  return (
    <figure className="m-0">
      <PointNav
        label={`Groups of jumps, ${points.length} in all. Use the arrow keys to move between them.`}
        items={points.map((p) => ({ label: `${p.n} jumps, ${p.nominalId} bits by distance, ${p.ide} bits by clicks, ${p.tp} bits per second` }))}
        active={active}
        onActive={setActive}
      />
      <div className={PEER_FOCUS}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Difficulty of the jump by distance and target size against difficulty by where you clicked, one dot per group of jumps">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke={CHART.grid} />
              <line x1={x(v)} x2={x(v)} y1={M.t} y2={H - M.b} stroke={CHART.grid} />
              <text x={M.l - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize={11} fill={CHART.ink2}>
                {v}
              </text>
              <text x={x(v)} y={H - M.b + 16} textAnchor="middle" fontSize={11} fill={CHART.ink2}>
                {v}
              </text>
            </g>
          ))}
          <text x={(M.l + W - M.r) / 2} y={H - 6} textAnchor="middle" fontSize={11} fill={CHART.ink2}>
            Difficulty by distance and target size, in bits
          </text>
          <text transform={`translate(12 ${(M.t + H - M.b) / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} fill={CHART.ink2}>
            Difficulty by your clicks, in bits
          </text>
          <line x1={x(min)} y1={y(min)} x2={x(hi)} y2={y(hi)} stroke={CHART.neutral} strokeDasharray="5 4" />
          {points.map((p, i) => (
            <circle
              key={p.key}
              cx={x(p.nominalId)}
              cy={y(p.ide)}
              r={radius(p.n)}
              fill={CHART.accent}
              fillOpacity={active === i ? 0.7 : 0.4}
              stroke={CHART.accent}
              strokeWidth={active === i ? 2 : 1}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
            />
          ))}
        </svg>
      </div>
      <figcaption className="min-h-6 text-sm text-ink-2">
        {a ? (
          <>
            <span className="text-ink">{a.n} jumps</span>: {a.nominalId} bits by distance, {a.ide} bits by your clicks, {a.tp} bits per second
          </>
        ) : (
          'Dots below the dashed line are jumps where your clicks landed more spread out than the target is wide. Bigger dots hold more jumps.'
        )}
      </figcaption>
    </figure>
  );
}
