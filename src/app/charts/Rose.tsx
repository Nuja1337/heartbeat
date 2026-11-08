import { useState } from 'react';
import { OCTANT_PHRASE } from '../../analytics/insightCopy';
import { t } from '../i18n';
import { divergingColor, sequentialColor, useChartColors } from './scale';

export interface RoseSector {
  octant: number;
  value: number | null;
  n: number;
  text: string;
}

/**
 * Eight sectors for the direction of movement, 0 on the right and 2 at the bottom as on screen.
 * The wedge length shows how many taps it holds and the color shows the metric.
 */
export function Rose({
  sectors,
  scale,
  max,
  minN = 20,
  size = 280,
  metricLabel,
}: {
  sectors: RoseSector[];
  scale: 'sequential' | 'diverging';
  max: number;
  minN?: number;
  size?: number;
  metricLabel: string;
}) {
  const C = useChartColors();
  const [hover, setHover] = useState<number | null>(null);
  const c = size / 2;
  const rMax = c - 24;
  const peak = Math.max(1, ...sectors.map((s) => s.n));
  const half = Math.PI / 8 - 0.02;

  const wedge = (o: number, r: number) => {
    const mid = (o * Math.PI) / 4;
    const a0 = mid - half;
    const a1 = mid + half;
    const p = (a: number) => `${(c + Math.cos(a) * r).toFixed(1)},${(c + Math.sin(a) * r).toFixed(1)}`;
    return `M${c},${c} L${p(a0)} A${r},${r} 0 0 1 ${p(a1)} Z`;
  };
  const describe = (s: RoseSector) => {
    const direction = t(OCTANT_PHRASE[s.octant]!);
    if (s.n === 0) return t('Moving {direction}: no taps', { direction });
    return s.value === null || s.n < minN
      ? t('Moving {direction}: too few taps for a value, {n, plural, one {# tap} other {# taps}}', { direction, n: s.n })
      : t('Moving {direction}: {value}, {n, plural, one {# tap} other {# taps}}', { direction, value: s.text, n: s.n });
  };

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="w-full max-w-xs"
        role="img"
        aria-label={t('{metric} by direction of movement', { metric: metricLabel })}
      >
        <circle cx={c} cy={c} r={rMax} fill="none" stroke={C.grid} />
        <circle cx={c} cy={c} r={rMax / 2} fill="none" stroke={C.grid} strokeDasharray="2 3" />
        {sectors.map((s) => {
          const r = Math.max(10, rMax * Math.sqrt(s.n / peak));
          const enough = s.value !== null && s.n >= minN;
          const fill = !enough
            ? C.bg
            : scale === 'sequential'
              ? sequentialColor(Math.min(1, s.value! / max), C)
              : divergingColor(Math.max(-1, Math.min(1, s.value! / max)), C);
          return (
            <path
              key={s.octant}
              d={wedge(s.octant, r)}
              fill={fill}
              stroke={hover === s.octant ? C.ink : C.empty}
              strokeWidth={hover === s.octant ? 2 : 1.5}
              tabIndex={0}
              aria-label={describe(s)}
              onMouseEnter={() => setHover(s.octant)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(s.octant)}
              onBlur={() => setHover(null)}
            />
          );
        })}
        <text x={size - 4} y={c + 4} fontSize={11} fill={C.ink2} textAnchor="end">
          {t('Right')}
        </text>
        <text x={4} y={c + 4} fontSize={11} fill={C.ink2}>
          {t('Left')}
        </text>
        <text x={c} y={12} fontSize={11} fill={C.ink2} textAnchor="middle">
          {t('Up')}
        </text>
        <text x={c} y={size - 4} fontSize={11} fill={C.ink2} textAnchor="middle">
          {t('Down')}
        </text>
      </svg>
      <figcaption className="min-h-6 text-sm text-ink-2" aria-live="polite">
        {hover !== null ? describe(sectors[hover]!) : t('Longer wedges hold more taps.')}
      </figcaption>
    </figure>
  );
}
