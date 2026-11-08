import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/catalog';
import { cloneSettings, sanitizeSettings } from './settings';

describe('sanitizeSettings', () => {
  it('fills the language, theme, text size and contrast when a stored settings object predates them', () => {
    const old = { v: 1, input: { rawInput: true }, display: { errorBar: false, reduceMotion: true }, updatedAt: 5 };
    const s = sanitizeSettings(old);
    expect(s.language).toBe('auto');
    expect(s.display.theme).toBe('system');
    expect(s.display.textSize).toBe('default');
    expect(s.display.highContrast).toBe(false);
    // What was stored is kept.
    expect(s.input.rawInput).toBe(true);
    expect(s.display.errorBar).toBe(false);
    expect(s.display.reduceMotion).toBe(true);
    expect(s.updatedAt).toBe(5);
  });

  it('keeps valid choices and replaces bad ones with the defaults', () => {
    const good = sanitizeSettings({ language: 'pt-BR', display: { theme: 'light', textSize: 'larger', highContrast: true } });
    expect(good.language).toBe('pt-BR');
    expect(good.display.theme).toBe('light');
    expect(good.display.textSize).toBe('larger');
    expect(good.display.highContrast).toBe(true);
    const bad = sanitizeSettings({ language: 'xx', display: { theme: 'purple', textSize: 'huge', highContrast: 'yes' } });
    expect(bad.language).toBe('auto');
    expect(bad.display.theme).toBe('system');
    expect(bad.display.textSize).toBe('default');
    expect(bad.display.highContrast).toBe(false);
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('is copied whole by cloneSettings', () => {
    const s = sanitizeSettings({ language: 'ja', display: { theme: 'dark', textSize: 'large', highContrast: true } });
    const c = cloneSettings(s);
    expect(c).toEqual(s);
    expect(c.display).not.toBe(s.display);
    c.display.theme = 'light';
    expect(s.display.theme).toBe('dark');
  });
});
