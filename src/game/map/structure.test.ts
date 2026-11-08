import { describe, expect, it } from 'vitest';
import { LEVEL_PRESETS } from '../../shared/catalog';
import type { SectionRole } from '../../shared/types';
import { deriveParams } from './difficulty';
import { createRng } from './rng';
import { layoutRoles, phraseIntensities, planStructure, spinnerShape } from './structure';

const runs = (roles: readonly SectionRole[]) => {
  const out: { role: SectionRole; n: number }[] = [];
  for (const r of roles) {
    const last = out[out.length - 1];
    if (last && last.role === r) last.n++;
    else out.push({ role: r, n: 1 });
  }
  return out;
};

describe('layoutRoles', () => {
  it('handles the small maps', () => {
    expect(layoutRoles(1)).toEqual(['peak']);
    expect(layoutRoles(2)).toEqual(['intro', 'peak']);
    expect(layoutRoles(3)).toEqual(['intro', 'peak', 'outro']);
  });

  it('starts with an intro, ends with one outro, never ends a block with a rest, and has one phrase per role slot', () => {
    for (let P = 4; P <= 80; P++) {
      const roles = layoutRoles(P);
      expect(roles, `P ${P}`).toHaveLength(P);
      expect(roles[0]).toBe('intro');
      expect(roles[P - 1]).toBe('outro');
      expect(roles[P - 2]).toBe('peak');
      expect(roles.filter((r) => r === 'outro')).toHaveLength(1);
      expect(roles.filter((r) => r === 'intro')).toHaveLength(P >= 12 ? 2 : 1);
      // A rest sits between a peak and a build, never next to another rest.
      roles.forEach((r, i) => {
        if (r !== 'rest') return;
        expect(roles[i - 1]).toBe('peak');
        expect(roles[i + 1]).toBe('build');
      });
    }
  });

  it('uses one build and one peak per block below 10 phrases and two from 10', () => {
    expect(runs(layoutRoles(9)).filter((r) => r.role === 'build' && r.n > 2)).toHaveLength(0);
    const r = runs(layoutRoles(40));
    expect(
      r
        .filter((x) => x.role === 'build')
        .slice(0, -1)
        .every((x) => x.n === 2),
    ).toBe(true);
    expect(
      r
        .filter((x) => x.role === 'peak')
        .slice(0, -1)
        .every((x) => x.n === 2),
    ).toBe(true);
  });

  it('makes the last peak the longest', () => {
    for (let P = 4; P <= 80; P++) {
      const peaks = runs(layoutRoles(P)).filter((x) => x.role === 'peak');
      const last = peaks[peaks.length - 1]!.n;
      expect(Math.max(...peaks.map((x) => x.n)), `P ${P}`).toBe(last);
    }
  });
});

describe('phraseIntensities', () => {
  it('stays in [0.3, 1], follows the role curve, and keeps neighbours within 0.2 except around rests and into the outro', () => {
    for (let P = 4; P <= 60; P++) {
      const roles = layoutRoles(P);
      for (let seed = 1; seed <= 20; seed++) {
        const v = phraseIntensities(roles, createRng(seed));
        v.forEach((x, i) => {
          expect(x).toBeGreaterThanOrEqual(0.3);
          expect(x).toBeLessThanOrEqual(1);
          if (i === 0) return;
          const free = roles[i] === 'rest' || roles[i - 1] === 'rest' || roles[i] === 'outro';
          if (!free) expect(Math.abs(x - v[i - 1]!), `P ${P} seed ${seed} phrase ${i}`).toBeLessThanOrEqual(0.2 + 1e-9);
        });
        roles.forEach((r, i) => {
          if (r === 'rest') expect(v[i]!).toBeLessThan(0.4);
          if (r === 'peak') expect(v[i]!).toBeGreaterThan(0.9);
          if (r === 'outro') expect(Math.abs(v[i]! - 0.6)).toBeLessThan(0.04);
        });
      }
    }
  });

  it('is deterministic', () => {
    const roles = layoutRoles(20);
    expect(phraseIntensities(roles, createRng(3))).toEqual(phraseIntensities(roles, createRng(3)));
    expect(phraseIntensities(roles, createRng(3))).not.toEqual(phraseIntensities(roles, createRng(4)));
  });
});

describe('planStructure', () => {
  const plan = (level: number, seed: number, lengthSec = LEVEL_PRESETS[level - 1]!.lengthSec) => {
    const p = deriveParams(LEVEL_PRESETS[level - 1]!.difficulty, []);
    const t0 = Math.max(2000, p.approachMs + 1200);
    return { p, t0, s: planStructure({ p, t0, endMs: lengthSec * 1000 - 1000, rate: 1 }, createRng(seed)) };
  };

  it('covers the body with whole phrases and gives the tail of 4 beats or more to the last one', () => {
    for (const lp of LEVEL_PRESETS) {
      const { p, t0, s } = plan(lp.level, 2);
      const body = Math.floor((lp.lengthSec * 1000 - 1000 - t0) / p.beatMs);
      const P = Math.floor(body / 16);
      const tail = body - 16 * P;
      expect(s.phrases).toHaveLength(P);
      expect(s.endBeat).toBe(16 * P + (tail >= 4 ? tail : 0));
      s.phrases.forEach((ph, i) => expect(ph.startBeat).toBe(16 * i));
      const last = s.phrases[P - 1]!;
      expect(last.startBeat + last.beats).toBe(s.endBeat);
    }
  });

  it('builds sections from runs of one role, with the mean intensity of their phrases', () => {
    const { s } = plan(6, 5);
    let beat = 0;
    for (const sec of s.sections) {
      expect(sec.startBeat).toBe(beat);
      beat = sec.endBeat;
      const mine = s.phrases.slice(sec.firstPhrase, sec.firstPhrase + sec.phraseCount);
      expect(mine.every((x) => x.role === sec.role)).toBe(true);
      expect(sec.intensity).toBeCloseTo(mine.reduce((a, b) => a + b.intensity, 0) / mine.length, 2);
      expect(sec.focus === 'break').toBe(sec.role === 'rest');
    }
    expect(beat).toBe(s.endBeat);
  });

  it('is deterministic', () => {
    expect(plan(7, 11).s).toEqual(plan(7, 11).s);
  });

  it('puts spinners only in rests and the last build before the final peak, never in the intro, outro or last section', () => {
    let seen = 0;
    for (let level = 1; level <= 8; level++) {
      for (let seed = 1; seed <= 60; seed++) {
        const { p, t0, s } = plan(level, seed);
        let prev = -Infinity;
        for (const sp of s.spinners) {
          seen++;
          const sec = s.sections[sp.section]!;
          expect(['rest', 'build']).toContain(sec.role);
          expect(sp.section).toBeLessThan(s.sections.length - 1);
          const time = t0 + sp.startBeat * p.beatMs;
          expect(time).toBeGreaterThanOrEqual(8000);
          expect(time - prev).toBeGreaterThanOrEqual(30000);
          prev = time;
          expect(t0 + (s.endBeat - 8) * p.beatMs - (time + sp.durationMs)).toBeGreaterThanOrEqual(5000);
          expect(sp.resumeBeat % 4).toBe(0);
          expect(sp.resumeBeat).toBeGreaterThan(sp.startBeat);
          expect(sp.durationMs).toBeGreaterThanOrEqual(1500);
          expect(sp.durationMs).toBeLessThanOrEqual(4500);
        }
      }
    }
    expect(seen).toBeGreaterThan(20);
  });

  it('plans no spinners when the setting is 0', () => {
    const p = { ...deriveParams(LEVEL_PRESETS[5]!.difficulty, []), spinners: 0 };
    for (let seed = 1; seed <= 20; seed++)
      expect(planStructure({ p, t0: 2000, endMs: 119000, rate: 1 }, createRng(seed)).spinners).toHaveLength(0);
  });
});

describe('spinnerShape', () => {
  it('asks 1.1 turns per beat per minute', () => {
    for (const lp of LEVEL_PRESETS) {
      const p = deriveParams(lp.difficulty, []);
      for (const k of [2, 3] as const) {
        const { durationMs, rotations } = spinnerShape(p, k);
        expect((rotations / durationMs) * 60000, `level ${lp.level}`).toBeCloseTo(1.1 * p.bpm, -1);
      }
    }
  });
});
