import { describe, expect, it } from 'vitest';
import { DEFAULT_DIFFICULTY, LEVEL_PRESETS } from '../../shared/catalog';
import type { DifficultySettings, GeneratedMap } from '../../shared/types';
import { launchFor } from '../testing/fixtures';
import { endTime, violations } from '../testing/mapRules';
import { deriveParams, halfBeatProb } from './difficulty';
import { computeFeatures, endPosition } from './features';
import { generateDynamic } from './generator';
import { rateFor } from './mods';

const EXTREMES: DifficultySettings[] = [
  { radius: 30, approachMs: 300, bpm: 260, density: 10, spacing: 10, complexity: 10, streams: 10, streamMaxLength: 32, sliders: 10, spinners: 10, timing: 10 },
  { radius: 70, approachMs: 1800, bpm: 90, density: 1, spacing: 1, complexity: 1, streams: 0, streamMaxLength: 3, sliders: 0, spinners: 0, timing: 0 },
  { radius: 50, approachMs: 1800, bpm: 240, density: 10, spacing: 6, complexity: 8, streams: 6, streamMaxLength: 20, sliders: 6, spinners: 4, timing: 5 },
];

describe('generator determinism', () => {
  it('repeats for presets and seeds, and differs between seeds', () => {
    for (const lp of LEVEL_PRESETS) {
      let prev: GeneratedMap | null = null;
      for (let seed = 1; seed <= 50; seed++) {
        const a = generateDynamic(launchFor(lp.difficulty, seed, lp.lengthSec));
        if (seed <= 4) expect(generateDynamic(launchFor(lp.difficulty, seed, lp.lengthSec))).toEqual(a);
        if (prev) expect(a.objects).not.toEqual(prev.objects);
        prev = a;
      }
    }
  });

  it('repeats for extreme custom settings', () => {
    for (const d of EXTREMES) {
      const a = generateDynamic(launchFor(d, 77, 60));
      expect(generateDynamic(launchFor(d, 77, 60))).toEqual(a);
      expect(a.objects.length).toBeGreaterThan(10);
    }
  });
});

describe('generator constraints', () => {
  it('holds every rule on presets', () => {
    for (const lp of LEVEL_PRESETS) {
      for (let seed = 1; seed <= 50; seed++) {
        const map = generateDynamic(launchFor(lp.difficulty, seed, Math.min(lp.lengthSec, 60)));
        const v = violations(map);
        if (v.length > 0) throw new Error(`level ${lp.level} seed ${seed}: ${v.slice(0, 5).join('; ')}`);
      }
    }
  });

  it('holds every rule on full-length preset maps', () => {
    for (const lp of LEVEL_PRESETS) {
      for (let seed = 101; seed <= 103; seed++) {
        const v = violations(generateDynamic(launchFor(lp.difficulty, seed, lp.lengthSec)));
        if (v.length > 0) throw new Error(`level ${lp.level} seed ${seed}: ${v.slice(0, 5).join('; ')}`);
      }
    }
  });

  it('holds every rule on extreme custom settings', () => {
    for (const d of EXTREMES) {
      for (let seed = 1; seed <= 10; seed++) {
        const v = violations(generateDynamic(launchFor(d, seed, 60)));
        if (v.length > 0) throw new Error(`${JSON.stringify(d)} seed ${seed}: ${v.slice(0, 5).join('; ')}`);
      }
    }
  });

  it('holds with Tight, Wide, Fast and Slow, at the rate the map is made for', () => {
    for (const mods of [['tight'], ['wide'], ['fast'], ['slow']] as const) {
      const rate = rateFor(mods);
      for (let seed = 1; seed <= 6; seed++) {
        const v = violations(generateDynamic(launchFor(LEVEL_PRESETS[4]!.difficulty, seed, 60, [...mods]), rate), rate);
        if (v.length > 0) throw new Error(`${mods.join()} seed ${seed}: ${v.slice(0, 5).join('; ')}`);
      }
    }
  });

  it('starts at or after max(2000, approach + 1200)', () => {
    for (const lp of LEVEL_PRESETS) {
      const map = generateDynamic(launchFor(lp.difficulty, 3, 60));
      expect(map.objects[0]!.time).toBeGreaterThanOrEqual(Math.max(2000, lp.difficulty.approachMs + 1200) - 0.1);
    }
  });
});

describe('generator rhythm', () => {
  it('puts half-beat gaps at the rate density asks for', () => {
    const shares: number[] = [];
    for (const density of [1, 5, 10]) {
      const d = { ...DEFAULT_DIFFICULTY, bpm: 150, density, streams: 0, sliders: 0, spinners: 0, complexity: 4 };
      const p = deriveParams(d, []);
      let half = 0;
      let all = 0;
      let want = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const m = generateDynamic(launchFor(d, seed, 90));
        const f = computeFeatures(m);
        m.objects.forEach((o, i) => {
          if (o.number < 2 || !(o.pattern === 'jump' || o.pattern === 'backforth' || o.pattern === 'flow')) return;
          const g = f[i]!.gapMs!;
          all++;
          want += halfBeatProb(p, o.intensity);
          if (Math.abs(g - m.beatMs / 2) < 1) half++;
        });
      }
      const share = half / all;
      shares.push(share);
      expect(all).toBeGreaterThan(100);
      expect(Math.abs(share - want / all), `density ${density}`).toBeLessThan(0.12);
    }
    expect(shares[0]!).toBeLessThan(shares[1]!);
    expect(shares[1]!).toBeLessThan(shares[2]!);
    expect(shares[0]!).toBeLessThan(0.2);
    expect(shares[2]!).toBeGreaterThan(0.6);
  });

  it('makes more objects per minute as density rises', () => {
    const rate = (density: number) => {
      const d = { ...DEFAULT_DIFFICULTY, bpm: 150, density, streams: 0, sliders: 0, spinners: 0 };
      let n = 0;
      for (let seed = 1; seed <= 8; seed++) n += generateDynamic(launchFor(d, seed, 90)).objects.length;
      return n;
    };
    expect(rate(1)).toBeLessThan(rate(5));
    expect(rate(5)).toBeLessThan(rate(10));
  });
});

const STEADY = new Set(['jump', 'backforth', 'flow', 'triangle', 'square', 'star', 'doubles', 'polygon']);

describe('generator shape', () => {
  it('turns gently at low complexity and sharply at high complexity', () => {
    const share = (complexity: number, test: (a: number) => boolean) => {
      let n = 0;
      let hit = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const d = { ...DEFAULT_DIFFICULTY, complexity };
        const m = generateDynamic(launchFor(d, seed, 90));
        for (const f of computeFeatures(m)) {
          if (f.turnAngle !== null) {
            n++;
            if (test(f.turnAngle)) hit++;
          }
        }
      }
      return hit / n;
    };
    expect(share(2, (a) => a < 100)).toBeGreaterThanOrEqual(0.7);
    expect(share(1, (a) => a < 100)).toBeGreaterThanOrEqual(0.7);
    expect(share(8, (a) => a >= 100)).toBeGreaterThanOrEqual(0.3);
    expect(share(10, (a) => a >= 100)).toBeGreaterThanOrEqual(0.3);
  });

  it('keeps spacing steady within each motif', () => {
    for (const lp of [LEVEL_PRESETS[2]!, LEVEL_PRESETS[5]!, LEVEL_PRESETS[7]!]) {
      for (let seed = 1; seed <= 6; seed++) {
        const m = generateDynamic(launchFor(lp.difficulty, seed, 90));
        const f = computeFeatures(m);
        const byGroup = new Map<number, number[]>();
        // A kick slider group mixes beat and half-beat jumps, so it is left out.
        const mixed = new Set(m.objects.filter((o) => o.kind === 'slider').map((o) => o.group));
        m.objects.forEach((o, i) => {
          if (o.kind !== 'circle' || f[i]!.spacing === null || !STEADY.has(o.pattern) || mixed.has(o.group)) return;
          const arr = byGroup.get(o.group) ?? [];
          arr.push(f[i]!.spacing!);
          byGroup.set(o.group, arr);
        });
        for (const [g, vals] of byGroup) {
          const inner = vals.slice(1);
          if (inner.length < 2) continue;
          const mean = inner.reduce((a, b) => a + b, 0) / inner.length;
          const sd = Math.sqrt(inner.reduce((a, b) => a + (b - mean) ** 2, 0) / inner.length);
          if (sd / mean > 0.1) throw new Error(`level ${lp.level} seed ${seed} group ${g} cv ${(sd / mean).toFixed(3)}`);
        }
      }
    }
  });

  it('repeats a motif somewhere in every full section', () => {
    for (const lp of [LEVEL_PRESETS[3]!, LEVEL_PRESETS[6]!]) {
      for (let seed = 1; seed <= 5; seed++) {
        const m = generateDynamic(launchFor(lp.difficulty, seed, 120));
        m.sections.forEach((s, si) => {
          if (s.role !== 'build' && s.role !== 'peak') return;
          const groups = new Map<number, { pattern: string; n: number }>();
          for (const o of m.objects) {
            if (o.time >= s.start && o.time < s.end) {
              const g = groups.get(o.group) ?? { pattern: o.pattern, n: 0 };
              g.n++;
              groups.set(o.group, g);
            }
          }
          const sigs = Array.from(groups.values())
            .filter((g) => g.pattern !== 'spinner')
            .map((g) => `${g.pattern}:${g.n}`);
          const dup = sigs.some((x, i) => sigs.indexOf(x) !== i);
          if (!dup) throw new Error(`level ${lp.level} seed ${seed} section ${si} has no repeat: ${sigs.join(',')}`);
        });
      }
    }
  });

  it('detects stream runs on preset maps wherever streams are on', () => {
    for (const lp of LEVEL_PRESETS) {
      if (lp.difficulty.streams <= 0) continue;
      let tagged = 0;
      let inRun = 0;
      for (let seed = 1; seed <= 5; seed++) {
        const m = generateDynamic(launchFor(lp.difficulty, seed, 90));
        const f = computeFeatures(m);
        m.objects.forEach((o, i) => {
          if (o.pattern !== 'stream' && o.pattern !== 'burst') return;
          tagged++;
          if (f[i]!.runLength >= 3) inRun++;
          // The analytics call a note a stream note when it is under 1.6 widths from the one before.
          if (o.number > 1) expect(f[i]!.spacing!, `level ${lp.level}`).toBeLessThan(1.6);
        });
      }
      expect(tagged, `level ${lp.level}`).toBeGreaterThan(10);
      expect(inRun / tagged, `level ${lp.level}`).toBeGreaterThan(0.85);
    }
  });

  it('builds a 300 s Level 8 map in under 200 ms', () => {
    const lp = LEVEL_PRESETS[7]!;
    generateDynamic(launchFor(lp.difficulty, 1, 300));
    const t = performance.now();
    const m = generateDynamic(launchFor(lp.difficulty, 2, 300));
    const dt = performance.now() - t;
    expect(m.objects.length).toBeGreaterThan(800);
    expect(dt).toBeLessThan(200);
  });

  it('sets health rules and durations', () => {
    const m = generateDynamic(launchFor(DEFAULT_DIFFICULTY, 9, 60));
    expect(m.health).not.toBeNull();
    const last = m.objects[m.objects.length - 1]!;
    expect(m.durationMs).toBeCloseTo(endTime(last) + 1000, 5);
    expect(endPosition(m.objects[0]!).x).toBeGreaterThan(0);
  });
});

describe('generator beat offset', () => {
  it('sets beatOffsetMs to the time of beat 0, and the objects sit on that grid', () => {
    for (const lp of LEVEL_PRESETS) {
      const m = generateDynamic(launchFor(lp.difficulty, 5, 40));
      expect(m.beatOffsetMs, `level ${lp.level}`).toBeDefined();
      const off = m.beatOffsetMs!;
      expect(off).toBeGreaterThanOrEqual(2000);
      expect(m.objects[0]!.time).toBeGreaterThanOrEqual(off);
      // Quarter-beat grid, to the 0.1 ms the times are rounded to.
      const q = m.beatMs / 4;
      let on = 0;
      for (const o of m.objects) {
        const k = (o.time - off) / q;
        if (Math.abs(k - Math.round(k)) * q < 0.2) on++;
      }
      expect(on / m.objects.length, `level ${lp.level}`).toBeGreaterThan(0.9);
    }
  });

  it('scales the offset with the rate it is generated for', () => {
    const lp = LEVEL_PRESETS[3]!;
    const a = generateDynamic(launchFor(lp.difficulty, 9, 40), 1);
    const b = generateDynamic(launchFor(lp.difficulty, 9, 40), 1.25);
    expect(b.beatOffsetMs!).toBeGreaterThan(a.beatOffsetMs!);
  });
});
