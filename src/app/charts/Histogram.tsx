import { t } from '../i18n';
import { linear, niceTicks, useChartColors } from './scale';

export interface HistSeries {
  label: string;
  color: string;
  /** Counts per bin. */
  counts: number[];
}

const BIN = 5;
export const HIST_MIN = -150;
export const HIST_MAX = 150;
export const HIST_BINS = (HIST_MAX - HIST_MIN) / BIN;

/** Bin index for a timing error, or -1 outside the range. */
export function histBin(errorMs: number): number {
  if (errorMs < HIST_MIN || errorMs >= HIST_MAX) return -1;
  return Math.floor((errorMs - HIST_MIN) / BIN);
}

export function histCounts(values: readonly number[]): number[] {
  const out = new Array<number>(HIST_BINS).fill(0);
  for (const v of values) {
    const b = histBin(v);
    if (b >= 0) out[b]!++;
  }
  return out;
}

/**
 * Timing errors in 5 ms bins from -150 to 150. The first series is drawn as bars and the rest as
 * lines. Every series is shown as a share of its own total so different sizes can be compared.
 */
export function Histogram({
  series,
  mean,
  sd,
  windows,
  height = 220,
  label,
  compact = false,
}: {
  series: HistSeries[];
  mean?: number;
  sd?: number;
  /** Half-widths of the Crisp, Solid and Rough windows. */
  windows?: { crisp: number; solid: number; rough: number };
  height?: number;
  label: string;
  compact?: boolean;
}) {
  const C = useChartColors();
  // A narrow card scales the drawing down, so the compact chart uses a narrow drawing to keep text readable.
  const W = compact ? 400 : 720;
  const font = compact ? 12 : 11;
  const M = { l: compact ? 8 : 40, r: 8, t: 8, b: 40 };
  const shares = series.map((s) => {
    const total = s.counts.reduce((a, b) => a + b, 0) || 1;
    return s.counts.map((c) => c / total);
  });
  const top = Math.max(0.001, ...shares.flat());
  const x = linear(HIST_MIN, HIST_MAX, M.l, W - M.r);
  const y = linear(0, top * 1.1, height - M.b, M.t);
  const bw = (x(HIST_MIN + BIN) - x(HIST_MIN)) * 0.92;
  const yTicks = niceTicks(0, top * 1.1, 4);
  const xTicks = [-150, -100, -50, 0, 50, 100, 150];

  const band = (half: number, fill: string) => (
    <rect key={half} x={x(-half)} width={x(half) - x(-half)} y={M.t} height={height - M.b - M.t} fill={fill} />
  );

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={label}>
      {windows && (
        <>
          {band(windows.rough, 'rgba(245,158,11,0.07)')}
          {band(windows.solid, 'rgba(45,212,191,0.08)')}
          {band(windows.crisp, 'rgba(167,139,250,0.12)')}
        </>
      )}
      {!compact &&
        yTicks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke={C.grid} />
            <text x={M.l - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize={font} fill={C.ink2}>
              {Math.round(v * 100)}%
            </text>
          </g>
        ))}
      <line x1={x(0)} x2={x(0)} y1={M.t} y2={height - M.b} stroke={C.axis} strokeDasharray="3 3" />
      {shares[0]?.map((s, i) => (
        <rect
          key={i}
          x={x(HIST_MIN + i * BIN) + (x(HIST_MIN + BIN) - x(HIST_MIN) - bw) / 2}
          width={bw}
          y={y(s)}
          height={Math.max(0, height - M.b - y(s))}
          rx={1.5}
          fill={series[0]!.color}
          fillOpacity={0.75}
        />
      ))}
      {shares.slice(1).map((s, k) => (
        <path
          key={series[k + 1]!.label}
          d={s.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(HIST_MIN + i * BIN + BIN / 2).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
          fill="none"
          stroke={series[k + 1]!.color}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      ))}
      {mean !== undefined && Math.abs(mean) <= 150 && (
        <g>
          <line x1={x(mean)} x2={x(mean)} y1={M.t} y2={height - M.b} stroke={C.ink} strokeWidth={1.5} />
          {sd !== undefined && (
            <>
              <line
                x1={x(Math.max(HIST_MIN, mean - sd))}
                x2={x(Math.min(HIST_MAX, mean + sd))}
                y1={M.t + 6}
                y2={M.t + 6}
                stroke={C.ink}
                strokeWidth={1.5}
              />
              <line
                x1={x(Math.max(HIST_MIN, mean - sd))}
                x2={x(Math.max(HIST_MIN, mean - sd))}
                y1={M.t + 2}
                y2={M.t + 10}
                stroke={C.ink}
                strokeWidth={1.5}
              />
              <line
                x1={x(Math.min(HIST_MAX, mean + sd))}
                x2={x(Math.min(HIST_MAX, mean + sd))}
                y1={M.t + 2}
                y2={M.t + 10}
                stroke={C.ink}
                strokeWidth={1.5}
              />
            </>
          )}
        </g>
      )}
      {xTicks.map((v) => (
        <text
          key={v}
          x={x(v)}
          y={height - 22}
          textAnchor={v === HIST_MIN ? 'start' : v === HIST_MAX ? 'end' : 'middle'}
          fontSize={font}
          fill={C.ink2}
        >
          {v > 0 ? `+${v}` : v}
        </text>
      ))}
      <text x={(M.l + W - M.r) / 2} y={height - 6} textAnchor="middle" fontSize={font} fill={C.ink2}>
        {t('Early (left) and late (right), in ms')}
      </text>
    </svg>
  );
}
