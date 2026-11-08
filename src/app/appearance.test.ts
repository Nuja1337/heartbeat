import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, PALETTES } from '../shared/catalog';
import { cloneSettings } from '../data/settings';
import { contrastRatio, paletteForTheme, THEMES } from '../shared/theme';
import { applyAppearance, paletteVars, withFirstRunMotion } from './state/appearance';

describe('palette variables', () => {
  it('gives the four judgment colors of every palette on the dark theme', () => {
    for (const id of Object.keys(PALETTES) as (keyof typeof PALETTES)[]) {
      const j = PALETTES[id].judgments;
      expect(paletteVars(id, 'dark')).toEqual({ '--hb-crisp': j.crisp, '--hb-solid': j.solid, '--hb-rough': j.rough, '--hb-miss': j.miss });
    }
  });

  it('keeps the light colors of every palette apart from each other', () => {
    // Darkening alone pulls orange and yellow toward one olive. The distance here is plain RGB, a coarse guard
    // against two colors that a player could not tell apart on white.
    const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const apart = (a: string, b: string) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]!));
    for (const id of Object.keys(PALETTES) as (keyof typeof PALETTES)[]) {
      const light = paletteForTheme(id, PALETTES[id], 'light');
      const colors = [...light.groups, ...Object.values(light.judgments)];
      const groups = light.groups;
      for (let i = 0; i < groups.length; i++) {
        for (let j = i + 1; j < groups.length; j++)
          expect(apart(groups[i]!, groups[j]!), `${id} groups ${groups[i]} ${groups[j]}`).toBeGreaterThan(50);
      }
      const j = Object.values(light.judgments);
      for (let a = 0; a < j.length; a++) {
        for (let b = a + 1; b < j.length; b++) expect(apart(j[a]!, j[b]!), `${id} judgments ${j[a]} ${j[b]}`).toBeGreaterThan(50);
      }
      for (const c of colors) expect(contrastRatio(c, THEMES.light.surface), `${id} ${c}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('darkens every judgment color on the light theme until it reads on white', () => {
    for (const id of Object.keys(PALETTES) as (keyof typeof PALETTES)[]) {
      for (const value of Object.values(paletteVars(id, 'light'))) {
        expect(contrastRatio(value, THEMES.light.surface), `${id} ${value}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  function fakeRoot() {
    const style = new Map<string, string>();
    const root = {
      style: { setProperty: (k: string, v: string) => style.set(k, v) },
      dataset: {} as Record<string, string>,
      querySelectorAll: () => [],
    };
    return { style, root: root as unknown as HTMLElement, dataset: root.dataset };
  }

  it('writes them and the motion flag onto the root element', () => {
    const { style, root, dataset } = fakeRoot();
    const s = cloneSettings(DEFAULT_SETTINGS);
    s.skin.palette = 'contrast';
    s.display.reduceMotion = true;
    s.display.theme = 'dark';
    applyAppearance(s, root);
    expect(style.get('--hb-miss')).toBe(PALETTES.contrast.judgments.miss);
    expect(dataset.reduceMotion).toBe('true');
    s.display.reduceMotion = false;
    applyAppearance(s, root);
    expect(dataset.reduceMotion).toBe('false');
  });

  it('writes the theme, the text size and the contrast', () => {
    const { root, dataset } = fakeRoot();
    const s = cloneSettings(DEFAULT_SETTINGS);
    s.display.theme = 'light';
    s.display.textSize = 'larger';
    s.display.highContrast = true;
    applyAppearance(s, root);
    expect(dataset.theme).toBe('light');
    expect(dataset.text).toBe('larger');
    expect(dataset.contrast).toBe('high');
    s.display.theme = 'dark';
    s.display.textSize = 'default';
    s.display.highContrast = false;
    applyAppearance(s, root);
    expect(dataset.theme).toBe('dark');
    expect(dataset.text).toBeUndefined();
    expect(dataset.contrast).toBeUndefined();
  });
});

describe('reduced motion on first run', () => {
  it('follows the OS when no settings were ever saved', () => {
    const fresh = cloneSettings(DEFAULT_SETTINGS);
    expect(fresh.updatedAt).toBe(0);
    expect(withFirstRunMotion(fresh, true).display.reduceMotion).toBe(true);
    expect(withFirstRunMotion(fresh, false).display.reduceMotion).toBe(false);
    // The input is not changed.
    expect(fresh.display.reduceMotion).toBe(false);
  });

  it('leaves saved settings alone', () => {
    const saved = { ...cloneSettings(DEFAULT_SETTINGS), updatedAt: 1_700_000_000_000 };
    expect(withFirstRunMotion(saved, true)).toBe(saved);
    expect(withFirstRunMotion(saved, true).display.reduceMotion).toBe(false);
  });
});
