import { describe, expect, it } from 'vitest';
import { DEFAULT_DIFFICULTY, LEVEL_PRESETS, MOD_SCALE, windowsForTiming } from '../../shared/catalog';
import type { SliderObject } from '../../shared/types';
import { healthRulesFor } from '../rules/scoring';
import { makeCircle, makeMap, makeSlider, makeSpinner } from '../testing/fixtures';
import { deriveParams } from './difficulty';
import { applyMods, applyModsToObjects, modsForMode, rateFor } from './mods';

const sample = () =>
  makeMap(
    [
      makeCircle(0, 2000, 100, 100),
      makeSlider(1, 3000, { x: 200, y: 200 }, [{ type: 'arc', through: { x: 300, y: 250 }, to: { x: 400, y: 200 } }], { spanMs: 500, repeats: 1 }),
      makeSpinner(2, 6000, 2000, 6),
    ],
    { health: healthRulesFor(5, []), sections: [{ start: 0, end: 8000, intensity: 0.5, focus: 'jumps' }] },
  );

describe('applyMods', () => {
  it('divides times and approach by 1.25 for Fast', () => {
    const m = applyMods(sample(), ['fast']);
    expect(m.rate).toBe(1.25);
    expect(m.objects[0]!.time).toBeCloseTo(1600, 9);
    expect(m.objects[0]!.approachMs).toBeCloseTo(640, 9);
    const s = m.objects[1] as SliderObject;
    expect(s.time).toBeCloseTo(2400, 9);
    expect(s.spanMs).toBeCloseTo(400, 9);
    expect(s.endTime).toBeCloseTo(2400 + 400 * 2, 9);
    expect(s.velocity * s.spanMs).toBeCloseTo(s.length, 6);
    expect(m.objects[2]!.time).toBeCloseTo(4800, 9);
    expect(m.beatMs).toBeCloseTo(400, 9);
    expect(m.sections[0]!.end).toBeCloseTo(6400, 9);
  });

  it('keeps hit windows in real milliseconds', () => {
    const m = applyMods(sample(), ['fast']);
    expect(m.objects[0]!.windows).toEqual(windowsForTiming(5));
  });

  it('slows the map for Slow', () => {
    const m = applyMods(sample(), ['slow']);
    expect(m.rate).toBe(0.8);
    expect(m.objects[0]!.time).toBeCloseTo(2500, 9);
  });

  it('flips path points for Mirror', () => {
    const m = applyMods(sample(), ['mirror']);
    expect(m.objects[0]!.pos.x).toBe(900);
    const s = m.objects[1] as SliderObject;
    expect(s.pos.x).toBe(800);
    const seg = s.path[0]!;
    expect(seg.type).toBe('arc');
    if (seg.type === 'arc') {
      expect(seg.through.x).toBe(700);
      expect(seg.to.x).toBe(600);
      expect(seg.to.y).toBe(200);
    }
    expect(m.objects[2]!.pos.x).toBe(500);
  });

  it('does not change the input map', () => {
    const map = sample();
    applyMods(map, ['mirror', 'fast']);
    expect(map.objects[0]!.pos.x).toBe(100);
    expect(map.objects[0]!.time).toBe(2000);
  });

  it('sets the health flags', () => {
    expect(applyMods(sample(), ['nofail']).health!.canFail).toBe(false);
    expect(applyMods(sample(), ['onelife']).health!.failOnFirstMiss).toBe(true);
    expect(applyMods(sample(), []).health!.canFail).toBe(true);
  });

  it('keeps the padding after the last object when the rate changes', () => {
    const base = sample();
    const m = applyMods(base, ['fast']);
    expect(m.durationMs).toBeCloseTo((base.durationMs - 1000) / 1.25 + 1000, 9);
  });

  it('mirrors adaptive sets without touching time', () => {
    const out = applyModsToObjects(sample().objects, ['mirror']);
    expect(out[0]!.pos.x).toBe(900);
    expect(out[0]!.time).toBe(2000);
  });
});

describe('Tight and Wide', () => {
  it('scale the radius and windows before generation', () => {
    const base = deriveParams(DEFAULT_DIFFICULTY, []);
    const tight = deriveParams(DEFAULT_DIFFICULTY, ['tight']);
    const wide = deriveParams(DEFAULT_DIFFICULTY, ['wide']);
    expect(tight.radius).toBeCloseTo(base.radius * MOD_SCALE.tight.radius, 9);
    expect(tight.windows.crisp).toBeCloseTo(base.windows.crisp * MOD_SCALE.tight.windows, 9);
    expect(tight.windows.rough).toBeCloseTo(base.windows.rough * MOD_SCALE.tight.windows, 9);
    expect(wide.radius).toBeCloseTo(base.radius * MOD_SCALE.wide.radius, 9);
    expect(wide.windows.solid).toBeCloseTo(base.windows.solid * MOD_SCALE.wide.windows, 9);
  });

  it('gives timing 5 windows of 40, 80 and 120 ms', () => {
    const p = deriveParams(LEVEL_PRESETS[4]!.difficulty, []);
    expect(p.windows.crisp).toBe(40);
    expect(p.windows.rough).toBe(120);
  });
});

describe('mode helpers', () => {
  it('finds the rate', () => {
    expect(rateFor([])).toBe(1);
    expect(rateFor(['fast'])).toBe(1.25);
    expect(rateFor(['slow'])).toBe(0.8);
  });

  it('keeps only the mods a mode allows', () => {
    expect(modsForMode('jumps', ['fade', 'fast', 'mirror'])).toEqual(['fade', 'mirror']);
    expect(modsForMode('dynamic', ['fast'])).toEqual(['fast']);
  });
});

describe('applyMods and the beat offset', () => {
  const withOffset = () => ({ ...sample(), beatOffsetMs: 2000 });

  it('divides beatOffsetMs by the rate, like the times it sits among', () => {
    expect(applyMods(withOffset(), ['fast']).beatOffsetMs).toBeCloseTo(1600, 9);
    expect(applyMods(withOffset(), ['slow']).beatOffsetMs).toBeCloseTo(2500, 9);
    expect(applyMods(withOffset(), []).beatOffsetMs).toBe(2000);
    expect(applyMods(withOffset(), ['mirror']).beatOffsetMs).toBe(2000);
  });

  it('leaves it absent when the map has none', () => {
    expect('beatOffsetMs' in applyMods(sample(), ['fast'])).toBe(false);
  });

  it('keeps beat 0 on the first object of the grid through Fast and Slow', () => {
    for (const mod of ['fast', 'slow'] as const) {
      const m = applyMods(withOffset(), [mod]);
      // The first object sat on beat 0 and still does.
      expect(m.objects[0]!.time).toBeCloseTo(m.beatOffsetMs!, 9);
    }
  });
});
