// Colours, sizes and timings for drawing. The values follow PLAN-2 section 9 (the visual direction) and 5.4.

/** The canvas shares the app's display face. The app loads the file, and every frame redraws its text. */
export const FONT = '"Space Grotesk Variable", ui-sans-serif, system-ui, sans-serif';

export const COLORS = {
  bg: '#07090e',
  field: '#0b1018',
  fieldEdge: '#1e2735',
  reticle: '#2b3648',
  grid: '#182130',
  body: '#151c28',
  bodyDeep: '#0f151f',
  ink: '#eef1f6',
  ink2: '#a3adbd',
  ink3: '#6b7689',
  accent: '#c9f25c',
  data: '#5ee7f2',
  warn: '#ffb340',
  danger: '#ff4f6a',
  spot: '#07090e',
  health: '#5ee7f2',
  healthLow: '#ff4f6a',
} as const;

/** Time constants, ms. */
export const FX = {
  ringCrisp: 220,
  ringSolid: 180,
  ringRough: 150,
  sparks: 240,
  bodyPop: 120,
  popup: 450,
  popupRise: 10,
  popupScale: 90,
  missX: 500,
  missTurn: 120,
  missFlash: 200,
  missVignette: 120,
  comboBump: 90,
  comboShake: 220,
  comboLost: 700,
  barFade: 4000,
  tickPop: 160,
  ripple: 160,
  trackIn: 120,
  trackOut: 150,
  followFade: 150,
  banner: 1100,
} as const;

/** "#rrggbb" as an rgba() string. Build these once, never per frame. */
export function hexAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const easeOut = (u: number): number => 1 - (1 - u) * (1 - u) * (1 - u);
