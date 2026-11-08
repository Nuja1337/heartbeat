// index.css and src/shared/theme.ts each carry the theme hex values: the page reads CSS, the canvas and the charts read
// TypeScript. This test fails when one copy changes without the other.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEMES, contrastRatio, darkenToContrast, resolveTheme } from '../shared/theme';
import type { ThemeTokens } from '../shared/theme';

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

/** The --color-* declarations inside one CSS block. */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  expect(start, `index.css should contain ${selector}`).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6});/g)) out[m[1]!] = m[2]!;
  return out;
}

const CSS_NAME: Record<keyof ThemeTokens, string> = {
  bg: 'bg',
  bg2: 'bg-2',
  surface: 'surface',
  surface2: 'surface-2',
  surface3: 'surface-3',
  line: 'line',
  line2: 'line-2',
  ink: 'ink',
  ink2: 'ink-2',
  ink3: 'ink-3',
  accent: 'accent',
  accentInk: 'accent-ink',
  data: 'data',
  warn: 'warn',
  danger: 'danger',
};

describe('theme tokens', () => {
  it('match index.css for the dark theme', () => {
    const vars = block('@theme {');
    for (const [key, name] of Object.entries(CSS_NAME) as [keyof ThemeTokens, string][]) {
      expect(vars[name], name).toBe(THEMES.dark[key]);
    }
  });

  it('match index.css for the light theme', () => {
    const vars = block(':root[data-theme="light"] {');
    for (const [key, name] of Object.entries(CSS_NAME) as [keyof ThemeTokens, string][]) {
      expect(vars[name], name).toBe(THEMES.light[key]);
    }
  });

  it('read as text on their own surfaces at 4.5:1 or more', () => {
    for (const t of Object.values(THEMES)) {
      for (const fg of [t.ink, t.ink2, t.ink3, t.accent, t.data, t.warn, t.danger]) {
        expect(contrastRatio(fg, t.surface), `${fg} on ${t.surface}`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(fg, t.bg), `${fg} on ${t.bg}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(t.accentInk, t.accent)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('use the light theme-color in index.html', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    expect(html).toContain(`media="(prefers-color-scheme: light)" content="${THEMES.light.bg}"`);
    expect(html).toContain(`media="(prefers-color-scheme: dark)" content="${THEMES.dark.bg}"`);
  });
});

describe('resolveTheme', () => {
  it('follows the OS only for system', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
  });
});

describe('darkenToContrast', () => {
  it('leaves a color that already reads alone and darkens the rest while keeping the hue family', () => {
    expect(darkenToContrast('#141925', '#ffffff', 4.5)).toBe('#141925');
    const lime = darkenToContrast('#c9f25c', '#ffffff', 4.5);
    expect(contrastRatio(lime, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    // Still green-yellow: more green than red, more red than blue.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(lime.slice(i, i + 2), 16));
    expect(g).toBeGreaterThan(r!);
    expect(r).toBeGreaterThan(b!);
    // White becomes a gray that reads.
    expect(contrastRatio(darkenToContrast('#ffffff', '#ffffff', 4.5), '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});
