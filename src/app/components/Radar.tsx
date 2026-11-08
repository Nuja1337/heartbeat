// The seven ratings as a radar. A skill without a score sits at the center, and a provisional one is a hollow dot.

import type { RadarAxis } from '../../analytics/index';
import { level as levelText } from '../format';
import { t } from '../i18n';

const W = 360;
const H = 272;
const CX = W / 2;
const CY = H / 2;
const R = 80;
const LABEL_R = R + 14;

const point = (i: number, count: number, r: number): [number, number] => {
  const a = -Math.PI / 2 + (i / count) * Math.PI * 2;
  return [CX + Math.cos(a) * r, CY + Math.sin(a) * r];
};

export function Radar({ axes, max, className = '' }: { axes: readonly RadarAxis[]; max: number; className?: string }) {
  const n = axes.length;
  const rings = [0.25, 0.5, 0.75, 1];
  const shape = axes.map((a, i) => point(i, n, (Math.min(a.rating, max) / max) * R));
  const path = shape.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ') + ' Z';
  const summary = axes
    .map((a) =>
      !a.hasData
        ? t('{skill} no rating', { skill: a.label })
        : a.provisional
          ? t('{skill} {rating} provisional', { skill: a.label, rating: levelText(a.rating) })
          : t('{skill} {rating}', { skill: a.label, rating: levelText(a.rating) }),
    )
    .join(', ');

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={`mx-auto w-full max-w-[380px] ${className}`}
      role="img"
      aria-label={t('Skill ratings out of {max}. {summary}.', { max, summary })}
    >
      {rings.map((k) => (
        <polygon
          key={k}
          points={axes.map((_, i) => point(i, n, R * k).join(',')).join(' ')}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={k === 1 ? 1.25 : 1}
        />
      ))}
      {axes.map((_, i) => {
        const [x, y] = point(i, n, R);
        return <line key={i} x1={CX} y1={CY} x2={x} y2={y} stroke="var(--color-line)" />;
      })}
      <path d={path} fill="var(--color-data)" fillOpacity={0.14} stroke="var(--color-data)" strokeWidth={2} strokeLinejoin="round" />
      {axes.map((a, i) => {
        const [x, y] = shape[i]!;
        return (
          <circle
            key={a.skill}
            cx={x}
            cy={y}
            r={3.5}
            fill={a.hasData ? (a.provisional ? 'var(--color-bg)' : 'var(--color-data)') : 'var(--color-ink-3)'}
            stroke="var(--color-data)"
            strokeWidth={a.provisional ? 1.5 : 0}
          >
            <title>
              {!a.hasData
                ? t('{skill}, no rating yet', { skill: a.label })
                : a.provisional
                  ? t('{skill}, {rating}, provisional', { skill: a.label, rating: levelText(a.rating) })
                  : t('{skill}, {rating}', { skill: a.label, rating: levelText(a.rating) })}
            </title>
          </circle>
        );
      })}
      {axes.map((a, i) => {
        const [x, y] = point(i, n, LABEL_R);
        const anchor = Math.abs(x - CX) < 6 ? 'middle' : x > CX ? 'start' : 'end';
        return (
          <text
            key={a.skill}
            x={x}
            y={y}
            dy="0.32em"
            textAnchor={anchor}
            fontSize={11}
            fill={a.hasData ? 'var(--color-ink-2)' : 'var(--color-ink-3)'}
          >
            {a.label}
            {a.hasData && (
              <tspan fill="var(--color-ink)" dx={4}>
                {levelText(a.rating)}
              </tspan>
            )}
          </text>
        );
      })}
    </svg>
  );
}
