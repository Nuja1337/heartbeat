import { describe, expect, it } from 'vitest';
import type { PlaySummary } from '../data/schema';
import { DEMAND_ANCHORS, LEVEL_PRESETS, levelForDemand, rawDemandAt, windowsForTiming } from '../shared/catalog';
import type { HitRecord } from '../shared/types';
import { pbFlags, computeBests } from './bests';
import {
  bucketKeys, computeBuckets, distanceBin, gapBin, isJump, isStreamNote, mergeBuckets, octantOf, turnBin, velocityBin,
} from './buckets';
import { itemsFromRecords, mapDemand } from './demand';
import { makeFixture, makeHistory } from './fixtures';
import { allRatings, newTierEvents, recordTierEvents, skillRating, tierOf } from './ratings';
import { groupSessions, weekCompare } from './sessions';
import { aggOf, ewma, linearRegression, logSdZ, mean, mergeAgg, quantile, sd, twoPropZ, welch } from './stats';
import { skillPerformance, summarizePlay } from './summary';
import { changeOf, dailySeries, dayIndex, trendMetric } from './trends';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

describe('stats', () => {
  it('computes mean, sample sd and quantiles', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(sd([5])).toBe(0);
    expect(quantile([1, 2, 3, 4, 5], 0.75)).toBe(4);
    expect(quantile([1, 2], 0.5)).toBe(1.5);
    expect(quantile([], 0.5)).toBe(0);
  });

  it('merges aggregates as if pooled', () => {
    const a = [1, 2, 3, 4, 5];
    const b = [10, 11, 15];
    const merged = mergeAgg(aggOf(a), aggOf(b));
    const pooled = aggOf([...a, ...b]);
    expect(merged.n).toBe(pooled.n);
    expect(merged.mean).toBeCloseTo(pooled.mean, 9);
    expect(merged.sd).toBeCloseTo(pooled.sd, 9);
  });

  it('smooths with weights that grow with the gap between days', () => {
    const e = ewma([{ day: 0, value: 10 }, { day: 1, value: 20 }, { day: 31, value: 20 }]);
    expect(e[0]).toBe(10);
    expect(e[1]!).toBeGreaterThan(10);
    expect(e[1]!).toBeLessThan(12);
    expect(e[2]!).toBeGreaterThan(19);
  });

  it('computes Welch t, two-proportion z, log sd z and regression', () => {
    const w = welch({ n: 30, mean: 10, sd: 2 }, { n: 30, mean: 9, sd: 2 });
    expect(w.t).toBeCloseTo(1.936, 2);
    expect(welch({ n: 30, mean: 5, sd: 0 }, { n: 30, mean: 5, sd: 0 }).t).toBe(0);
    expect(twoPropZ(30, 100, 20, 100)).toBeCloseTo(1.633, 2);
    expect(twoPropZ(10, 10, 0, 10)).toBeCloseTo(4.472, 2);
    expect(twoPropZ(0, 10, 0, 10)).toBe(0);
    expect(logSdZ(20, 50, 10, 50)).toBeGreaterThan(3);
    expect(logSdZ(10, 50, 10, 50)).toBe(0);
    const r = linearRegression([1, 2, 3, 4], [2, 4, 6, 8]);
    expect(r.slope).toBeCloseTo(2);
    expect(r.intercept).toBeCloseTo(0);
    expect(r.r2).toBeCloseTo(1);
  });
});

describe('buckets', () => {
  it('bins at the documented edges', () => {
    expect(distanceBin(0.99)).toBe('stack');
    expect(distanceBin(1)).toBe('short');
    expect(distanceBin(1.99)).toBe('short');
    expect(distanceBin(2)).toBe('medium');
    expect(distanceBin(3)).toBe('long');
    expect(distanceBin(4.5)).toBe('far');
    expect([109, 110, 159, 160, 249, 250, 399, 400, 699, 700].map(gapBin)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
    expect([0.39, 0.4, 0.89, 0.9, 1.49, 1.5].map(velocityBin)).toEqual([0, 1, 1, 2, 2, 3]);
    expect([44, 45, 99, 100, 149, 150].map(turnBin)).toEqual(['straight', 'wide', 'wide', 'sharp', 'sharp', 'reversal']);
  });

  it('puts octants from 0 (right) clockwise on screen', () => {
    expect(octantOf(0)).toBe(0);
    expect(octantOf(22.4)).toBe(0);
    expect(octantOf(22.5)).toBe(1);
    expect(octantOf(90)).toBe(2);
    expect(octantOf(180)).toBe(4);
    expect(octantOf(270)).toBe(6);
    expect(octantOf(350)).toBe(0);
  });

  it('builds keys and sparse stats', () => {
    const { records } = makeFixture({ seed: 4, objects: 150 });
    const keys = records.flatMap(bucketKeys);
    expect(keys.some((k) => /^dg:\w+:g\d$/.test(k))).toBe(true);
    expect(keys).toContain('motion:stream');
    const buckets = computeBuckets(records);
    expect(Object.keys(buckets).length).toBeGreaterThan(10);
    expect(Object.keys(buckets).length).toBeLessThan(80);
    for (const b of Object.values(buckets)) {
      expect(b.n).toBeGreaterThan(0);
      expect(b.miss).toBeLessThanOrEqual(b.n);
    }
  });

  it('merges buckets of several plays', () => {
    const a = makeFixture({ seed: 1, objects: 100 }).records;
    const b = makeFixture({ seed: 2, objects: 100 }).records;
    const merged = mergeBuckets([computeBuckets(a), computeBuckets(b)]);
    const whole = computeBuckets([...a, ...b]);
    for (const key of Object.keys(whole)) {
      expect(merged[key]!.n).toBe(whole[key]!.n);
      expect(merged[key]!.miss).toBe(whole[key]!.miss);
      expect(merged[key]!.along.mean).toBeCloseTo(whole[key]!.along.mean, 2);
    }
  });

  it('classifies stream notes and jumps', () => {
    const { records } = makeFixture({ seed: 9, objects: 200 });
    const streams = records.filter(isStreamNote);
    const jumps = records.filter(isJump);
    expect(streams.length).toBeGreaterThan(5);
    expect(jumps.length).toBeGreaterThan(20);
    expect(streams.some((r) => isJump(r))).toBe(false);
  });
});

describe('summarizePlay', () => {
  it('reports the planted biases in radii', () => {
    const fx = makeFixture({ seed: 12, objects: 300, jumpsOnly: true, longAlong: -0.4, octantLateral: { octant: 2, mean: 0.5 } });
    const s = summarizePlay(fx.result, { id: 'x', deviceId: 'd' });
    expect(s.id).toBe('x');
    expect(s.objectCount).toBe(300);
    expect(s.aim.n).toBeGreaterThan(200);
    expect(s.accuracy).toBeCloseTo(fx.result.accuracy, 6);
    expect(s.timing.sd).toBeGreaterThan(15);
    expect(s.timing.sd).toBeLessThan(40);
    const longBuckets = Object.entries(s.buckets).filter(([k]) => k.startsWith('dg:far:'));
    expect(longBuckets.length).toBeGreaterThan(0);
    const along = mean(longBuckets.map(([, b]) => b.along.mean));
    expect(along).toBeLessThan(-0.2);
    expect(s.buckets['dir:2']!.lat.mean).toBeGreaterThan(0.3);
    expect(s.halves.first).not.toBeNull();
    expect(s.quarters).toHaveLength(4);
    expect(s.hasDetail).toBe(true);
    expect(JSON.stringify(s).length).toBeLessThan(14_000);
  });

  it('leaves out records after a pause', () => {
    const fx = makeFixture({ seed: 13, objects: 100, jumpsOnly: true });
    const paused: HitRecord[] = fx.records.map((r, i) => (i < 50 ? { ...r, afterPause: true } : r));
    const s = summarizePlay({ ...fx.result, records: paused });
    expect(s.timing.n).toBeLessThan(fx.records.filter((r) => r.timingError !== null).length);
    expect(s.objectCount).toBe(100);
  });

  it('scores skills by level and performance, and skips skills with too few objects', () => {
    const jumps = makeFixture({ seed: 14, objects: 200, jumpsOnly: true });
    const s = summarizePlay(jumps.result);
    expect(s.skills.aim).toBeDefined();
    expect(s.skills.tracking).toBeUndefined();
    expect(s.skills.spin).toBeUndefined();
    const aim = s.skills.aim!;
    expect(aim.score).toBeCloseTo(aim.level * aim.performance ** 2, 2);
    const rich = summarizePlay(makeFixture({ seed: 15, objects: 300, sliderShare: 0.15, spinnerShare: 0.05, streamShare: 1.5 }).result);
    expect(Object.keys(rich.skills).sort()).toEqual(['aim', 'precision', 'reading', 'speed', 'spin', 'timing', 'tracking']);
  });

  it('measures performance per skill', () => {
    const { records } = makeFixture({ seed: 16, objects: 200, sliderShare: 0.2, spinnerShare: 0.05 });
    for (const skill of ['aim', 'speed', 'tracking', 'precision', 'timing', 'reading', 'spin'] as const) {
      const p = skillPerformance(skill, records);
      expect(p).not.toBeNull();
      expect(p!).toBeGreaterThanOrEqual(0);
      expect(p!).toBeLessThanOrEqual(1);
    }
  });
});

describe('demand', () => {
  it('inverts the anchors', () => {
    for (const skill of Object.keys(DEMAND_ANCHORS) as (keyof typeof DEMAND_ANCHORS)[]) {
      for (const level of [1, 2.5, 4, 7.5, 8, 10]) {
        expect(levelForDemand(skill, rawDemandAt(skill, level))).toBeCloseTo(level, 6);
      }
    }
  });

  it('gives exact precision, timing and reading demand for a preset', () => {
    // A map built from a preset's radius, windows and approach should land on that level.
    const preset = LEVEL_PRESETS[4]!;
    const crisp = windowsForTiming(preset.difficulty.timing).crisp;
    const { records } = makeFixture({ seed: 3, objects: 60, jumpsOnly: true, radius: preset.difficulty.radius });
    const items = itemsFromRecords(records).map((i) => ({ ...i, crispMs: crisp, approachMs: preset.difficulty.approachMs }));
    const d = mapDemand(items, []);
    expect(d.precision!.level).toBeCloseTo(5, 0);
    expect(d.timing!.level).toBeCloseTo(5, 0);
    expect(d.reading!.level).toBeCloseTo(5, 0);
  });

  it('weights reading demand by Fade and Spotlight', () => {
    const { records } = makeFixture({ seed: 3, objects: 60, jumpsOnly: true });
    const plain = mapDemand(itemsFromRecords(records), []).reading!.raw;
    const faded = mapDemand(itemsFromRecords(records), ['fade']).reading!.raw;
    expect(faded / plain).toBeCloseTo(1.5, 6);
  });
});

describe('ratings', () => {
  function plays(scores: number[], days: number[] = []): PlaySummary[] {
    return scores.map((score, i) => {
      const s = summarizePlay(makeFixture({ seed: i + 1, objects: 40, startedAt: NOW - (days[i] ?? i) * DAY }).result, { id: `p${i}` });
      s.skills = { aim: { raw: 1, level: score, performance: 1, score, n: 50 } };
      return s;
    });
  }

  it('weights the best scores by 0.85 to the power of their rank', () => {
    const r = skillRating('aim', plays([4, 3, 2]), NOW)!;
    const w = [1, 0.85, 0.85 ** 2];
    expect(r.rating).toBeCloseTo((4 * w[0]! + 3 * w[1]! + 2 * w[2]!) / (w[0]! + w[1]! + w[2]!), 9);
    expect(r.plays).toBe(3);
    expect(r.provisional).toBe(true);
    expect(r.tier).toBe(3);
  });

  it('uses the best 20 plays from the last 60 days only', () => {
    const scores = [...Array(25).fill(5) as number[], 9];
    const days = [...Array(25).fill(1) as number[], 90];
    const r = skillRating('aim', plays(scores, days), NOW)!;
    expect(r.rating).toBeCloseTo(5, 9);
    expect(r.plays).toBe(25);
    expect(r.provisional).toBe(false);
    expect(skillRating('speed', plays([4]), NOW)).toBeNull();
  });

  it('floors the rating into a tier and reports each tier once', () => {
    expect(tierOf(4.99)).toBe(4);
    const list = plays([4.2, 4.3, 4.1, 4.4, 4.2]);
    const ratings = allRatings(list, NOW);
    let history = {};
    const events = newTierEvents(history, ratings);
    expect(events).toEqual([{ skill: 'aim', tier: 4 }]);
    history = recordTierEvents(history, events, NOW);
    expect(newTierEvents(history, ratings)).toEqual([]);
    const provisional = allRatings(plays([6]), NOW);
    expect(newTierEvents({}, provisional)).toEqual([]);
  });
});

describe('trends', () => {
  const history = () =>
    makeHistory(20, { objects: 60, jumpsOnly: true }, { endAt: NOW, spacingMs: DAY, vary: (i) => ({ baseMiss: i < 10 ? 0.25 : 0.02 }) }).map((f) =>
      summarizePlay(f.result),
    );

  it('builds a daily series with a smoothed line', () => {
    const list = history();
    const series = dailySeries(trendMetric('accuracy'), list, 'all', NOW);
    expect(series.length).toBeGreaterThan(10);
    expect(series.every((p, i) => i === 0 || p.day > series[i - 1]!.day)).toBe(true);
    expect(series[series.length - 1]!.smooth).toBeGreaterThan(series[0]!.smooth);
    const week = dailySeries(trendMetric('accuracy'), list, '7', NOW);
    expect(week.length).toBeLessThanOrEqual(8);
    const perDay = dailySeries(trendMetric('plays'), list, 'all', NOW);
    expect(perDay.every((p) => p.value >= 1)).toBe(true);
    expect(dayIndex(NOW)).toBeGreaterThan(dayIndex(NOW - DAY));
  });

  it('states a change only when both windows have 3 plays and the difference is clear', () => {
    const list = history();
    const c = changeOf(trendMetric('accuracy'), list, NOW);
    expect(c).not.toBeNull();
    expect(c!.improved).toBe(true);
    expect(c!.after).toBeGreaterThan(c!.before);
    expect(changeOf(trendMetric('accuracy'), list.slice(-4), NOW)).toBeNull();
    const flat = makeHistory(20, { objects: 60, jumpsOnly: true }, { endAt: NOW, spacingMs: DAY }).map((f) => summarizePlay(f.result));
    expect(changeOf(trendMetric('accuracy'), flat, NOW)).toBeNull();
    expect(changeOf(trendMetric('plays'), list, NOW)).toBeNull();
  });
});

describe('sessions and bests', () => {
  it('groups plays less than 30 minutes apart', () => {
    const base = NOW - DAY;
    const mk = (offsetMin: number, seed: number) => summarizePlay(makeFixture({ seed, objects: 30, startedAt: base + offsetMin * 60_000 }).result);
    const list = [mk(0, 1), mk(10, 2), mk(20, 3), mk(300, 4)];
    const sessions = groupSessions(list);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.plays).toHaveLength(1);
    expect(sessions[1]!.plays).toHaveLength(3);
    const w = weekCompare([mk(0, 5)].map((s) => ({ ...s, startedAt: NOW - DAY })), NOW);
    expect(w.thisWeek.plays).toBe(1);
    expect(w.lastWeek.plays).toBe(0);
  });

  it('keeps bests per setting and mod set, from completed plays of the latest scoring version only', () => {
    const mk = (seed: number, o: Parameters<typeof makeFixture>[0], scoring = 1, engine = 1) => {
      const fx = makeFixture({ objects: 60, seed, lengthSec: 90, ...o });
      return { ...summarizePlay({ ...fx.result, engineVersion: engine }), scoringVersion: scoring };
    };
    const a = mk(1, { presetLevel: 4 });
    const b = mk(2, { presetLevel: 4, baseMiss: 0.3 });
    const c = mk(3, { presetLevel: 4, mods: ['fade'] });
    const d = mk(4, { presetLevel: 4, status: 'failed' });
    const old = mk(5, { presetLevel: 4 }, 0);
    // A play from another engine version still competes when the scoring version is the same.
    const newerEngine = mk(7, { presetLevel: 4, baseMiss: 0.5 }, 1, 2);
    const bests = computeBests([a, b, c, d, old, newerEngine]);
    expect(bests.dynamic).toHaveLength(2);
    const plain = bests.dynamic.find((e) => e.plays === 3)!;
    expect(plain.score.id).toBe([a, b, newerEngine].reduce((m, s) => (s.score > m.score ? s : m)).id);

    const later = mk(6, { presetLevel: 4 });
    const flags = pbFlags({ ...later, score: a.score + b.score + newerEngine.score + 1 }, [a, b, c, d, old, newerEngine]);
    expect(flags.score).toBe(true);
    expect(pbFlags(later, [])).toEqual({});
  });

  it('flags module level records', () => {
    const mk = (seed: number, level: number) => {
      const fx = makeFixture({ seed, objects: 40, modeId: 'jumps' });
      return summarizePlay({ ...fx.result, finalLevels: { jumps: level } });
    };
    const first = mk(1, 3);
    expect(pbFlags(mk(2, 4), [first]).level).toBe(true);
    expect(pbFlags(mk(3, 2), [first]).level).toBeUndefined();
    const faded = summarizePlay({ ...makeFixture({ seed: 4, objects: 40, modeId: 'jumps', mods: ['fade'] }).result, finalLevels: { jumps: 9 } });
    expect(pbFlags(faded, [first]).level).toBeUndefined();
    expect(computeBests([first, mk(2, 4)]).modules[0]!.level).toBe(4);
  });
});
