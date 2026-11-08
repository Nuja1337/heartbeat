// Colours, sizes and timings for drawing. The values follow PLAN-2 section 9 (the visual direction) and 5.4.
// The page tokens come from src/shared/theme.ts, so the playfield and the pages always match.

import { THEMES, resolveTheme } from '../../shared/theme';
import type { ThemeId } from '../../shared/theme';
import type { Settings } from '../../shared/types';

/** The canvas shares the app's display face. The app loads the file, and every frame redraws its text. */
export const FONT = '"Space Grotesk Variable", ui-sans-serif, system-ui, sans-serif';

interface CanvasColors {
  bg: string;
  field: string;
  /** The middle of the field, a little lighter than its edge on the dark theme. */
  fieldCenter: string;
  fieldEdge: string;
  reticle: string;
  grid: string;
  body: string;
  bodyTop: string;
  bodyDeep: string;
  ink: string;
  ink2: string;
  ink3: string;
  accent: string;
  data: string;
  warn: string;
  danger: string;
  /** The spotlight cover, at full and at zero alpha. */
  spot: string;
  spotClear: string;
  health: string;
  healthLow: string;
  /** The translucent panel behind HUD text and the outline around the drawn cursor. */
  panel: string;
  outline: string;
  /** Dimmed slider ticks and the spinner time ring. */
  tickDim: string;
  spinTime: string;
  /** The field while the player is failing. */
  failing: string;
}

const dark: CanvasColors = {
  bg: THEMES.dark.bg,
  field: '#0b1018',
  fieldCenter: '#0d141f',
  fieldEdge: THEMES.dark.line,
  reticle: THEMES.dark.line2,
  grid: '#182130',
  body: THEMES.dark.surface2,
  bodyTop: '#1b2433',
  bodyDeep: '#0f151f',
  ink: THEMES.dark.ink,
  ink2: THEMES.dark.ink2,
  ink3: THEMES.dark.ink3,
  accent: THEMES.dark.accent,
  data: THEMES.dark.data,
  warn: THEMES.dark.warn,
  danger: THEMES.dark.danger,
  spot: 'rgba(7, 9, 14, 0.95)',
  spotClear: 'rgba(7, 9, 14, 0)',
  health: THEMES.dark.data,
  healthLow: THEMES.dark.danger,
  panel: 'rgba(7, 9, 14, 0.78)',
  outline: 'rgba(7, 9, 14, 0.9)',
  tickDim: 'rgba(163, 173, 189, 0.28)',
  spinTime: 'rgba(238, 241, 246, 0.4)',
  failing: '#2a0a12',
};

const light: CanvasColors = {
  bg: THEMES.light.bg,
  field: '#fbfcfe',
  fieldCenter: '#ffffff',
  fieldEdge: THEMES.light.line2,
  reticle: '#aeb6c6',
  grid: '#d9dee8',
  body: '#dfe4ee',
  bodyTop: '#eef1f7',
  bodyDeep: '#ccd3e0',
  ink: THEMES.light.ink,
  ink2: THEMES.light.ink2,
  ink3: THEMES.light.ink3,
  accent: THEMES.light.accent,
  data: THEMES.light.data,
  warn: THEMES.light.warn,
  danger: THEMES.light.danger,
  spot: 'rgba(245, 246, 250, 0.96)',
  spotClear: 'rgba(245, 246, 250, 0)',
  health: THEMES.light.data,
  healthLow: THEMES.light.danger,
  panel: 'rgba(255, 255, 255, 0.82)',
  outline: 'rgba(255, 255, 255, 0.9)',
  tickDim: 'rgba(72, 82, 106, 0.3)',
  spinTime: 'rgba(20, 25, 37, 0.4)',
  failing: '#f6dde2',
};

const TABLES: Record<ThemeId, CanvasColors> = { dark, light };

/**
 * The colours in use. The renderer reads them every frame, and `applyCanvasTheme` swaps the whole set, so a theme
 * change reaches every drawing call without each one asking which theme is on.
 */
export const COLORS: CanvasColors = { ...dark };

let active: ThemeId = 'dark';

export function applyCanvasTheme(theme: ThemeId): void {
  if (theme === active) return;
  active = theme;
  Object.assign(COLORS, TABLES[theme]);
}

export const activeCanvasTheme = (): ThemeId => active;

let lightQuery: MediaQueryList | null | undefined;

/** The theme these settings ask for, right now. 'system' reads the operating system each time it is asked. */
export function canvasThemeFor(settings: Pick<Settings, 'display'>): ThemeId {
  const choice = settings.display.theme;
  if (choice !== 'system') return choice;
  if (lightQuery === undefined) {
    try {
      lightQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;
    } catch {
      lightQuery = null;
    }
  }
  return resolveTheme(choice, lightQuery?.matches ?? false);
}

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
