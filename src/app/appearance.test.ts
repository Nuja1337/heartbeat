import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, PALETTES } from '../shared/catalog';
import { cloneSettings } from '../data/settings';
import { applyAppearance, paletteVars, withFirstRunMotion } from './state/appearance';

describe('palette variables', () => {
  it('gives the four judgment colors of every palette', () => {
    for (const id of Object.keys(PALETTES) as (keyof typeof PALETTES)[]) {
      const j = PALETTES[id].judgments;
      expect(paletteVars(id)).toEqual({ '--hb-crisp': j.crisp, '--hb-solid': j.solid, '--hb-rough': j.rough, '--hb-miss': j.miss });
    }
  });

  it('writes them and the motion flag onto the root element', () => {
    const style = new Map<string, string>();
    const root = { style: { setProperty: (k: string, v: string) => style.set(k, v) }, dataset: {} as Record<string, string> };
    const s = cloneSettings(DEFAULT_SETTINGS);
    s.skin.palette = 'contrast';
    s.display.reduceMotion = true;
    applyAppearance(s, root as unknown as HTMLElement);
    expect(style.get('--hb-miss')).toBe(PALETTES.contrast.judgments.miss);
    expect(root.dataset.reduceMotion).toBe('true');
    s.display.reduceMotion = false;
    applyAppearance(s, root as unknown as HTMLElement);
    expect(root.dataset.reduceMotion).toBe('false');
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
