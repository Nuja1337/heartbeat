// Generator 2 (PLAN-2 section 6): pattern frequencies, slider shapes, structure in the map, planned spinners, mirrored sections.

import { describe, expect, it } from 'vitest';
import { LEVEL_PRESETS } from '../../shared/catalog';
import type { DifficultySettings, HitObject, SliderObject } from '../../shared/types';
import { launchFor } from '../testing/fixtures';
import { sliderFamily, sliderShapeProblems } from '../testing/mapRules';
import { deriveParams } from './difficulty';
import { generateDynamic } from './generator';
import { mirrorPoint } from './placement';
import type { MirrorAxis } from './placement';
import { createRng } from './rng';
import { planStructure } from './structure';

const EXTREMES: DifficultySettings[] = [
  { radius: 30, approachMs: 300, bpm: 260, density: 10, spacing: 10, complexity: 10, streams: 10, streamMaxLength: 32, sliders: 10, spinners: 10, timing: 10 },
  { radius: 50, approachMs: 1800, bpm: 240, density: 10, spacing: 6, complexity: 8, streams: 6, streamMaxLength: 20, sliders: 6, spinners: 4, timing: 5 },
];

const withLevel = (over: Partial<DifficultySettings>): DifficultySettings => ({ ...LEVEL_PRESETS[7]!.difficulty, ...over });

function countPatterns(d: DifficultySettings, seeds: number, len = 90): Record<string, number> {
  const out: Record<string, number> = {};
  for (let seed = 1; seed <= seeds; seed++) {
    for (const o of generateDynamic(launchFor(d, seed, len)).objects) out[o.pattern] = (out[o.pattern] ?? 0) + 1;
  }
  return out;
}

describe('pattern frequencies', () => {
  it('uses polygons from complexity 5, stacks from 3, and more stacks as complexity rises', () => {
    const lo = countPatterns(withLevel({ complexity: 4 }), 12);
    const hi = countPatterns(withLevel({ complexity: 9 }), 12);
    expect(lo.polygon ?? 0).toBe(0);
    expect(hi.polygon ?? 0).toBeGreaterThan(10);
    expect(countPatterns(withLevel({ complexity: 2 }), 12).stack ?? 0).toBe(0);
    const c3 = countPatterns(withLevel({ complexity: 3 }), 12);
    expect(c3.stack ?? 0).toBeGreaterThan(0);
    expect(hi.stack ?? 0).toBeGreaterThan(c3.stack ?? 0);
  });

  it('cuts streams only with streams of 4 or more and complexity 5 or more', () => {
    expect(countPatterns(withLevel({ streams: 3 }), 10).cutstream ?? 0).toBe(0);
    expect(countPatterns(withLevel({ complexity: 4 }), 10).cutstream ?? 0).toBe(0);
    expect(countPatterns(withLevel({ streams: 8, complexity: 8, streamMaxLength: 24 }), 10).cutstream ?? 0).toBeGreaterThan(10);
  });

  it('spaces streams only at jump distance 6 or more', () => {
    expect(countPatterns(withLevel({ spacing: 5 }), 12).spacedstream ?? 0).toBe(0);
    expect(countPatterns(withLevel({ spacing: 9, streams: 8 }), 12).spacedstream ?? 0).toBeGreaterThan(0);
  });

  it('makes triples and bursts only with streams on', () => {
    expect(countPatterns(withLevel({ streams: 0 }), 6).burst ?? 0).toBe(0);
    expect(countPatterns(withLevel({ streams: 6 }), 6).burst ?? 0).toBeGreaterThan(20);
  });

  it('draws zigzags only from complexity 6, and the slider mix stays near 0.3 straight, 0.4 arc and 0.3 curve', () => {
    const sliders = (c: number) => {
      const out: SliderObject[] = [];
      for (let seed = 1; seed <= 25; seed++) {
        for (const o of generateDynamic(launchFor(withLevel({ complexity: c, sliders: 10, spinners: 0 }), seed, 120)).objects) if (o.kind === 'slider') out.push(o);
      }
      return out;
    };
    expect(sliders(5).filter((s) => sliderFamily(s) === 'zigzag')).toHaveLength(0);
    const high = sliders(9);
    expect(high.length).toBeGreaterThan(150);
    expect(high.filter((s) => sliderFamily(s) === 'zigzag').length).toBeGreaterThan(0);
    const share = (f: (s: SliderObject) => boolean) => high.filter(f).length / high.length;
    // A slider that cannot take its wanted shape falls back to a line, so straight runs a little over 0.3.
    expect(share((s) => s.shape === 'straight')).toBeGreaterThan(0.25);
    expect(share((s) => s.shape === 'straight')).toBeLessThan(0.5);
    expect(share((s) => s.shape === 'arc')).toBeGreaterThan(0.25);
    expect(share((s) => s.shape === 'arc')).toBeLessThan(0.5);
    expect(share((s) => s.shape === 'curve')).toBeGreaterThan(0.2);
    for (const f of ['cubic', 'wave', 'hook'] as const) expect(high.some((s) => sliderFamily(s) === f), f).toBe(true);
  });
});

describe('slider shapes', () => {
  it('never cross, bend tighter than the follow radius, leave the field or double back, over many seeds and slider-heavy settings', () => {
    const settings = [...LEVEL_PRESETS.map((p) => ({ ...p.difficulty, sliders: 10 })), ...EXTREMES];
    let seen = 0;
    for (const d of settings) {
      for (let seed = 1; seed <= 12; seed++) {
        const m = generateDynamic(launchFor(d, seed, 90));
        for (const o of m.objects) {
          if (o.kind !== 'slider') continue;
          seen++;
          const v = sliderShapeProblems(o, `${o.index}`);
          if (v.length > 0) throw new Error(`r ${d.radius} bpm ${d.bpm} seed ${seed}: ${v.join('; ')}`);
        }
      }
    }
    expect(seen).toBeGreaterThan(1500);
  });
});

describe('structure in the map', () => {
  it('starts at least 60% of motifs on a bar downbeat, over 50 seeds', () => {
    let groups = 0;
    let downs = 0;
    for (const lp of LEVEL_PRESETS) {
      for (let seed = 1; seed <= 50; seed++) {
        const m = generateDynamic(launchFor(lp.difficulty, seed, Math.min(60, lp.lengthSec)));
        const t0 = m.beatOffsetMs!;
        const seen = new Set<number>();
        for (const o of m.objects) {
          if (o.kind === 'spinner' || seen.has(o.group)) continue;
          seen.add(o.group);
          groups++;
          const bars = (o.time - t0) / (m.beatMs * 4);
          if (Math.abs(bars - Math.round(bars)) * 4 < 0.05) downs++;
        }
      }
    }
    expect(downs / groups).toBeGreaterThanOrEqual(0.6);
  });

  it('plans every spinner and places exactly those', () => {
    let placed = 0;
    const all = [...LEVEL_PRESETS.map((p) => ({ level: p.level, difficulty: p.difficulty, lengthSec: p.lengthSec })), ...EXTREMES.map((d, i) => ({ level: 9 + i, difficulty: d, lengthSec: 60 }))];
    for (const lp of all) {
      for (let seed = 1; seed <= 30; seed++) {
        const len = Math.min(lp.lengthSec, 90);
        const map = generateDynamic(launchFor(lp.difficulty, seed, len));
        const p = deriveParams(lp.difficulty, []);
        const plan = planStructure({ p, t0: map.beatOffsetMs!, endMs: Math.max(20000, len * 1000) - 1000, rate: 1 }, createRng(seed).fork('dynamic').fork('structure'));
        const n = map.objects.filter((o) => o.kind === 'spinner').length;
        expect(n, `level ${lp.level} seed ${seed}`).toBe(plan.spinners.length);
        placed += n;
      }
    }
    expect(placed).toBeGreaterThan(20);
  });

  it('keeps every spinner out of the first 8 s and the last 5 s and puts content after it, also at the Fast rate', () => {
    for (const rate of [1, 1.25]) {
      for (const lp of LEVEL_PRESETS) {
        for (let seed = 1; seed <= 20; seed++) {
          const map = generateDynamic(launchFor(lp.difficulty, seed, 90), rate);
          const objs = map.objects;
          objs.forEach((o, i) => {
            if (o.kind !== 'spinner') return;
            expect(o.time, `L${lp.level} s${seed}`).toBeGreaterThanOrEqual(8000 * rate);
            expect(o.endTime, `L${lp.level} s${seed}`).toBeLessThanOrEqual(map.durationMs - 5000 * rate + 0.5);
            expect(objs[i + 1], `L${lp.level} s${seed} content after`).toBeDefined();
          });
        }
      }
    }
  });

  it('labels sections with roles, starts with an intro and ends with an outro', () => {
    for (const lp of LEVEL_PRESETS) {
      const m = generateDynamic(launchFor(lp.difficulty, 4, lp.lengthSec));
      expect(m.sections.every((s) => s.role !== undefined)).toBe(true);
      expect(m.sections[0]!.role).toBe('intro');
      expect(m.sections[m.sections.length - 1]!.role).toBe('outro');
      for (const s of m.sections) if (s.role === 'rest') expect(s.focus).toBe('break');
      m.sections.slice(1).forEach((s, i) => expect(s.start).toBeCloseTo(m.sections[i]!.end, 5));
    }
  });

  it('thins out in rests', () => {
    let rest = 0;
    let restBeats = 0;
    let busy = 0;
    let busyBeats = 0;
    for (const lp of LEVEL_PRESETS.slice(2)) {
      for (let seed = 1; seed <= 10; seed++) {
        const m = generateDynamic(launchFor(lp.difficulty, seed, lp.lengthSec));
        for (const s of m.sections) {
          const n = m.objects.filter((o) => o.kind !== 'spinner' && o.time >= s.start && o.time < s.end).length;
          const beats = (s.end - s.start) / m.beatMs;
          if (s.role === 'rest') {
            rest += n;
            restBeats += beats;
          } else if (s.role === 'peak') {
            busy += n;
            busyBeats += beats;
          }
        }
      }
    }
    expect(rest / restBeats).toBeLessThan(0.6 * (busy / busyBeats));
  });

  it('rises: peaks above builds above rests', () => {
    const mean = (role: string) => {
      const v: number[] = [];
      for (let seed = 1; seed <= 10; seed++) {
        for (const s of generateDynamic(launchFor(LEVEL_PRESETS[5]!.difficulty, seed, 120)).sections) if (s.role === role) v.push(s.intensity);
      }
      return v.reduce((a, b) => a + b, 0) / v.length;
    };
    expect(mean('peak')).toBeGreaterThan(mean('build'));
    expect(mean('build')).toBeGreaterThan(mean('rest'));
  });
});

describe('mirrored sections', () => {
  /** The axis that maps `a` onto `b` exactly, or null. */
  const axisOf = (a: HitObject, b: HitObject): MirrorAxis | null => {
    for (const axis of ['v', 'h', 'c'] as const) {
      const m = mirrorPoint(a.pos, axis);
      if (m.x === b.pos.x && m.y === b.pos.y) return axis;
    }
    return null;
  };

  it('replays the first half in the second half, mirrored exactly', () => {
    let found = 0;
    for (const lp of LEVEL_PRESETS.slice(3)) {
      for (let seed = 1; seed <= 40; seed++) {
        const m = generateDynamic(launchFor(lp.difficulty, seed, lp.lengthSec));
        for (const s of m.sections) {
          if (!s.mirrored) continue;
          found++;
          expect(s.role === 'build' || s.role === 'peak').toBe(true);
          const half = (s.end - s.start) / 2;
          const inSec = m.objects.filter((o) => o.kind !== 'spinner' && o.time >= s.start - 0.01 && o.time < s.end - 0.01);
          const first = inSec.filter((o) => o.time < s.start + half - 0.3);
          const second = inSec.filter((o) => o.time >= s.start + half - 0.3);
          expect(second.length, `L${lp.level} s${seed}`).toBe(first.length);
          const axis = axisOf(first[0]!, second[0]!);
          expect(axis, `L${lp.level} s${seed}`).not.toBeNull();
          first.forEach((a, i) => {
            const b = second[i]!;
            expect(b.kind).toBe(a.kind);
            expect(b.pattern).toBe(a.pattern);
            expect(Math.abs(b.time - a.time - half)).toBeLessThan(0.35);
            expect(b.pos, `object ${i}`).toEqual(mirrorPoint(a.pos, axis!));
            if (a.kind === 'slider' && b.kind === 'slider') {
              expect(b.repeats).toBe(a.repeats);
              const f = (p: { x: number; y: number }) => mirrorPoint(p, axis!);
              const want = a.path.map((seg) =>
                seg.type === 'line' ? { type: 'line', to: f(seg.to) } : seg.type === 'arc' ? { type: 'arc', through: f(seg.through), to: f(seg.to) } : { type: 'cubic', c1: f(seg.c1), c2: f(seg.c2), to: f(seg.to) },
              );
              expect(b.path).toEqual(want);
            }
          });
        }
      }
    }
    expect(found).toBeGreaterThan(8);
  });

  it('never mirrors below complexity 4', () => {
    const d = { ...LEVEL_PRESETS[5]!.difficulty, complexity: 3 };
    for (let seed = 1; seed <= 30; seed++) expect(generateDynamic(launchFor(d, seed, 120)).sections.some((s) => s.mirrored)).toBe(false);
  });
});
