import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/catalog';
import { computeLayout } from '../engine/playfield';
import { fakeContext } from '../testing/fakes';
import type { CallLog } from '../testing/fakes';
import { Effects } from './effects';
import { groupThousands, Hud } from './hud';
import type { HudData } from './hud';
import { resolveSkin } from './skin';
import { STRINGS } from './strings';

describe('groupThousands', () => {
  it('writes whole numbers the way toLocaleString does for en-US', () => {
    for (const n of [0, 7, 99, 100, 999, 1000, 1234, 12345, 123456, 999999, 1000000, 12345678, -4, -1234]) {
      expect(groupThousands(n), String(n)).toBe(n.toLocaleString('en-US'));
    }
  });
});

describe('Hud text', () => {
  const log: CallLog = { calls: 0, names: new Map() };
  const skin = resolveSkin(DEFAULT_SETTINGS);
  const layout = computeLayout(1280, 720);
  const data = (over: Partial<HudData>): HudData => ({
    showScore: false, score: 0, combo: 0, accuracy: 1, health: null, timeFraction: 0, level: 3, set: 2,
    windows: { crisp: 30, solid: 60, rough: 100 } as HudData['windows'], errorBar: true, fps: null, retry: 0, frames: null, frameBudgetMs: null, ...over,
  });

  it('builds the set text once per set, not on every frame', () => {
    const hud = new Hud();
    const fx = new Effects();
    const ctx = fakeContext(log);
    const spy = vi.spyOn(STRINGS, 'set');
    try {
      for (let i = 0; i < 60; i++) hud.draw(ctx, layout, fx, data({ set: 2 }), 1000 + i * 16, skin);
      expect(spy).toHaveBeenCalledTimes(1);
      hud.draw(ctx, layout, fx, data({ set: 3 }), 3000, skin);
      expect(spy).toHaveBeenCalledTimes(2);
      hud.draw(ctx, layout, fx, data({ set: 2 }), 3016, skin);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('shows the score with thousands separators while it eases up', () => {
    const hud = new Hud();
    const fx = new Effects();
    const texts: string[] = [];
    const ctx = fakeContext(log);
    (ctx as unknown as { fillText: (t: string) => void }).fillText = (t) => texts.push(t);
    for (let i = 0; i < 200; i++) hud.draw(ctx, layout, fx, data({ showScore: true, score: 1234567 }), 1000 + i * 16, skin);
    expect(texts).toContain('1,234,567');
  });
});
