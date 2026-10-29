// Scales, ticks and colors shared by the charts.

export function linear(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** Round tick values covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / Math.max(1, count - 1);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

export function extent(values: readonly number[], pad = 0.08): [number, number] {
  if (values.length === 0) return [0, 1];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const p = (hi - lo) * pad;
  return [lo - p, hi + p];
}

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hex(a);
  const [r2, g2, b2] = hex(b);
  const k = Math.min(1, Math.max(0, t));
  const to = (x: number, y: number) => Math.round(x + (y - x) * k).toString(16).padStart(2, '0');
  return `#${to(r1, r2)}${to(g1, g2)}${to(b1, b2)}`;
}

export const CHART = {
  ink: '#e5e7eb',
  ink2: '#9ca3af',
  grid: '#1f2937',
  axis: '#374151',
  accent: '#7dd3fc',
  /** Neutral midpoint of the diverging scale. */
  neutral: '#374151',
  /** Negative pole (short, left, early) and positive pole (past, right, late). */
  negative: '#fb923c',
  positive: '#60a5fa',
  low: '#162033',
} as const;

/** One hue, light on dark: 0 is near the surface and 1 is the accent. */
export const sequentialColor = (t: number): string => mix(CHART.low, CHART.accent, t);

/** Two hues around a gray midpoint. t runs from -1 to 1. */
export const divergingColor = (t: number): string =>
  t < 0 ? mix(CHART.neutral, CHART.negative, -t) : mix(CHART.neutral, CHART.positive, t);

export const fixed = (v: number, digits: number): string => (Math.abs(v) < 0.5 * 10 ** -digits ? 0 : v).toFixed(digits);
