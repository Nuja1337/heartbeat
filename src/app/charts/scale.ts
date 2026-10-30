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

/** Chart colors, matching the tokens in index.css. SVG attributes can't read Tailwind classes, and mix() needs hex. */
export const CHART = {
  ink: '#eef1f6',
  ink2: '#a3adbd',
  grid: '#1e2735',
  axis: '#2b3648',
  /** Data lines and marks (--color-data). */
  accent: '#5ee7f2',
  /** Neutral midpoint of the diverging scale (--color-ink-3). */
  neutral: '#6b7689',
  /** Negative pole (short, left, early) and positive pole (past, right, late). */
  negative: '#ffb340',
  positive: '#5ee7f2',
  /** The low end of rate scales (--color-surface-2) and the high end (--color-danger). */
  low: '#151c28',
  high: '#ff4f6a',
  /** Surface for empty cells and the plot background. */
  empty: '#0f141d',
  bg: '#07090e',
} as const;

/** Judgment colors follow the chosen palette through the variables the app sets on :root. */
export const JCOLOR = {
  crisp: 'var(--fw-crisp)',
  solid: 'var(--fw-solid)',
  rough: 'var(--fw-rough)',
  miss: 'var(--fw-miss)',
} as const;

/** Rates run from the surface to danger: 0 is near the surface and 1 is danger. */
export const sequentialColor = (t: number): string => mix(CHART.low, CHART.high, t);

/** WCAG contrast ratio between two hex colors. */
export function contrast(a: string, b: string): number {
  const lum = (c: string) => {
    const [r, g, bl] = hex(c).map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Two hues around a gray midpoint. t runs from -1 to 1. */
export const divergingColor = (t: number): string =>
  t < 0 ? mix(CHART.neutral, CHART.negative, -t) : mix(CHART.neutral, CHART.positive, t);

export const fixed = (v: number, digits: number): string => (Math.abs(v) < 0.5 * 10 ** -digits ? 0 : v).toFixed(digits);
