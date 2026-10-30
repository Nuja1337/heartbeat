// `distinct(a, b, unit)` says whether two values that copy shows side by side ("21 ms against 17 ms")
// will look different once they are rounded for display. Insights and weekly changes need it to pass,
// or they stay quiet, so no sentence ever shows two numbers that look the same.

/**
 * What the values are measured in before display:
 * - `share`: a share from 0 to 1, shown as percent. The gap must be 3 points.
 * - `width`: target radii, shown as percent of a target's width (x 50). The gap must be 3.
 * - `ms`: milliseconds. The gap must be 3.
 * - `bits`: bits per second, shown with one decimal. The gap must be 0.5.
 * - `minutes`: minutes, shown whole. The gap must be 2.
 */
export type ContrastUnit = 'share' | 'width' | 'ms' | 'bits' | 'minutes';

const UNITS: Record<ContrastUnit, { scale: number; min: number }> = {
  share: { scale: 100, min: 3 },
  width: { scale: 50, min: 3 },
  ms: { scale: 1, min: 3 },
  bits: { scale: 10, min: 5 },
  minutes: { scale: 1, min: 2 },
};

/** The value as the copy shows it, in display steps (tenths for bits, whole numbers otherwise). */
export const displayStep = (v: number, unit: ContrastUnit): number => Math.round(v * UNITS[unit].scale);

/** True when the displayed values differ by at least the unit's minimum gap. */
export function distinct(a: number, b: number, unit: ContrastUnit): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(displayStep(a, unit) - displayStep(b, unit)) >= UNITS[unit].min;
}
