import type { HitRecord } from '../../shared/types';
import { CHART, JCOLOR } from './scale';

/**
 * Where clicks landed relative to the target, in the frame of the movement into it.
 * Right of center is past the target, left is short. Below the line is to the right of the movement.
 */
export function AimScatter({ records, size = 300 }: { records: readonly HitRecord[]; size?: number }) {
  const pts = records.filter((r) => r.aimAlong !== null && r.aimLateral !== null && !r.afterPause);
  const R = 2.2; // radii shown either side of the center
  const c = size / 2;
  const k = c / R;
  const mean = (f: (r: HitRecord) => number) => (pts.length ? pts.reduce((a, r) => a + f(r), 0) / pts.length : 0);
  const ma = mean((r) => r.aimAlong! / r.radius);
  const ml = mean((r) => r.aimLateral! / r.radius);

  if (pts.length === 0) return <p className="text-ink-2">No clicks with a direction to plot.</p>;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-sm" role="img" aria-label={`Click positions around the target. Average ${Math.round(ma * 50)} percent along and ${Math.round(ml * 50)} percent across.`}>
      <line x1={0} x2={size} y1={c} y2={c} stroke={CHART.grid} />
      <line x1={c} x2={c} y1={0} y2={size} stroke={CHART.grid} />
      <circle cx={c} cy={c} r={k} fill="rgba(94,231,242,0.06)" stroke={CHART.accent} strokeWidth={1.5} />
      {pts.map((r, i) => {
        const px = Math.max(3, Math.min(size - 3, c + (r.aimAlong! / r.radius) * k));
        const py = Math.max(3, Math.min(size - 3, c + (r.aimLateral! / r.radius) * k));
        return <circle key={i} cx={px} cy={py} r={2.4} fill={JCOLOR[r.judgment]} fillOpacity={0.75} />;
      })}
      <g>
        <line x1={c + ma * k - 7} x2={c + ma * k + 7} y1={c + ml * k} y2={c + ml * k} stroke={CHART.ink} strokeWidth={2} />
        <line x1={c + ma * k} x2={c + ma * k} y1={c + ml * k - 7} y2={c + ml * k + 7} stroke={CHART.ink} strokeWidth={2} />
      </g>
      <text x={6} y={c - 6} fontSize={11} fill={CHART.ink2}>Short</text>
      <text x={size - 6} y={c - 6} fontSize={11} fill={CHART.ink2} textAnchor="end">Past</text>
      <text x={c + 6} y={12} fontSize={11} fill={CHART.ink2}>Left</text>
      <text x={c + 6} y={size - 6} fontSize={11} fill={CHART.ink2}>Right</text>
    </svg>
  );
}
