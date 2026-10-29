// Colours, sizes and timings for drawing.

import { JUDGMENTS } from '../../shared/catalog';
import type { Judgment } from '../../shared/types';

export const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const COLORS = {
  bg: '#0b0f14',
  field: '#0e141b',
  fieldEdge: '#1f2937',
  grid: '#151d27',
  body: '#1e293b',
  ink: '#e5e7eb',
  ink2: '#9ca3af',
  dim: '#4b5563',
  miss: JUDGMENTS.miss.color,
  danger: '#f43f5e',
  spot: '#05070a',
  health: '#2dd4bf',
  healthLow: '#f43f5e',
} as const;

/** Target ring colours, cycled by group. */
export const GROUP_COLORS = ['#7dd3fc', '#f9a8d4', '#fde68a', '#e5e7eb'] as const;

export const groupColor = (group: number): string => GROUP_COLORS[((group % 4) + 4) % 4] as string;
export const judgmentColor = (j: Judgment): string => JUDGMENTS[j].color;

/** Time constants, ms. */
export const FX = {
  burstCrisp: 200,
  burstSolid: 170,
  burstRough: 150,
  sparks: 240,
  bodyPop: 120,
  popup: 450,
  popupRise: 14,
  missX: 500,
  missVignette: 120,
  comboBump: 90,
  comboShake: 220,
  comboLost: 700,
  barFade: 4000,
  tickPop: 160,
  banner: 1100,
} as const;
