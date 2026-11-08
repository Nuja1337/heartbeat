// The two themes. index.css carries the same hex values for the page, and src/app/theme.test.ts checks that the
// two copies agree. The canvas and the charts read their colors from here, so a theme change reaches every surface.

import type { Judgment } from './types';

/** What the player chose. 'system' follows the operating system. */
export type ThemeChoice = 'system' | 'dark' | 'light';
/** What is on screen. */
export type ThemeId = 'dark' | 'light';
export type TextSize = 'default' | 'large' | 'larger';

export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'dark', 'light'];
export const TEXT_SIZES: readonly TextSize[] = ['default', 'large', 'larger'];

/** The root font size for each text size, as a percentage of the browser default. */
export const TEXT_SIZE_PERCENT: Record<TextSize, number> = { default: 100, large: 112.5, larger: 125 };

export function resolveTheme(choice: ThemeChoice, osPrefersLight: boolean): ThemeId {
  if (choice === 'dark' || choice === 'light') return choice;
  return osPrefersLight ? 'light' : 'dark';
}

export interface ThemeTokens {
  bg: string;
  bg2: string;
  surface: string;
  surface2: string;
  surface3: string;
  line: string;
  line2: string;
  ink: string;
  ink2: string;
  ink3: string;
  accent: string;
  accentInk: string;
  data: string;
  warn: string;
  danger: string;
}

/**
 * The dark theme is the original Heartbeat look: near-black blue surfaces, a lime accent and cyan for data.
 * The light theme keeps the hues and turns the accents dark enough to read as text on white (4.5:1 or more).
 */
export const THEMES: Record<ThemeId, ThemeTokens> = {
  dark: {
    bg: '#07090e',
    bg2: '#0b0f17',
    surface: '#0f141d',
    surface2: '#151c28',
    surface3: '#1c2534',
    line: '#1e2735',
    line2: '#2b3648',
    ink: '#eef1f6',
    ink2: '#a3adbd',
    ink3: '#7c879b',
    accent: '#c9f25c',
    accentInk: '#121a05',
    data: '#5ee7f2',
    warn: '#ffb340',
    danger: '#ff4f6a',
  },
  light: {
    bg: '#f5f6fa',
    bg2: '#eceef4',
    surface: '#ffffff',
    surface2: '#f3f4f8',
    surface3: '#e6e9f0',
    line: '#dfe3ec',
    line2: '#c6cdda',
    ink: '#141925',
    ink2: '#48526a',
    ink3: '#5f6a81',
    accent: '#4a7a00',
    accentInk: '#ffffff',
    data: '#0b7a85',
    warn: '#9a5a00',
    danger: '#c91f3f',
  },
};

/* ------------------------------------------------------------ color math */

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colors, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function hsl(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  if (s === 0) return toHex(l * 255, l * 255, l * 255);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t0: number) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return toHex(channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255);
}

/**
 * The same hue, dark enough to reach the contrast against a light background. Lightness goes down in small steps
 * and saturation is capped, so a near-white turns gray rather than staying invisible. Colors that already reach the
 * contrast come back unchanged.
 */
export function darkenToContrast(hex: string, against: string, target: number): string {
  if (contrastRatio(hex, against) >= target) return hex;
  const [h, s0, l0] = hsl(hex);
  const s = Math.min(s0, 0.85);
  let l = Math.min(l0, 0.5);
  let out = fromHsl(h, s, l);
  while (contrastRatio(out, against) < target && l > 0.05) {
    l -= 0.01;
    out = fromHsl(h, s, l);
  }
  return out;
}

export interface PaletteColors {
  /** Target ring colors, one per color group. */
  groups: readonly [string, string, string, string];
  judgments: Record<Judgment, string>;
  /**
   * Colors for the light theme, when darkening the dark ones would not do. Darkening pulls orange and yellow toward
   * the same olive, so a palette built to stay apart with color blindness names its light colors itself.
   */
  light?: { groups: readonly [string, string, string, string]; judgments: Record<Judgment, string> };
}

const paletteCache = new Map<string, PaletteColors>();

/**
 * A palette's colors for a theme. On the dark theme they are the palette as written. On the light theme every color
 * is darkened until it reads at 4.5:1 against the light playfield, which keeps the hues and the differences between
 * them (Clear view stays telling-apart-safe, for example) while making each one visible on white.
 */
export function paletteForTheme(id: string, palette: PaletteColors, theme: ThemeId): PaletteColors {
  if (theme === 'dark') return palette;
  const key = `${id}|${theme}`;
  const hit = paletteCache.get(key);
  if (hit) return hit;
  const field = THEMES.light.surface;
  const adjust = (c: string) => darkenToContrast(c, field, 4.5);
  const source = palette.light ?? palette;
  const out: PaletteColors = {
    groups: source.groups.map(adjust) as unknown as PaletteColors['groups'],
    judgments: {
      crisp: adjust(source.judgments.crisp),
      solid: adjust(source.judgments.solid),
      rough: adjust(source.judgments.rough),
      miss: adjust(source.judgments.miss),
    },
  };
  paletteCache.set(key, out);
  return out;
}
