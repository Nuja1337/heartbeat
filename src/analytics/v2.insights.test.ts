// Analytics 2.0, insights: the 7.1 fixes, the three new rules, the contrast property and the scoring fixes.

import { describe, expect, it } from 'vitest';
import type { PlayData } from '../data/schema';
import type { HitRecord } from '../shared/types';
import { displayStep, distinct } from './contrast';
import { createDrill, evaluateDrill } from './drillEval';
import type { FixtureOptions } from './fixtures';
import { makeFixture, makeHistory } from './fixtures';
import { detectInsights, diversify, FRESH_FACTOR, ruleGood, ruleMinN, ruleSample, ruleThreshold, severityOf } from './insights';
import type { Insight } from './insights';
import { buildRows } from './insights';
import { drillText } from './insightCopy';
import { skillPerformance, summarizePlay } from './summary';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

const toPlay = (fx: ReturnType<typeof makeFixture>): PlayData => ({ summary: summarizePlay(fx.result), records: fx.records });

function history(o: FixtureOptions, count = 7, step = DAY, endAt = NOW - 600_000): PlayData[] {
  return makeHistory(count, { objects: 200, jumpsOnly: true, ...o }, { endAt, spacingMs: step }).map(toPlay);
}
const find = (list: Insight[], id: string) => list.find((i) => i.ruleId === id);

/** A small seeded normal generator for planting values by hand. */
function normals(seed: number) {
  let a = seed >>> 0 || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return (sd: number) => sd * Math.sqrt(-2 * Math.log(Math.max(next(), 1e-9))) * Math.cos(2 * Math.PI * next());
}

/** Replaces the lateral error of the jumps that move down (octant 2) with noise of the given spread, in radii. */
function withDownSpread(plays: PlayData[], sd: number): PlayData[] {
  const draw = normals(77);
  return plays.map((p) => ({
    summary: p.summary,
    records: p.records.map((r): HitRecord => {
      const dir = r.features.direction;
      if (dir === null || r.aimLateral === null || dir < 67.5 || dir >= 112.5) return r;
      return { ...r, aimLateral: draw(sd) * r.radius };
    }),
  }));
}

describe('distinct', () => {
  it('needs the displayed values to differ by 3 units', () => {
    expect(distinct(0.21, 0.17, 'share')).toBe(true);
    expect(distinct(0.21, 0.19, 'share')).toBe(false);
    expect(distinct(21, 18, 'ms')).toBe(true);
    expect(distinct(21.4, 19.6, 'ms')).toBe(false);
    // The 1.0 case: "scatter by 1% of a width, against 1% on your other jumps".
    expect(distinct(0.014, 0.006, 'width')).toBe(false);
    expect(distinct(0.2, 0.1, 'width')).toBe(true);
    expect(distinct(5.1, 6.3, 'bits')).toBe(true);
    expect(distinct(5.1, 5.3, 'bits')).toBe(false);
    expect(distinct(NaN, 1, 'ms')).toBe(false);
  });

  it('is true only when the rounded numbers are at least the minimum apart', () => {
    const draw = normals(5);
    for (let i = 0; i < 2000; i++) {
      const a = Math.abs(draw(40));
      const b = Math.abs(draw(40));
      expect(distinct(a, b, 'ms')).toBe(Math.abs(displayStep(a, 'ms') - displayStep(b, 'ms')) >= 3);
      expect(distinct(a, a, 'ms')).toBe(false);
    }
  });
});

describe('direction-drift spread', () => {
  it('needs the spread to be at least 0.1 radii wider than the other jumps', () => {
    const base = history({ aimSd: 0.1 });
    // 1.8 times the other jumps but only 0.08 radii (4% of a width) more.
    expect(find(detectInsights(withDownSpread(base, 0.18), NOW), 'direction-drift')).toBeUndefined();
    // The 1.0 case, tiny spreads that both show as 1%.
    expect(find(detectInsights(withDownSpread(history({ aimSd: 0.02 }), 0.03), NOW), 'direction-drift')).toBeUndefined();
    const wide = find(detectInsights(withDownSpread(base, 0.32), NOW), 'direction-drift');
    expect(wide).toBeDefined();
    expect(wide!.variant).toBe('o2:spread');
    const [, a, b] = wide!.text.match(/by (\d+)% of a target's width, against (\d+)%/)!.map(Number);
    expect(a! - b!).toBeGreaterThanOrEqual(3);
  });
});

describe('stream-fade contrast gate', () => {
  const streams = { jumpsOnly: false, streamShare: 3, sliderShare: 0, spinnerShare: 0 };
  it('stays quiet when the two spreads would show 6 ms against 4 ms', () => {
    expect(find(detectInsights(history({ ...streams, timingSd: 4, streamFade: 1.6 }, 10), NOW), 'stream-fade')).toBeUndefined();
  });
  it('fires when the spreads are clearly apart', () => {
    const i = find(detectInsights(history({ ...streams, timingSd: 12, streamFade: 2 }, 10), NOW), 'stream-fade')!;
    const [, a, b] = i.text.match(/\((\d+) ms spread against (\d+) ms\)/)!.map(Number);
    expect(a! - b!).toBeGreaterThanOrEqual(3);
  });
});

describe('contrast copy never shows two equal numbers', () => {
  // Every insight whose copy puts two numbers side by side, and how to read them.
  const PAIRS: RegExp[] = [
    /by (\d+)% of a target's width, against (\d+)% on your other jumps/,
    /\((\d+) ms spread against (\d+) ms\)/,
    /\((\d+)% against (\d+)%\)/,
    /\((\d+)% kept against (\d+)%\)/,
    /counted on (\d+)% of sliders, while (\d+)% of the ticks counted/,
    /\((\d+)% against (\d+)% on quieter screens\)/,
    /is (\d+)%, against (\d+)% for this session/,
  ];

  it('holds across a sweep of planted weaknesses near their thresholds', () => {
    const draw = normals(2024);
    const shown: string[] = [];
    for (let k = 0; k < 40; k++) {
      const u = (lo: number, hi: number) => lo + (hi - lo) * Math.min(1, Math.abs(draw(0.4)));
      const o: FixtureOptions = {
        seed: 1000 + k * 10,
        jumpsOnly: false,
        sliderShare: 0.2,
        streamShare: 0.9,
        spinnerShare: 0,
        timingSd: 6 + u(0, 14),
        streamFade: 1 + u(0.2, 1.2),
        sharpExtraMiss: u(0.04, 0.16),
        busyExtraMiss: u(0.04, 0.16),
        curvePenalty: u(0.05, 0.25),
        endDrop: u(0.1, 0.4),
        aimSd: 0.05 + u(0, 0.1),
      };
      for (const i of detectInsights(history(o, 8), NOW)) shown.push(i.text);
    }
    let pairs = 0;
    for (const text of shown) {
      for (const re of PAIRS) {
        const m = text.match(re);
        if (!m) continue;
        pairs++;
        expect(Math.abs(Number(m[1]) - Number(m[2])), text).toBeGreaterThanOrEqual(3);
      }
    }
    // The sweep has to exercise the check, or it proves nothing.
    expect(pairs).toBeGreaterThan(20);
  });
});

describe('ranking', () => {
  it('uses min(ratio, 4) x min(1, n / (3 x minN)) x weight x fresh', () => {
    expect(severityOf(2, 120, 40)).toBeCloseTo(2, 9);
    expect(severityOf(9, 120, 40)).toBeCloseTo(4, 9);
    expect(severityOf(2, 60, 40)).toBeCloseTo(1, 9);
    expect(severityOf(2, 120, 40, 0.5)).toBeCloseTo(1, 9);
    expect(severityOf(2, 120, 40, 1, FRESH_FACTOR)).toBeCloseTo(1.2, 9);
    expect(FRESH_FACTOR).toBe(0.6);
  });

  it('takes 0.6 off an insight whose module was played in the last 2 days', () => {
    const plays = history({ longAlong: -0.45, seed: 11 }, 7);
    const now = detectInsights(plays, NOW);
    const rested = detectInsights(plays, NOW + 5 * DAY);
    // The plays are Dynamic, so give them the module the insight recommends.
    const asJumps = (list: PlayData[]) => list.map((p) => ({ ...p, summary: { ...p.summary, modeId: 'jumps' as const } }));
    const fresh = find(detectInsights(asJumps(plays), NOW), 'long-undershoot')!;
    const stale = find(detectInsights(asJumps(plays), NOW + 5 * DAY), 'long-undershoot')!;
    expect(fresh.severity / stale.severity).toBeCloseTo(0.6, 6);
    // Dynamic plays do not count as jumps.
    expect(find(now, 'long-undershoot')!.severity).toBeCloseTo(find(rested, 'long-undershoot')!.severity, 9);
  });

  it('counts same-module and long-session for half', () => {
    const plays = history({ longAlong: -0.45 }, 4).map((p) => ({ ...p, summary: { ...p.summary, modeId: 'streams' as const } }));
    const repeat = find(detectInsights(plays, NOW), 'same-module')!;
    expect(repeat.severity).toBeCloseTo(0.5, 9);
  });

  it('puts the top 3 on different modules where it can', () => {
    const mk = (key: string, mode: 'jumps' | 'streams' | 'angles' | null, severity: number): Insight => ({
      key, ruleId: 'long-undershoot', variant: null, severity, n: 1, title: key, text: '', basis: '',
      recommendation: mode ? { modeId: mode, options: {}, label: mode } : null, baseline: null,
    });
    const sorted = [mk('a', 'jumps', 9), mk('b', 'jumps', 8), mk('c', 'streams', 7), mk('d', 'angles', 6), mk('e', null, 5)];
    expect(diversify(sorted).map((i) => i.key)).toEqual(['a', 'c', 'd', 'b', 'e']);
    // Two modules only: the third slot takes the best that is left.
    expect(diversify(sorted.slice(0, 3)).map((i) => i.key)).toEqual(['a', 'c', 'b']);
    // An insight with no module counts as its own.
    expect(diversify([mk('a', 'jumps', 9), mk('b', 'jumps', 8), mk('r', null, 7)]).map((i) => i.key)).toEqual(['a', 'r', 'b']);
  });

  it('applies that to real detections', () => {
    const plays = history({ longAlong: -0.5, shortAlong: 0.45, timingMean: 25 }, 7);
    const found = detectInsights(plays, NOW);
    const modes = found.slice(0, 3).map((i) => i.recommendation?.modeId);
    expect(found.length).toBeGreaterThanOrEqual(3);
    expect(new Set(modes).size).toBe(Math.min(3, new Set(found.map((i) => i.recommendation?.modeId)).size));
  });

  it('drops snoozed keys and keeps expired ones', () => {
    const plays = history({ longAlong: -0.45 });
    const key = find(detectInsights(plays, NOW), 'long-undershoot')!.key;
    expect(find(detectInsights(plays, NOW, { snoozed: { [key]: NOW + DAY } }), 'long-undershoot')).toBeUndefined();
    expect(find(detectInsights(plays, NOW, { snoozed: { [key]: NOW - 1 } }), 'long-undershoot')).toBeDefined();
    expect(find(detectInsights(plays, NOW, { snoozed: { other: NOW + DAY } }), 'long-undershoot')).toBeDefined();
  });
});

describe('late-leave', () => {
  it('fires when the leave time is 35% of the gap or more', () => {
    const found = detectInsights(history({ movement: { leaveFrac: 0.55 } }), NOW);
    const i = find(found, 'late-leave')!;
    expect(i).toBeDefined();
    expect(i.text).toMatch(/^On fast jumps you leave the last target late, after about \d+% of the time to the next one\. Leaving sooner gives the move more time\.$/);
    expect(Number(i.text.match(/about (\d+)%/)![1])).toBeGreaterThanOrEqual(50);
    expect(i.recommendation?.modeId).toBe('jumps');
    expect(i.basis).toMatch(/^Based on \d+ jumps from the last 30 days\.$/);
    expect(i.baseline?.kind).toBe('mean');
  });

  it('stays silent below the threshold and below the minimum n', () => {
    expect(find(detectInsights(history({ movement: { leaveFrac: 0.28 } }), NOW), 'late-leave')).toBeUndefined();
    expect(find(detectInsights(history({ movement: { leaveFrac: 0.55 } }, 3).map((p) => ({ ...p, records: p.records.slice(0, 30) })), NOW), 'late-leave')).toBeUndefined();
    // 1.0 records have no leave time at all.
    expect(find(detectInsights(history({}), NOW), 'late-leave')).toBeUndefined();
  });

  it('only counts jumps with a gap of 350 ms or less', () => {
    const slow = history({ movement: { leaveFrac: 0.55 } }).map((p) => ({
      ...p,
      records: p.records.map((r) => ({ ...r, features: { ...r.features, gapMs: 500 } })),
    }));
    expect(find(detectInsights(slow, NOW), 'late-leave')).toBeUndefined();
  });
});

describe('first-motion', () => {
  it('names a short first motion', () => {
    const i = find(detectInsights(history({ movement: { firstMotion: -1 } }), NOW), 'first-motion')!;
    expect(i).toBeDefined();
    expect(i.variant).toMatch(/^short:s[\d.]+v[\d.]+$/);
    expect(i.key).toMatch(/^first-motion:short:/);
    expect(i.text).toMatch(/^On long jumps your first motion stops about \d+% of a target's width short, and a second motion makes up the rest\.$/);
    expect(i.recommendation?.modeId).toBe('jumps');
    expect(i.recommendation?.options.distanceFocus).toBe('long');
  });

  it('names a first motion that goes past the center', () => {
    const i = find(detectInsights(history({ movement: { firstMotion: 1 } }), NOW), 'first-motion')!;
    expect(i.variant).toMatch(/^over:/);
    expect(i.text).toMatch(/^On long jumps your first motion goes about \d+% of a target's width past the center before you pull back\.$/);
  });

  it('stays silent between -0.5 and +0.5 radii and below the minimum n', () => {
    expect(find(detectInsights(history({ movement: { firstMotion: 0.2 } }), NOW), 'first-motion')).toBeUndefined();
    expect(find(detectInsights(history({ movement: { firstMotion: -0.3 } }), NOW), 'first-motion')).toBeUndefined();
    const thin = history({ movement: { firstMotion: -1 } }, 3).map((p) => ({ ...p, records: p.records.slice(0, 40) }));
    expect(find(detectInsights(thin, NOW), 'first-motion')).toBeUndefined();
  });
});

describe('corrections', () => {
  it('fires when a second motion is common and long', () => {
    const i = find(detectInsights(history({ movement: { correctionShare: 0.8, correctionPath: 0.9 } }), NOW), 'corrections')!;
    expect(i).toBeDefined();
    expect(i.text).toMatch(/^You make a second motion on \d+% of your longer jumps\. Try for one smooth move that stops on the target\.$/);
    expect(Number(i.text.match(/on (\d+)%/)![1])).toBeGreaterThanOrEqual(70);
    expect(i.recommendation?.modeId).toBe('jumps');
    expect(i.baseline?.kind).toBe('rate');
  });

  it('needs both the share and the path length, and enough jumps', () => {
    expect(find(detectInsights(history({ movement: { correctionShare: 0.8, correctionPath: 0.3 } }), NOW), 'corrections')).toBeUndefined();
    expect(find(detectInsights(history({ movement: { correctionShare: 0.3, correctionPath: 0.9 } }), NOW), 'corrections')).toBeUndefined();
    const thin = history({ movement: { correctionShare: 0.8, correctionPath: 0.9 } }, 3).map((p) => ({ ...p, records: p.records.slice(0, 40) }));
    expect(find(detectInsights(thin, NOW), 'corrections')).toBeUndefined();
  });

  it('ignores missed jumps', () => {
    const missed = history({ movement: { correctionShare: 0.8, correctionPath: 0.9 } }).map((p) => ({
      ...p,
      records: p.records.map((r): HitRecord => ({ ...r, judgment: 'miss', headJudgment: null })),
    }));
    expect(find(detectInsights(missed, NOW), 'corrections')).toBeUndefined();
  });
});

describe('the new rules define sample, good and threshold', () => {
  it('says what to measure, which way is good and how much counts', () => {
    expect(ruleGood('late-leave', null)).toBe('down');
    expect(ruleThreshold('late-leave', null)).toBe(0.1);
    expect(ruleGood('first-motion', 'short:s3v1')).toBe('zero');
    expect(ruleThreshold('first-motion', 'short:s3v1')).toBe(0.25);
    expect(ruleGood('corrections', null)).toBe('down');
    expect(ruleThreshold('corrections', null)).toBe(0.1);
    expect([ruleMinN('late-leave'), ruleMinN('first-motion'), ruleMinN('corrections')]).toEqual([60, 40, 60]);
    const rows = buildRows(history({ movement: { leaveFrac: 0.5, firstMotion: -1, correctionShare: 0.7, correctionPath: 0.9 } }));
    expect(ruleSample('late-leave', null, rows)!.kind).toBe('mean');
    expect(ruleSample('first-motion', 'short:s3v1', rows)!.kind).toBe('mean');
    expect(ruleSample('corrections', null, rows)!.kind).toBe('rate');
  });

  it('first-motion drills keep the cut-offs of the variant', () => {
    const rows = buildRows(history({ movement: { firstMotion: -1 } }));
    const a = ruleSample('first-motion', 'short:s6v0.9', rows)!;
    const b = ruleSample('first-motion', 'short:s2v0.1', rows)!;
    expect(a.kind === 'mean' && b.kind === 'mean' && a.values.length < b.values.length).toBe(true);
  });

  it('a late-leave drill reports better once the leave time drops', () => {
    const prior = history({ movement: { leaveFrac: 0.6 } });
    const insight = find(detectInsights(prior, NOW), 'late-leave')!;
    const drill = createDrill(insight, 'drill-ll', NOW)!;
    const drillPlays = [0, 1, 2].map((k) =>
      toPlay(makeFixture({ seed: 900 + k, modeId: 'jumps', objects: 60, jumpsOnly: true, drillId: 'drill-ll', startedAt: NOW + (k + 1) * 2 * 3_600_000, movement: { leaveFrac: 0.2 } })),
    );
    const after = Array.from({ length: 6 }, (_, k) =>
      toPlay(makeFixture({ seed: 500 + k, objects: 200, jumpsOnly: true, startedAt: NOW + DAY + k * 3_600_000, movement: { leaveFrac: 0.15 } })),
    );
    const ev = evaluateDrill(drill, [...drillPlays, ...after], NOW + 2 * DAY);
    expect(ev.outcome).toBe('better');
    expect(drillText({ ruleId: drill.ruleId, variant: drill.variant, createdAt: drill.createdAt, eval: ev })).toMatch(
      /^Since you started this drill on \d{1,2} \w{3}, how late you leave the last target went from \d+% of the gap to \d+% of the gap\. That's based on \d+ jumps before and \d+ after\.$/,
    );
  });
});

describe('drill text with equal-looking numbers', () => {
  const eval1 = (before: number, after: number) => ({
    outcome: 'better' as const, sessions: 3, sessionsNeeded: 3, morePlays: 0, before, after, nBefore: 50, nAfter: 60, nNeeded: 40, stat: 3, evaluatedAt: NOW,
  });
  it('does not show the same number twice', () => {
    const t = drillText({ ruleId: 'stream-fade', variant: null, createdAt: NOW, eval: eval1(20.2, 19.8) });
    expect(t).toContain('improved a little');
    expect(t).not.toMatch(/went from/);
    const w = drillText({ ruleId: 'stream-fade', variant: null, createdAt: NOW, eval: { ...eval1(20.2, 20.4), outcome: 'worse' } });
    expect(w).toBe('Your timing spread late in streams is a little worse than before this drill.');
  });
});

describe('timing performance reads the timing error', () => {
  const rec = (o: Partial<HitRecord>): HitRecord => ({ ...makeFixture({ seed: 4, objects: 10, jumpsOnly: true }).records[3]!, ...o });

  it('counts a press inside the Crisp window even when the judgment is lower', () => {
    // A Bullseye hit outside the inner half is Rough at best, but the timing was Crisp.
    const bullseye = rec({ judgment: 'rough', headJudgment: 'rough', missReason: null, timingError: 10, crispMs: 40 });
    expect(skillPerformance('timing', [bullseye])).toBe(1);
    expect(skillPerformance('timing', [rec({ timingError: 40, crispMs: 40, judgment: 'solid', missReason: null })])).toBe(1);
    expect(skillPerformance('timing', [rec({ timingError: -41, crispMs: 40, judgment: 'solid', missReason: null })])).toBe(0);
  });

  it('does not count a press with no timing, or one that landed off the target', () => {
    expect(skillPerformance('timing', [rec({ timingError: null, judgment: 'miss', missReason: 'none', hit: null })])).toBe(0);
    expect(skillPerformance('timing', [rec({ timingError: 5, crispMs: 40, judgment: 'miss', missReason: 'aim' })])).toBe(0);
  });

  it('gives the same result as the judgment on plays without Bullseye', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { records } = makeFixture({ seed, objects: 150, sliderShare: 0.15, streamShare: 0.3, timingSd: 30 });
      const taps = records.filter((r) => r.kind !== 'spinner');
      const old = taps.filter((r) => (r.kind === 'slider' ? (r.headJudgment ?? r.judgment) : r.judgment) === 'crisp').length / taps.length;
      expect(skillPerformance('timing', records)).toBeCloseTo(old, 12);
    }
  });
});
