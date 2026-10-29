import { describe, expect, it } from 'vitest';
import { DEFAULT_DIFFICULTY, LEVEL_PRESETS, PLAYFIELD, PLAYFIELD_CENTER } from '../../shared/catalog';
import type { DifficultySettings, GeneratedMap, HitObject, SliderObject } from '../../shared/types';
import { launchFor } from '../testing/fixtures';
import { computeFeatures, endPosition } from './features';
import { generateDynamic } from './generator';
import { arcThrough, flattenPath, samplePath } from './path';

const EXTREMES: DifficultySettings[] = [
  { radius: 30, approachMs: 300, bpm: 260, density: 10, spacing: 10, complexity: 10, streams: 10, streamMaxLength: 32, sliders: 10, spinners: 10, timing: 10 },
  { radius: 70, approachMs: 1800, bpm: 90, density: 1, spacing: 1, complexity: 1, streams: 0, streamMaxLength: 3, sliders: 0, spinners: 0, timing: 0 },
  { radius: 50, approachMs: 1800, bpm: 240, density: 10, spacing: 6, complexity: 8, streams: 6, streamMaxLength: 20, sliders: 6, spinners: 4, timing: 5 },
];

const endTime = (o: HitObject) => (o.kind === 'circle' ? o.time : o.endTime);

/** Dense samples of an object's shape: its center, or its slider body. */
function shape(o: HitObject): number[] {
  if (o.kind !== 'slider') return [o.pos.x, o.pos.y];
  return Array.from(samplePath(flattenPath(o.pos, o.path), 8));
}

function minDist(a: number[], b: number[]): number {
  let best = Infinity;
  for (let i = 0; i < a.length; i += 2)
    for (let j = 0; j < b.length; j += 2) best = Math.min(best, Math.hypot(a[i]! - b[j]!, a[i + 1]! - b[j + 1]!));
  return best;
}

const isStreamish = (o: HitObject) => o.pattern === 'stream' || o.pattern === 'burst';

/** Every rule from PLAN section 7. Returns a list of violations. */
function violations(map: GeneratedMap): string[] {
  const out: string[] = [];
  const objs = map.objects;
  const first = objs[0];
  if (!first) return ['empty'];
  const r = first.radius;
  const eps = 0.02 * r;
  const cache = objs.map(shape);
  const beat = map.beatMs;
  const minGap = Math.max(beat / 4, 50);

  if (Math.hypot(first.pos.x - PLAYFIELD_CENTER.x, first.pos.y - PLAYFIELD_CENTER.y) > 100.01) out.push('first object far from center');

  objs.forEach((o, i) => {
    if (o.index !== i) out.push(`index ${i}`);
    if (Math.abs(o.time * 10 - Math.round(o.time * 10)) > 1e-6) out.push(`time grid ${i}`);
    if (o.kind !== 'spinner') {
      for (let k = 0; k < cache[i]!.length; k += 2) {
        const x = cache[i]![k]!;
        const y = cache[i]![k + 1]!;
        if (x < r + 8 - 0.01 || x > PLAYFIELD.width - r - 8 + 0.01 || y < r + 8 - 0.01 || y > PLAYFIELD.height - r - 8 + 0.01) {
          out.push(`bounds ${i}`);
          break;
        }
      }
    }
  });

  for (let i = 1; i < objs.length; i++) {
    const a = objs[i - 1]!;
    const b = objs[i]!;
    if (b.time - endTime(a) < minGap - 1e-6) out.push(`gap ${i}`);
    if (a.kind === 'spinner' || b.kind === 'spinner') continue;
    if (a.kind === 'slider') {
      if (minDist(cache[i - 1]!, cache[i]!) < 2.1 * r - eps) out.push(`after slider ${i}`);
    } else if (isStreamish(a) && isStreamish(b) && a.group === b.group) {
      if (Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) < 0.6 * r - 0.01) out.push(`stream spacing ${i}`);
    } else if (Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) < 2.2 * r - 0.01) out.push(`jump ${i}`);
  }

  // Visible together.
  for (let j = 2; j < objs.length; j++) {
    const b = objs[j]!;
    if (b.kind === 'spinner') continue;
    for (let i = j - 2; i >= 0; i--) {
      const a = objs[i]!;
      if (a.time + 8000 < b.time - b.approachMs) break;
      if (a.kind === 'spinner') continue;
      if (b.time - b.approachMs > endTime(a) + 100) continue;
      const d = minDist(cache[i]!, cache[j]!);
      if (isStreamish(a) && isStreamish(b) && a.group === b.group) {
        const s = Math.hypot(objs[j - 1]!.pos.x - objs[j - 2]!.pos.x, objs[j - 1]!.pos.y - objs[j - 2]!.pos.y);
        const need = Math.min(2.1 * r, 0.8 * (j - i) * s) - eps;
        if (d < need) out.push(`fold-back ${i},${j}`);
      } else if (d < 2.1 * r - eps) {
        out.push(`near ${i},${j}`);
      }
    }
  }

  objs.forEach((o, i) => {
    if (o.kind === 'slider') {
      const s: SliderObject = o;
      const flat = flattenPath(s.pos, s.path);
      if (s.length < 2.4 * r - 0.01 || s.length > 600.01) out.push(`slider length ${i}`);
      if (Math.abs(flat.length - s.length) / s.length > 0.005) out.push(`slider flat ${i}`);
      if (Math.abs(s.spanMs * s.velocity - s.length) > 0.01 * s.length) out.push(`slider span ${i}`);
      if (s.endTime !== Math.round((s.time + s.spanMs * (s.repeats + 1)) * 10) / 10 && Math.abs(s.endTime - (s.time + s.spanMs * (s.repeats + 1))) > 0.2) out.push(`slider end ${i}`);
      let p = s.pos;
      for (const seg of s.path) {
        if (seg.type === 'arc') {
          const arc = arcThrough(p, seg.through, seg.to);
          if (arc) {
            const chord = Math.hypot(seg.to.x - p.x, seg.to.y - p.y);
            const mid = { x: (p.x + seg.to.x) / 2, y: (p.y + seg.to.y) / 2 };
            const sag = Math.hypot(seg.through.x - mid.x, seg.through.y - mid.y);
            if (sag / chord > 0.6 + 1e-6) out.push(`sagitta ${i}`);
          }
        }
        p = seg.to;
      }
      // No self-crossing: sampled body segments.
      const pts = shape(o);
      for (let a = 0; a < pts.length / 2 - 1; a++) {
        for (let b = a + 2; b < pts.length / 2 - 1; b++) {
          if (cross(pts, a, b)) out.push(`self cross ${i}`);
        }
      }
    }
    if (o.kind === 'spinner') {
      const prev = objs[i - 1];
      const next = objs[i + 1];
      if (o.time < 8000) out.push(`spinner early ${i}`);
      if (o.endTime > map.durationMs - 5000 + 0.5) out.push(`spinner late ${i}`);
      if (prev && o.time - endTime(prev) < Math.max(beat, 400) - 1e-6) out.push(`spinner before ${i}`);
      if (next) {
        if (next.time - o.endTime < Math.max(2 * beat, 600) - 1e-6) out.push(`spinner after ${i}`);
        if (Math.hypot(next.pos.x - PLAYFIELD_CENTER.x, next.pos.y - PLAYFIELD_CENTER.y) > 250.01) out.push(`spinner next far ${i}`);
      }
      const dur = o.endTime - o.time;
      if (dur < 1500 - 0.2 || dur > 4500 + 0.2) out.push(`spinner duration ${i}`);
    }
  });
  return out;
}

function cross(pts: number[], a: number, b: number): boolean {
  const [ax, ay, bx, by] = [pts[2 * a]!, pts[2 * a + 1]!, pts[2 * a + 2]!, pts[2 * a + 3]!];
  const [cx, cy, dx, dy] = [pts[2 * b]!, pts[2 * b + 1]!, pts[2 * b + 2]!, pts[2 * b + 3]!];
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

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

  it('holds every rule on extreme custom settings', () => {
    for (const d of EXTREMES) {
      for (let seed = 1; seed <= 6; seed++) {
        const v = violations(generateDynamic(launchFor(d, seed, 60)));
        if (v.length > 0) throw new Error(`${JSON.stringify(d)} seed ${seed}: ${v.slice(0, 5).join('; ')}`);
      }
    }
  });

  it('holds with Tight, Wide and Fast', () => {
    for (const mods of [['tight'], ['wide'], ['fast']] as const) {
      for (let seed = 1; seed <= 6; seed++) {
        const v = violations(generateDynamic(launchFor(LEVEL_PRESETS[4]!.difficulty, seed, 60, [...mods])));
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

/** Expected objects per minute for a preset, from its beat grid. */
function expected(d: DifficultySettings): number {
  const base = d.bpm * (0.6 + 0.07 * d.density);
  return base;
}

describe('generator shape', () => {
  it('keeps object counts near the expected rate', () => {
    for (const lp of LEVEL_PRESETS) {
      let total = 0;
      let seconds = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const m = generateDynamic(launchFor(lp.difficulty, seed, 90));
        total += m.objects.length;
        seconds += 90;
      }
      const perMin = (total / seconds) * 60;
      const exp = expected(lp.difficulty);
      expect(perMin).toBeGreaterThan(exp * 0.75);
      expect(perMin).toBeLessThan(exp * 1.25);
    }
  });

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
        m.objects.forEach((o, i) => {
          if (o.kind !== 'circle' || f[i]!.spacing === null) return;
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
        m.sections.slice(0, -1).forEach((s, si) => {
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
